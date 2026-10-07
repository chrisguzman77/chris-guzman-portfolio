import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.cli import (
    format_chats,
    judge_answerable,
    judge_refusal,
    load_eval_cases,
    main,
    run_eval,
)
from portfolio_api.clients.groq import ModelBusyError, ModelReply
from portfolio_api.models import ChatMessage, ChatOutcome, ChatSession, ChatUsageDaily
from portfolio_api.services.chat import ChatService, Composed
from portfolio_api.services.grounding import CANNED_ANSWER, Source
from tests.fakes import FakeChatModel, FakeRetriever

Sessions = async_sessionmaker[AsyncSession]


def composed(answer: str, outcome: ChatOutcome, *urls: str) -> Composed:
    sources = [Source(i, f"T{i}", u) for i, u in enumerate(urls, start=1)]
    return Composed(answer, sources, outcome, answer, 10, 5)


def test_format_chats() -> None:
    session = ChatSession(
        id=uuid.UUID("1a2b3c4d-0000-4000-8000-000000000000"),
        ip_hash="x",
        question_count=1,
        created_at=datetime(2026, 10, 2, 14, 3, tzinfo=UTC),
    )
    msgs = [
        ChatMessage(
            question="FastAPI?",
            answer="Yes [1].",
            outcome=ChatOutcome.answered,
            sources=[{"n": 1, "title": "ACM", "url": "/projects/acm"}],
        ),
        ChatMessage(question="Poem?", answer=None, outcome=ChatOutcome.error, sources=[]),
    ]
    assert format_chats([(session, msgs)]) == (
        "== 2026-10-02 14:03 UTC · session 1a2b3c4d · 1 counted question(s)\n"
        "[answered] Q: FastAPI?\n"
        "    A: Yes [1].\n"
        "    sources: ACM (/projects/acm)\n"
        "[error] Q: Poem?"
    )
    assert format_chats([]) == "No chats in this period."


def test_format_chats_strips_control_characters() -> None:
    session = ChatSession(
        id=uuid.UUID("1a2b3c4d-0000-4000-8000-000000000000"),
        ip_hash="x",
        question_count=0,
        created_at=datetime(2026, 10, 2, 14, 3, tzinfo=UTC),
    )
    msg = ChatMessage(
        question="\x1b[31mred\x07\nnext\x9b",
        answer="a\x1b]0;pwn\x07b",
        outcome=ChatOutcome.answered,
        sources=[{"n": 1, "title": "T\x1b[2J", "url": "/x\x00"}],
    )
    out = format_chats([(session, [msg])])
    assert not any((ord(c) < 32 and c != "\n") or 0x7F <= ord(c) <= 0x9F for c in out)
    assert "red" in out and "next" in out
    assert out.count("\n") == 3  # injected newline did not add a line


def test_eval_cases_are_well_formed() -> None:
    cases = load_eval_cases()
    assert len(cases["answerable"]) >= 15 and len(cases["refuse"]) >= 10
    for case in cases["answerable"]:
        assert case["must_include"] and all(u.startswith("/") for u in case["sources"])


def test_judges() -> None:
    case = {"question": "q", "must_include": ["FastAPI"], "sources": ["/projects/acm"]}
    assert (
        judge_answerable(case, composed("Uses fastapi [1].", ChatOutcome.answered, "/projects/acm"))
        is None
    )
    assert (
        judge_answerable(case, composed("Uses Go [1].", ChatOutcome.answered, "/projects/acm"))
        == "missing FastAPI"
    )
    assert (
        judge_answerable(case, composed("FastAPI [1].", ChatOutcome.answered, "/blog/x"))
        == "did not cite /projects/acm"
    )
    assert (
        judge_answerable(case, composed(CANNED_ANSWER, ChatOutcome.no_match)) == "outcome no_match"
    )
    assert judge_refusal(composed(CANNED_ANSWER, ChatOutcome.uncited)) is None
    assert (
        judge_refusal(composed("Sure! [1]", ChatOutcome.answered, "/"))
        == "answered instead of refusing"
    )


def chat(db: Sessions, model: FakeChatModel) -> ChatService:
    return ChatService(
        db, FakeRetriever(), model, hash_salt="s", daily_budget=180_000, min_similarity=0.5
    )


async def test_run_eval_reports_and_records_usage(db: Sessions) -> None:
    cases = {
        "answerable": [
            {"question": "FastAPI?", "must_include": ["FastAPI"], "sources": ["/projects/acm"]},
            {"question": "Go?", "must_include": ["Go"], "sources": ["/projects/acm"]},
        ],
        "refuse": ["Poem?"],
    }
    lines: list[str] = []
    failed = await run_eval(chat(db, FakeChatModel()), cases, out=lines.append)
    # FakeChatModel always answers "He built it with FastAPI [1]." citing /projects/acm.
    assert failed == 2
    assert lines[0].startswith("PASS  FastAPI?")
    assert any(line.startswith("FAIL  Go?") and "missing Go" in line for line in lines)
    assert any(line.startswith("FAIL  Poem?") for line in lines)
    assert lines[-1] == "1/3 passed"
    async with db() as session:
        day = await session.get(ChatUsageDaily, datetime.now(UTC).date())
    assert day is not None and day.requests == 3


async def test_run_eval_waits_and_retries_when_busy(db: Sessions) -> None:
    waits: list[float] = []

    async def sleep(seconds: float) -> None:
        waits.append(seconds)

    model = FakeChatModel(ModelBusyError("429"), ModelReply("NO_ANSWER", 10, 1))
    lines: list[str] = []
    failed = await run_eval(
        chat(db, model), {"answerable": [], "refuse": ["Poem?"]}, sleep=sleep, out=lines.append
    )
    assert failed == 0 and waits == [30.0]
    assert lines[-1] == "1/1 passed"


def test_reindex_without_directus_token_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API_DIRECTUS_TOKEN", "")
    assert main(["reindex"]) == 1


def test_chat_eval_without_groq_key_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API_GROQ_API_KEY", "")
    assert main(["chat-eval"]) == 1


def test_judge_ignores_unicode_hyphens_and_spaces() -> None:
    case = {"question": "q", "must_include": ["UNSW-NB15", "May 2027"], "sources": ["/p"]}
    answer = composed("Uses UNSW\u2011NB15, ends May\u202f2027 [1].", ChatOutcome.answered, "/p")
    assert judge_answerable(case, answer) is None


def test_reindex_directus_failure_is_one_line_and_exit_1(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("API_DIRECTUS_TOKEN", "tok")
    monkeypatch.setenv("API_DIRECTUS_URL", "http://127.0.0.1:1")
    monkeypatch.setenv("API_DATABASE_URL", "postgresql+asyncpg://nobody:nobody@127.0.0.1:1/x")
    assert main(["reindex"]) == 1
    err = capsys.readouterr().err
    assert err.startswith("reindex failed: ") and err.count("\n") == 1
    assert "Traceback" not in err
