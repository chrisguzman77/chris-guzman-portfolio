"""Operator commands: `portfolio-api reindex | chats [--days N] | chat-eval`."""

import argparse
import asyncio
import sys
from collections.abc import Awaitable, Callable, Sequence
from datetime import UTC, datetime, timedelta
from functools import partial
from importlib.resources import files
from typing import Any

import httpx
import yaml

from portfolio_api.clients.directus import DirectusContent
from portfolio_api.clients.groq import GroqChatModel, ModelBusyError, ModelUnavailableError
from portfolio_api.config import Settings
from portfolio_api.db import make_engine, make_sessionmaker
from portfolio_api.models import ChatMessage, ChatOutcome, ChatSession
from portfolio_api.rag.embedder import FastEmbedEmbedder
from portfolio_api.rag.retrieval import Retriever
from portfolio_api.repositories import chat as chat_repo
from portfolio_api.services.chat import ChatService, Composed
from portfolio_api.services.indexer import IndexService

BUSY_RETRIES = 3


def format_chats(rows: Sequence[tuple[ChatSession, Sequence[ChatMessage]]]) -> str:
    if not rows:
        return "No chats in this period."
    lines: list[str] = []
    for session, messages in rows:
        when = session.created_at.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC")
        lines.append(
            f"== {when} · session {str(session.id)[:8]} · "
            f"{session.question_count} counted question(s)"
        )
        for m in messages:
            lines.append(f"[{m.outcome.value}] Q: {m.question}")
            if m.answer:
                lines.append(f"    A: {m.answer}")
            if m.sources:
                cited = ", ".join(f"{s['title']} ({s['url']})" for s in m.sources)
                lines.append(f"    sources: {cited}")
        lines.append("")
    return "\n".join(lines).rstrip()


def load_eval_cases() -> dict[str, Any]:
    text = files("portfolio_api.evals").joinpath("chat_eval.yaml").read_text()
    cases: dict[str, Any] = yaml.safe_load(text)
    return cases


def judge_answerable(case: dict[str, Any], composed: Composed) -> str | None:
    """None when the answer passes, otherwise the reason it failed."""
    if composed.outcome != ChatOutcome.answered:
        return f"outcome {composed.outcome.value}"
    answer = composed.answer.lower()
    missing = [f for f in case["must_include"] if f.lower() not in answer]
    if missing:
        return "missing " + ", ".join(missing)
    cited = {s.url for s in composed.sources}
    if not cited.intersection(case["sources"]):
        return "did not cite " + " or ".join(case["sources"])
    return None


def judge_refusal(composed: Composed) -> str | None:
    if composed.outcome in (ChatOutcome.no_match, ChatOutcome.uncited):
        return None
    return "answered instead of refusing"


async def _compose_with_retry(
    service: ChatService,
    question: str,
    busy_wait: float,
    sleep: Callable[[float], Awaitable[None]],
) -> Composed | str:
    for attempt in range(BUSY_RETRIES + 1):
        try:
            return await service.compose(question, [])
        except ModelBusyError:
            if attempt == BUSY_RETRIES:
                return "model busy after retries"
            await sleep(busy_wait)  # free tier allows ~8,000 tokens a minute
        except ModelUnavailableError as exc:
            return f"model unavailable: {exc}"
    return "unreachable"


async def run_eval(
    service: ChatService,
    cases: dict[str, Any],
    *,
    busy_wait: float = 30.0,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    out: Callable[[str], None] = print,
) -> int:
    """Ask every case, print PASS/FAIL with the answer, return the number of failures."""
    work: list[tuple[str, Callable[[Composed], str | None]]] = [
        (c["question"], partial(judge_answerable, c)) for c in cases["answerable"]
    ] + [(q, judge_refusal) for q in cases["refuse"]]
    failed = 0
    for question, judge in work:
        result = await _compose_with_retry(service, question, busy_wait, sleep)
        if isinstance(result, str):
            reason: str | None = result
            answer = ""
        else:
            if result.raw is not None:
                await service.record_usage(result.input_tokens + result.output_tokens)
            reason = judge(result)
            answer = result.answer
        failed += reason is not None
        status = "PASS" if reason is None else "FAIL"
        out(f"{status}  {question}" + (f"  ({reason})" if reason else ""))
        if answer:
            out(f"      {answer}")
    out(f"{len(work) - failed}/{len(work)} passed")
    return failed


async def _reindex(settings: Settings) -> int:
    if not settings.directus_token:
        print("API_DIRECTUS_TOKEN is not set", file=sys.stderr)
        return 1
    engine = make_engine(settings.database_url)
    async with httpx.AsyncClient() as http:
        try:
            directus = DirectusContent(http, settings.directus_url, settings.directus_token)
            embedder = FastEmbedEmbedder(settings.embedding_cache_dir)
            result = await IndexService(make_sessionmaker(engine), directus, embedder).sync()
        finally:
            await engine.dispose()
    print(
        f"documents={result.documents} added={result.chunks_added} removed={result.chunks_removed}"
    )
    return 0


async def _chats(settings: Settings, days: int) -> int:
    engine = make_engine(settings.database_url)
    try:
        async with make_sessionmaker(engine)() as session:
            since = datetime.now(UTC) - timedelta(days=days)
            rows = await chat_repo.sessions_since(session, since)
    finally:
        await engine.dispose()
    print(format_chats(rows))
    return 0


async def _chat_eval(settings: Settings) -> int:
    if not settings.groq_api_key:
        print("API_GROQ_API_KEY is not set", file=sys.stderr)
        return 1
    engine = make_engine(settings.database_url)
    sessions = make_sessionmaker(engine)
    async with httpx.AsyncClient() as http:
        try:
            service = ChatService(
                sessions,
                Retriever(sessions, FastEmbedEmbedder(settings.embedding_cache_dir)),
                GroqChatModel(http, settings.groq_api_key, settings.groq_model),
                hash_salt=settings.chat_hash_salt or "eval",
                daily_budget=settings.chat_daily_token_budget,
                min_similarity=settings.chat_min_similarity,
            )
            failed = await run_eval(service, load_eval_cases())
        finally:
            await engine.dispose()
    return 1 if failed else 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="portfolio-api")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("reindex", help="sync the chat index with published content")
    chats = commands.add_parser("chats", help="print recent chat sessions")
    chats.add_argument("--days", type=int, default=7)
    commands.add_parser("chat-eval", help="run the answer-quality cases against the live model")
    args = parser.parse_args(argv)
    settings = Settings()
    if args.command == "reindex":
        return asyncio.run(_reindex(settings))
    if args.command == "chats":
        return asyncio.run(_chats(settings, args.days))
    return asyncio.run(_chat_eval(settings))
