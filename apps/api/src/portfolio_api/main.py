import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from functools import partial

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from portfolio_api.config import Settings
from portfolio_api.db import make_engine, make_sessionmaker, ping
from portfolio_api.errors import install_error_handlers
from portfolio_api.jobs import Job, run_forever
from portfolio_api.observability import configure_logging
from portfolio_api.request_id import install_request_id
from portfolio_api.routers import health


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
    install_error_handlers(app)
    install_request_id(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.include_router(health.router)
    return app
