import hashlib
import hmac
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.clients.directus import ChatSettings, DirectusError
from portfolio_api.clients.groq import ModelBusyError, ModelReply, ModelUnavailableError
from portfolio_api.models import ChatMessage, ChatOutcome, ChatSession, ChatUsageDaily
from portfolio_api.rag.retrieval import Retrieved
from portfolio_api.services.chat import (
    MAX_QUESTIONS,
    BudgetExhaustedError,
    ChatService,
    ChatSwitch,
    SearchesIndex,
    SessionLimitError,
    SessionNotFoundError,
)
from portfolio_api.services.grounding import CANNED_ANSWER, CONTACT_SOURCE, Source
from tests.fakes import HIT, FakeChatModel, FakeChatSettingsSource, FakeRetriever

Sessions = async_sessionmaker[AsyncSession]
IP = "203.0.113.7"


def service(
    db: Sessions,
    model: FakeChatModel | None = None,
    retriever: SearchesIndex | None = None,
    clock: datetime | None = None,
) -> ChatService:
    return ChatService(
        db,
        retriever or FakeRetriever(),
        model or FakeChatModel(),
        hash_salt="salt",
        daily_budget=180_000,
        min_similarity=0.5,
        clock=(lambda: clock) if clock else (lambda: datetime.now(UTC)),
    )


async def messages(db: Sessions) -> list[ChatMessage]:
    async with db() as session:
        return list((await session.scalars(select(ChatMessage).order_by(ChatMessage.id))).all())


async def usage(db: Sessions) -> ChatUsageDaily | None:
    async with db() as session:
        return await session.get(ChatUsageDaily, datetime.now(UTC).date())


async def test_open_session_stores_only_an_ip_hash(db: Sessions) -> None:
    chat = service(db)
    session_id, left = await chat.open_session(IP)
    assert left == MAX_QUESTIONS
    async with db() as session:
        row = await session.get(ChatSession, session_id)
    assert row is not None
    assert row.ip_hash == hmac.new(b"salt", IP.encode(), hashlib.sha256).hexdigest()
    assert IP not in row.ip_hash


async def test_answered_question(db: Sessions) -> None:
    model = FakeChatModel()
    chat = service(db, model)
    session_id, _ = await chat.open_session(IP)
    answer = await chat.ask(session_id, IP, "Has he used FastAPI?")
    assert answer.answer == "He built it with FastAPI [1]."
    assert answer.sources == [Source(1, HIT.title, HIT.url)]
    assert answer.outcome == ChatOutcome.answered
    assert answer.questions_left == MAX_QUESTIONS - 1
    [msg] = await messages(db)
    assert msg.outcome == ChatOutcome.answered and msg.answer == answer.answer
    assert msg.sources == [{"n": 1, "title": HIT.title, "url": HIT.url}]
    assert (msg.input_tokens, msg.output_tokens) == (1000, 50)
    day = await usage(db)
    assert day is not None and (day.tokens, day.requests) == (1050, 1)


async def test_low_similarity_skips_the_model(db: Sessions) -> None:
    model = FakeChatModel()
    chat = service(db, model, FakeRetriever(best=0.3))
    session_id, _ = await chat.open_session(IP)
    answer = await chat.ask(session_id, IP, "Write me a poem")
    assert (answer.answer, answer.sources) == (CANNED_ANSWER, [CONTACT_SOURCE])
    assert answer.outcome == ChatOutcome.no_match
    assert answer.questions_left == MAX_QUESTIONS
    assert model.calls == []
    assert await usage(db) is None
    assert [m.outcome for m in await messages(db)] == [ChatOutcome.no_match]


async def test_empty_index_is_no_match(db: Sessions) -> None:
    chat = service(db, retriever=FakeRetriever(hits=[], best=0.0))
    session_id, _ = await chat.open_session(IP)
    assert (await chat.ask(session_id, IP, "Anything?")).outcome == ChatOutcome.no_match


async def test_uncited_reply_becomes_canned_but_keeps_raw_and_usage(db: Sessions) -> None:
    chat = service(db, FakeChatModel(ModelReply("He is great.", 900, 20)))
    session_id, _ = await chat.open_session(IP)
    answer = await chat.ask(session_id, IP, "Is he great?")
    assert answer.outcome == ChatOutcome.uncited
    assert (answer.answer, answer.sources) == (CANNED_ANSWER, [CONTACT_SOURCE])
    assert answer.questions_left == MAX_QUESTIONS
    [msg] = await messages(db)
    assert msg.answer == "He is great."
    day = await usage(db)
    assert day is not None and day.tokens == 920


