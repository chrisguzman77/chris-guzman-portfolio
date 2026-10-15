"""Operator commands: `portfolio-api reindex | chats | chat-eval | chat-feedback` (see --help)."""

import argparse
import asyncio
import re
import sys
import time
from collections.abc import Awaitable, Callable, Sequence
from datetime import UTC, datetime, timedelta
from functools import partial
from importlib.resources import files
from pathlib import Path
from typing import Any

import httpx
import yaml
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.clients.directus import DirectusContent, DirectusError
from portfolio_api.clients.groq import GroqChatModel, ModelBusyError, ModelUnavailableError
from portfolio_api.config import Settings
from portfolio_api.db import make_engine, make_sessionmaker
from portfolio_api.evals.redteam import InjectingRetriever, judge_redteam, load_redteam_cases
from portfolio_api.evals.report import (
    ANSWERABLE,
    REFUSE,
    CaseResult,
    EvalReport,
    eval_run_row,
    format_summary,
    write_summary,
)
from portfolio_api.evals.scoring import (
    hit_rate,
    load_golden,
    mean_reciprocal_rank,
    plain_text,
    run_golden,
)
from portfolio_api.models import ChatEvalKind, ChatFeedback, ChatMessage, ChatOutcome, ChatSession
from portfolio_api.rag.embedder import FastEmbedEmbedder
from portfolio_api.rag.retrieval import Retriever
from portfolio_api.repositories import chat as chat_repo
from portfolio_api.services.chat import ChatService, Composed, SearchesIndex
from portfolio_api.services.grounding import Exchange
from portfolio_api.services.indexer import IndexService

BUSY_RETRIES = 3
ANSWER_PREVIEW = 300  # characters of each answer chat-feedback shows


_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")


def _clean(text: str) -> str:
    """Visitors write the questions: drop terminal control characters (ESC, C1, ...)."""
    return _CONTROL.sub(lambda m: " " if m.group() in "\n\r\t" else "", text)


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
            lines.append(f"[{m.outcome.value}] Q: {_clean(m.question)}")
            if m.answer:
                lines.append(f"    A: {_clean(m.answer)}")
            if m.sources:
                cited = ", ".join(_clean(f"{s['title']} ({s['url']})") for s in m.sources)
                lines.append(f"    sources: {cited}")
        lines.append("")
    return "\n".join(lines).rstrip()


def _preview(text: str) -> str:
    return text if len(text) <= ANSWER_PREVIEW else text[:ANSWER_PREVIEW] + "…"


def format_feedback(messages: Sequence[ChatMessage]) -> str:
    """Rated replies, in the order given. Uncited rows show the model's raw text, as chats does."""
    if not messages:
        return "No rated answers in this period."
    lines: list[str] = []
    for m in messages:
        when = (
            m.feedback_at.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC") if m.feedback_at else "?"
        )
        rating = m.feedback.value if m.feedback else "?"
        lines.append(f"== {when} · {rating} · {m.outcome.value}")
        lines.append(f"Q: {_clean(m.question)}")
        if m.answer:
            lines.append(f"A: {_preview(_clean(m.answer))}")
        if m.sources:
            lines.append("sources: " + ", ".join(_clean(s["title"]) for s in m.sources))
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
    answer = plain_text(composed.answer)
    missing = [f for f in case["must_include"] if plain_text(f) not in answer]
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
    timer: Callable[[], float],
    history: Sequence[Exchange] = (),
) -> tuple[Composed, float] | str:
    """The answer and how long its (successful) attempt took, or why there is no answer."""
    for attempt in range(BUSY_RETRIES + 1):
        started = timer()
        try:
            composed = await service.compose(question, history)
        except ModelBusyError:
            if attempt == BUSY_RETRIES:
                return "model busy after retries"
            await sleep(busy_wait)  # free tier allows ~8,000 tokens a minute
            continue
        except ModelUnavailableError as exc:
            return f"model unavailable: {exc}"
        return composed, timer() - started
    return "unreachable"


async def _run_case(
    service: ChatService,
    case_id: str,
    category: str,
    question: str,
    judge: Callable[[Composed], str | None],
    *,
    history: Sequence[Exchange] = (),
    known: bool = False,
    busy_wait: float,
    sleep: Callable[[float], Awaitable[None]],
    out: Callable[[str], None],
    timer: Callable[[], float],
) -> CaseResult:
    """Ask one case, add its tokens to today's usage, print PASS/FAIL (or KNOWN) and the answer."""
    attempt = await _compose_with_retry(service, question, busy_wait, sleep, timer, history)
    if isinstance(attempt, str):
        # No answer (busy, down): never known, so an outage still alerts.
        result = CaseResult(case_id, category, question, attempt, None, 0, False)
        answer = ""
    else:
        composed, seconds = attempt
        tokens = composed.input_tokens + composed.output_tokens
        if composed.raw is not None:
            await service.record_usage(tokens)
        result = CaseResult(case_id, category, question, judge(composed), seconds, tokens, known)
        answer = composed.answer
    status = "PASS" if result.reason is None else "KNOWN" if result.known else "FAIL"
    out(f"{status}  {question}" + (f"  ({result.reason})" if result.reason else ""))
    if answer:
        out(f"      {answer}")
    return result


