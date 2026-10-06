import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from functools import partial

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from portfolio_api.body_limit import BodySizeLimit
from portfolio_api.clients.directus import DirectusContent
from portfolio_api.clients.email import ResendSender
from portfolio_api.clients.github import GitHubGraphQL
from portfolio_api.clients.groq import GroqChatModel
from portfolio_api.clients.prometheus import HttpPrometheus
from portfolio_api.clients.turnstile import CloudflareTurnstile
from portfolio_api.config import Settings
from portfolio_api.db import make_engine, make_sessionmaker, ping
from portfolio_api.errors import install_error_handlers
from portfolio_api.jobs import Job, run_forever
from portfolio_api.metrics import RequestMetrics
from portfolio_api.observability import configure_logging
from portfolio_api.rag.embedder import FastEmbedEmbedder
from portfolio_api.rag.retrieval import Retriever
from portfolio_api.ratelimit import SlidingWindowLimiter
from portfolio_api.request_id import install_request_id
from portfolio_api.routers import chat, contact, github, health, internal, metrics, status
from portfolio_api.security_headers import SecurityHeaders
from portfolio_api.services.chat import ChatService, ChatSwitch
from portfolio_api.services.contact import ContactService
from portfolio_api.services.github import GitHubActivityService
from portfolio_api.services.indexer import IndexService
from portfolio_api.services.status import StatusService


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    configure_logging(settings.log_level)
    engine = make_engine(settings.database_url)
    sessions = make_sessionmaker(engine)
    http = httpx.AsyncClient(
        timeout=10.0, headers={"User-Agent": f"portfolio-api/{settings.app_version}"}
    )
    jobs: list[Job] = []

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        tasks = [asyncio.create_task(run_forever(job), name=job.name) for job in jobs]
        yield
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await http.aclose()
        await engine.dispose()

    app = FastAPI(title="Portfolio API", version=settings.app_version, lifespan=lifespan)
    app.state.settings = settings
    app.state.db_ping = partial(ping, engine)
    app.state.sessionmaker = sessions
    app.state.http = http
    app.state.contact_limiter = SlidingWindowLimiter([(5, 60), (20, 86_400)])
    app.state.turnstile = (
        CloudflareTurnstile(http, settings.turnstile_secret) if settings.turnstile_secret else None
    )
    sender = ResendSender(http, settings.resend_api_key) if settings.resend_api_key else None
    contact_service = ContactService(
        sessions, sender, mail_from=settings.contact_from, mail_to=settings.contact_to
    )
    app.state.contact_service = contact_service
    jobs.append(Job("contact-retry", 300, contact_service.retry_due))
    github_source = GitHubGraphQL(http, settings.github_token) if settings.github_token else None
    github_activity = GitHubActivityService(sessions, github_source, login=settings.github_login)
    app.state.github_activity = github_activity
    if github_source is not None:
        # Checked every 10 minutes; GitHub is called only when the copy is an hour old.
        jobs.append(Job("github-refresh", 600, github_activity.refresh_if_stale))
    # Phase 5: the index needs only Directus; answering also needs Groq, Turnstile and a salt.
    directus = (
        DirectusContent(http, settings.directus_url, settings.directus_token)
        if settings.directus_token
        else None
    )
    embedder = FastEmbedEmbedder(settings.embedding_cache_dir)
    indexer = IndexService(sessions, directus, embedder) if directus is not None else None
    app.state.indexer = indexer
    if indexer is not None:
        # Runs at startup and every 15 minutes; a no-change sync embeds nothing and
        # self-heals a missed Flow call or an api started before the Directus bootstrap.
        jobs.append(Job("rag-sync", 900, indexer.sync_job))
    app.state.chat_switch = ChatSwitch(directus) if directus is not None else None
    app.state.chat_session_limiter = SlidingWindowLimiter([(10, 3_600)])
    app.state.chat_message_limiter = SlidingWindowLimiter([(5, 60), (30, 86_400)])
    chat_service: ChatService | None = None
    if (
        directus is not None
        and settings.groq_api_key
        and settings.turnstile_secret
        and settings.chat_hash_salt
    ):
        chat_service = ChatService(
            sessions,
            Retriever(sessions, embedder),
            GroqChatModel(http, settings.groq_api_key, settings.groq_model),
            hash_salt=settings.chat_hash_salt,
            daily_budget=settings.chat_daily_token_budget,
            min_similarity=settings.chat_min_similarity,
        )
        jobs.append(Job("chat-retention", 86_400, chat_service.purge_expired))
        # Sets the budget gauge at startup and lets it fall back to 0 after UTC midnight.
        jobs.append(Job("chat-budget-gauge", 300, chat_service.refresh_budget_gauge))
    app.state.chat_service = chat_service
    app.state.status_service = StatusService(
        HttpPrometheus(http, settings.prometheus_url), app.state.db_ping
    )
    app.state.status_limiter = SlidingWindowLimiter([(60, 60)])
    install_error_handlers(app)
    # Inside the request-ID middleware (413s get an X-Request-ID); CORS stays outermost.
    app.add_middleware(BodySizeLimit)
    # Between the two: sees 413s, and unhandled errors before they become JSON 500s.
    app.add_middleware(RequestMetrics)
    app.add_middleware(SecurityHeaders)
    install_request_id(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )
    app.include_router(health.router)
    app.include_router(contact.router)
    app.include_router(github.router)
    app.include_router(chat.router)
    app.include_router(internal.router)
    app.include_router(metrics.router)
    app.include_router(status.router)
    return app