async def test_session_must_exist_belong_to_ip_and_be_fresh(db: Sessions) -> None:
    chat = service(db)
    session_id, _ = await chat.open_session(IP)
    with pytest.raises(SessionNotFoundError):
        await chat.ask(uuid.uuid4(), IP, "q?")
    with pytest.raises(SessionNotFoundError):
        await chat.ask(session_id, "198.51.100.1", "q?")
    later = service(db, clock=datetime.now(UTC) + timedelta(hours=3))
    with pytest.raises(SessionNotFoundError):
        await later.ask(session_id, IP, "q?")


async def test_question_limit(db: Sessions) -> None:
    chat = service(db)
    session_id, _ = await chat.open_session(IP)
    async with db.begin() as session:
        await session.execute(
            update(ChatSession).where(ChatSession.id == session_id).values(question_count=10)
        )
    with pytest.raises(SessionLimitError):
        await chat.ask(session_id, IP, "q?")


async def test_budget_gate_runs_before_the_model(db: Sessions) -> None:
    model = FakeChatModel()
    chat = service(db, model)
    session_id, _ = await chat.open_session(IP)
    async with db.begin() as session:
        session.add(ChatUsageDaily(day=datetime.now(UTC).date(), tokens=180_000, requests=60))
    with pytest.raises(BudgetExhaustedError):
        await chat.ask(session_id, IP, "q?")
    assert model.calls == []


async def test_model_error_is_recorded_then_raised(db: Sessions) -> None:
    chat = service(db, FakeChatModel(ModelBusyError("groq 429")))
    session_id, _ = await chat.open_session(IP)
    with pytest.raises(ModelBusyError):
        await chat.ask(session_id, IP, "q?")
    [msg] = await messages(db)
    assert msg.outcome == ChatOutcome.error and msg.answer is None
    assert await usage(db) is None


class BrokenRetriever:
    async def search(self, question: str) -> Retrieved:
        raise RuntimeError("embedding model failed to load")


async def test_retriever_failure_is_recorded_and_becomes_model_unavailable(db: Sessions) -> None:
    chat = service(db, retriever=BrokenRetriever())
    session_id, _ = await chat.open_session(IP)
    with pytest.raises(ModelUnavailableError):
        await chat.ask(session_id, IP, "q?")
    [msg] = await messages(db)
    assert msg.outcome == ChatOutcome.error and msg.answer is None
    assert await usage(db) is None


async def test_history_reaches_the_model(db: Sessions) -> None:
    model = FakeChatModel()
    chat = service(db, model)
    session_id, _ = await chat.open_session(IP)
    await chat.ask(session_id, IP, "First?")
    await chat.ask(session_id, IP, "Second?")
    second = model.calls[1]
    assert [t.content for t in second[1:3]] == ["First?", "He built it with FastAPI."]


async def test_purge_expired(db: Sessions) -> None:
    chat = service(db)
    old_id, _ = await chat.open_session(IP)
    new_id, _ = await chat.open_session(IP)
    today = datetime.now(UTC).date()
    async with db.begin() as session:
        await session.execute(
            update(ChatSession)
            .where(ChatSession.id == old_id)
            .values(created_at=datetime.now(UTC) - timedelta(days=31))
        )
        session.add(ChatUsageDaily(day=today - timedelta(days=91), tokens=1, requests=1))
        session.add(ChatUsageDaily(day=today, tokens=1, requests=1))
    await chat.purge_expired()
    async with db() as session:
        assert await session.get(ChatSession, old_id) is None
        assert await session.get(ChatSession, new_id) is not None
        days = set((await session.scalars(select(ChatUsageDaily.day))).all())
    assert days == {today}


async def test_switch_caches_and_survives_directus_errors() -> None:
    now = [0.0]
    source = FakeChatSettingsSource(ChatSettings(enabled=False, suggested_questions=[]))
    switch = ChatSwitch(source, ttl=60.0, clock=lambda: now[0])
    assert await switch.enabled() is False
    assert await switch.enabled() is False
    assert source.calls == 1
    now[0] = 61.0
    source.result = DirectusError("down")
    assert await switch.enabled() is False  # last known value
    assert source.calls == 2


async def test_switch_defaults_to_enabled() -> None:
    switch = ChatSwitch(FakeChatSettingsSource(DirectusError("down")))
    assert await switch.enabled() is True