async def run_eval(
    service: ChatService,
    cases: dict[str, Any],
    *,
    busy_wait: float = 30.0,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    out: Callable[[str], None] = print,
    timer: Callable[[], float] = time.perf_counter,
) -> list[CaseResult]:
    """Ask every case, print PASS/FAIL with the answer, return each case's result."""
    work: list[tuple[str, str, str, Callable[[Composed], str | None], list[Exchange]]] = [
        (
            f"{ANSWERABLE}-{i:02d}",
            ANSWERABLE,
            c["question"],
            partial(judge_answerable, c),
            [Exchange(h["question"], h["answer"]) for h in c.get("history", [])],
        )
        for i, c in enumerate(cases["answerable"], start=1)
    ] + [
        (f"{REFUSE}-{i:02d}", REFUSE, q, judge_refusal, [])
        for i, q in enumerate(cases["refuse"], start=1)
    ]
    results: list[CaseResult] = []
    for case_id, category, question, judge, history in work:
        results.append(
            await _run_case(
                service,
                case_id,
                category,
                question,
                judge,
                history=history,
                busy_wait=busy_wait,
                sleep=sleep,
                out=out,
                timer=timer,
            )
        )
    failed = sum(r.reason is not None for r in results)
    out(f"{len(work) - failed}/{len(work)} passed")
    return results


async def run_redteam(
    service: ChatService,
    retriever: InjectingRetriever,
    cases: Sequence[dict[str, Any]],
    *,
    busy_wait: float = 30.0,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    out: Callable[[str], None] = print,
    timer: Callable[[], float] = time.perf_counter,
) -> list[CaseResult]:
    """Ask every red-team case and return each result.

    A case's history goes straight to compose. Its inject_source reaches the model through
    ``retriever`` (the one ``service`` uses), for that case only.
    """
    results: list[CaseResult] = []
    for case in cases:
        history = [Exchange(h["question"], h["answer"]) for h in case.get("history", [])]
        with retriever.injected(case.get("inject_source")):
            result = await _run_case(
                service,
                case["id"],
                case["category"],
                case["question"],
                partial(judge_redteam, case),
                history=history,
                known="known_failure" in case,
                busy_wait=busy_wait,
                sleep=sleep,
                out=out,
                timer=timer,
            )
        results.append(result)
    failed = sum(r.reason is not None for r in results)
    out(f"{len(results) - failed}/{len(results)} passed")
    return results


_SHA = re.compile(r"[0-9a-f]{7,40}")


def image_commit(version: str) -> str | None:
    """Compose sets API_APP_VERSION to the deployed image tag: a git SHA, or dev/latest."""
    return version if _SHA.fullmatch(version) else None


async def evaluate(
    service: ChatService,
    retriever: SearchesIndex,
    *,
    cases: dict[str, Any],
    golden: Sequence[dict[str, Any]],
    commit: str | None,
    record: async_sessionmaker[AsyncSession] | None = None,
    summary_file: Path | None = None,
    out: Callable[[str], None] = print,
    timer: Callable[[], float] = time.perf_counter,
) -> int:
    """The answer cases, then the golden questions through retrieval only (no tokens).

    Prints the Markdown summary, writes it to ``summary_file`` and one chat_eval_runs row
    through ``record`` when given, and returns the number of failed cases.
    """
    started_at = datetime.now(UTC)
    results = await run_eval(service, cases, out=out, timer=timer)
    golden_error: str | None = None
    try:
        ranks = [g.rank for g in await run_golden(retriever, golden)]
    except Exception as exc:  # retrieval is the embedder and the database: any failure
        # Keep the answer results; hit@5 and MRR are recorded as NULL. Type name only.
        golden_error = type(exc).__name__
        ranks = []
    report = EvalReport(
        kind=ChatEvalKind.answer,
        started_at=started_at,
        finished_at=datetime.now(UTC),
        commit=commit,
        results=results,
        hit_at_5=hit_rate(ranks) if ranks else None,
        mrr=mean_reciprocal_rank(ranks) if ranks else None,
    )
    summary = format_summary(report)
    if golden_error:
        summary += f"\n\nGolden retrieval failed: {golden_error}"
    await _publish(report, summary, record=record, summary_file=summary_file, out=out)
    return len(report.failures)


async def _publish(
    report: EvalReport,
    summary: str,
    *,
    record: async_sessionmaker[AsyncSession] | None,
    summary_file: Path | None,
    out: Callable[[str], None],
) -> None:
    """Print the summary after a blank line, write it to ``summary_file``, store the row."""
    out("")
    out(summary)
    if summary_file is not None:
        write_summary(summary_file, summary)  # first, so a database error still leaves it
    if record is not None:
        async with record.begin() as session:
            session.add(eval_run_row(report))


async def evaluate_redteam(
    service: ChatService,
    retriever: InjectingRetriever,
    *,
    cases: Sequence[dict[str, Any]],
    commit: str | None,
    record: async_sessionmaker[AsyncSession] | None = None,
    summary_file: Path | None = None,
    out: Callable[[str], None] = print,
    timer: Callable[[], float] = time.perf_counter,
) -> int:
    """The red-team cases (no golden retrieval). Prints, writes and stores like ``evaluate``.

    Returns the number of failed cases not marked known_failure.
    """
    started_at = datetime.now(UTC)
    results = await run_redteam(service, retriever, cases, out=out, timer=timer)
    report = EvalReport(
        kind=ChatEvalKind.redteam,
        started_at=started_at,
        finished_at=datetime.now(UTC),
        commit=commit,
        results=results,
        hit_at_5=None,
        mrr=None,
    )
    await _publish(
        report, format_summary(report), record=record, summary_file=summary_file, out=out
    )
    return len(report.unknown_failures)


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
        except DirectusError as exc:
            # Nothing was changed (the fetch comes first); one line, not a traceback.
            print(f"reindex failed: {exc}", file=sys.stderr)
            return 1
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


async def _chat_feedback(settings: Settings, days: int, rating: str) -> int:
    engine = make_engine(settings.database_url)
    try:
        async with make_sessionmaker(engine)() as session:
            since = datetime.now(UTC) - timedelta(days=days)
            rows = await chat_repo.rated_since(
                session, since, None if rating == "all" else ChatFeedback(rating)
            )
    finally:
        await engine.dispose()
    print(format_feedback(rows))
    return 0


async def _chat_eval(
    settings: Settings, kind: ChatEvalKind, record: bool, summary_file: Path | None
) -> int:
    if not settings.groq_api_key:
        print("API_GROQ_API_KEY is not set", file=sys.stderr)
        return 1
    engine = make_engine(settings.database_url)
    sessions = make_sessionmaker(engine)
    async with httpx.AsyncClient() as http:
        try:
            retriever = Retriever(sessions, FastEmbedEmbedder(settings.embedding_cache_dir))
            injecting = InjectingRetriever(retriever)  # passes through outside a red-team case
            service = ChatService(
                sessions,
                injecting,
                GroqChatModel(http, settings.groq_api_key, settings.groq_model),
                hash_salt=settings.chat_hash_salt or "eval",
                daily_budget=settings.chat_daily_token_budget,
                min_similarity=settings.chat_min_similarity,
                link_hosts=settings.chat_allowed_link_hosts,
            )
            commit = image_commit(settings.app_version)
            if kind == ChatEvalKind.redteam:
                failed = await evaluate_redteam(
                    service,
                    injecting,
                    cases=load_redteam_cases(),
                    commit=commit,
                    record=sessions if record else None,
                    summary_file=summary_file,
                )
            else:
                failed = await evaluate(
                    service,
                    retriever,
                    cases=load_eval_cases(),
                    golden=load_golden(),
                    commit=commit,
                    record=sessions if record else None,
                    summary_file=summary_file,
                )
        finally:
            await engine.dispose()
    return 1 if failed else 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="portfolio-api")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("reindex", help="sync the chat index with published content")
    chats = commands.add_parser("chats", help="print recent chat sessions")
    chats.add_argument("--days", type=int, default=7)
    evals = commands.add_parser(
        "chat-eval", help="run the answer-quality or red-team cases against the live model"
    )
    evals.add_argument(
        "--kind", choices=[k.value for k in ChatEvalKind], default=ChatEvalKind.answer.value
    )
    evals.add_argument("--record", action="store_true", help="store the run in chat_eval_runs")
    evals.add_argument("--summary-file", type=Path, help="also write the Markdown summary here")
    feedback = commands.add_parser("chat-feedback", help="print recently rated chat replies")
    feedback.add_argument("--days", type=int, default=7)
    feedback.add_argument("--rating", choices=["down", "up", "all"], default="down")
    args = parser.parse_args(argv)
    settings = Settings()
    if args.command == "reindex":
        return asyncio.run(_reindex(settings))
    if args.command == "chats":
        return asyncio.run(_chats(settings, args.days))
    if args.command == "chat-feedback":
        return asyncio.run(_chat_feedback(settings, args.days, args.rating))
    return asyncio.run(
        _chat_eval(settings, ChatEvalKind(args.kind), args.record, args.summary_file)
    )
