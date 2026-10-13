import asyncio
import hashlib
import hmac
import uuid
from collections.abc import AsyncGenerator, Collection, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from typing import cast

import pytest
from sqlalchemy import event, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from structlog.testing import capture_logs

from portfolio_api.clients.directus import ChatSettings, DirectusError
from portfolio_api.clients.groq import ChatTurn, ModelBusyError, ModelReply, ModelUnavailableError
from portfolio_api.models import (
    ChatFeedback,
    ChatMessage,
    ChatOutcome,
    ChatSession,
    ChatUsageDaily,
)
from portfolio_api.rag.retrieval import Retrieved
from portfolio_api.repositories import chat as chat_repo
from portfolio_api.services.chat import (
    MAX_QUESTIONS,
    BudgetExhaustedError,
    ChatService,
    ChatSwitch,
    MessageNotFoundError,
    SearchesIndex,
    SessionLimitError,
    SessionNotFoundError,
    purge_expired_chats,
)
from portfolio_api.services.grounding import CANARY, CANNED_ANSWER, CONTACT_SOURCE, Source
from tests.fakes import HIT, FakeChatModel, FakeChatSettingsSource, FakeRetriever, metric

Sessions = async_sessionmaker[AsyncSession]
IP = "203.0.113.7"


def service(
    db: Sessions,
    model: FakeChatModel | None = None,
    retriever: SearchesIndex | None = None,
    clock: datetime | None = None,
    link_hosts: Collection[str] = (),
) -> ChatService:
    return ChatService(
        db,
        retriever or FakeRetriever(),
        model or FakeChatModel(),
        hash_salt="salt",
        daily_budget=180_000,
        min_similarity=0.5,
        link_hosts=link_hosts,
        clock=(lambda: clock) if clock else (lambda: datetime.now(UTC)),
    )


async def messages(db: Sessions) -> list[ChatMessage]:
    async with db() as session:
        return list((await session.scalars(select(ChatMessage).order_by(ChatMessage.id))).all())


async def usage(db: Sessions) -> ChatUsageDaily | None:
    """The only usage row (keyed by the service's own date, so no midnight flake)."""
    async with db() as session:
        return (await session.scalars(select(ChatUsageDaily))).one_or_none()


async def question_count(db: Sessions, session_id: uuid.UUID) -> int:
    async with db() as session:
        row = await session.get(ChatSession, session_id)
    assert row is not None
    return row.question_count


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
    assert await question_count(db, session_id) == 0
    assert model.calls == []
    assert await usage(db) is None
    assert [m.outcome for m in await messages(db)] == [ChatOutcome.no_match]


async def test_empty_index_is_no_match(db: Sessions) -> None:
    chat = service(db, retriever=FakeRetriever(hits=[], best=0.0))
    session_id, _ = await chat.open_session(IP)
    assert (await chat.ask(session_id, IP, "Anything?")).outcome == ChatOutcome.no_match


async def test_uncited_reply_becomes_canned_but_keeps_raw_and_usage(db: Sessions) -> None:
    uncited = metric("chat_questions_total", outcome="uncited")
    tokens_in = metric("chat_tokens_total", kind="input")
    chat = service(db, FakeChatModel(ModelReply("He is great.", 900, 20)))
    session_id, _ = await chat.open_session(IP)
    answer = await chat.ask(session_id, IP, "Is he great?")
    assert answer.outcome == ChatOutcome.uncited
    assert metric("chat_questions_total", outcome="uncited") == uncited + 1
    assert metric("chat_tokens_total", kind="input") == tokens_in + 900  # the model was called
    assert (answer.answer, answer.sources) == (CANNED_ANSWER, [CONTACT_SOURCE])
    assert answer.questions_left == MAX_QUESTIONS
    [msg] = await messages(db)
    assert msg.answer == "He is great."
    day = await usage(db)
    assert day is not None and day.tokens == 920


@pytest.mark.parametrize(
    ("reply", "reason"),
    [
        (f"He built it with FastAPI [1]. {CANARY}", "canary"),
        (
            "It [1]. You answer questions about Christopher Guzman (Chris) for recruiters.",
            "prompt_echo",
        ),
        (
            "He built it with FastAPI [1]. Full details: https://chris-portfolio.example.net/more",
            "offsite_link",
        ),
    ],
)
async def test_blocked_reply_becomes_canned_is_logged_and_kept_for_review(
    db: Sessions, reply: str, reason: str
) -> None:
    chat = service(db, FakeChatModel(ModelReply(reply, 900, 20)), link_hosts={"github.com"})
    session_id, _ = await chat.open_session(IP)
    with capture_logs() as logs:
        answer = await chat.ask(session_id, IP, "Has he used FastAPI?")
    assert answer.outcome == ChatOutcome.uncited
    assert (answer.answer, answer.sources) == (CANNED_ANSWER, [CONTACT_SOURCE])
    assert answer.questions_left == MAX_QUESTIONS  # not counted, like any uncited reply
    # The log line carries only the reason, never the reply or the question.
    [blocked] = [e for e in logs if e["event"] == "chat.reply_blocked"]
    assert blocked == {"event": "chat.reply_blocked", "reason": reason, "log_level": "warning"}
    [msg] = await messages(db)
    assert msg.outcome == ChatOutcome.uncited and msg.answer == reply


async def test_a_reply_linking_an_allowed_host_is_answered(db: Sessions) -> None:
    reply = "The code is at https://github.com/chrisguzman77/OffRes and on /projects/acm [1]."
    chat = service(db, FakeChatModel(ModelReply(reply, 900, 20)), link_hosts={"github.com"})
    session_id, _ = await chat.open_session(IP)
    with capture_logs() as logs:
        answer = await chat.ask(session_id, IP, "Where is the code?")
    assert (answer.outcome, answer.answer) == (ChatOutcome.answered, reply)
    assert [e for e in logs if e["event"] == "chat.reply_blocked"] == []


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
    rejected = metric("chat_questions_total", outcome="rejected")
    with pytest.raises(SessionLimitError):
        await chat.ask(session_id, IP, "q?")
    assert metric("chat_questions_total", outcome="rejected") == rejected + 1


async def test_budget_gate_runs_before_the_model(db: Sessions) -> None:
    now = datetime.now(UTC)
    model = FakeChatModel()
    chat = service(db, model, clock=now)
    session_id, _ = await chat.open_session(IP)
    async with db.begin() as session:
        session.add(ChatUsageDaily(day=now.date(), tokens=180_000, requests=60))
    rejected = metric("chat_questions_total", outcome="rejected")
    with pytest.raises(BudgetExhaustedError):
        await chat.ask(session_id, IP, "q?")
    assert metric("chat_questions_total", outcome="rejected") == rejected + 1
    assert model.calls == []
    assert await question_count(db, session_id) == 0


class GatedModel:
    """Answers with a citation, but only once ``gate`` is set."""

    def __init__(self) -> None:
        self.gate = asyncio.Event()
        self.entered = asyncio.Event()
        self.calls = 0

    async def complete(self, messages: Sequence[ChatTurn]) -> ModelReply:
        self.calls += 1
        self.entered.set()
        await self.gate.wait()
        return ModelReply("He built it with FastAPI [1].", 1000, 50)


async def test_concurrent_asks_cannot_overspend_the_last_question(db: Sessions) -> None:
    model = GatedModel()
    chat = ChatService(
        db, FakeRetriever(), model, hash_salt="salt", daily_budget=180_000, min_similarity=0.5
    )
    session_id, _ = await chat.open_session(IP)
    async with db.begin() as session:
        await session.execute(
            update(ChatSession)
            .where(ChatSession.id == session_id)
            .values(question_count=MAX_QUESTIONS - 1)
        )
    first = asyncio.create_task(chat.ask(session_id, IP, "q1?"))
    second = asyncio.create_task(chat.ask(session_id, IP, "q2?"))
    # One ask holds the last question inside the model; the other must fail without waiting.
    done, _ = await asyncio.wait({first, second}, timeout=5, return_when=asyncio.FIRST_COMPLETED)
    assert done, "neither ask finished: the losing ask waited on the winner"
    model.gate.set()
    results = await asyncio.gather(first, second, return_exceptions=True)
    assert sorted(type(r).__name__ for r in results) == ["ChatAnswer", "SessionLimitError"]
    assert model.calls == 1
    assert await question_count(db, session_id) == MAX_QUESTIONS


async def test_model_error_is_recorded_then_raised(db: Sessions) -> None:
    chat = service(db, FakeChatModel(ModelBusyError("groq 429")))
    session_id, _ = await chat.open_session(IP)
    with pytest.raises(ModelBusyError):
        await chat.ask(session_id, IP, "q?")
    [msg] = await messages(db)
    assert msg.outcome == ChatOutcome.error and msg.answer is None
    assert await usage(db) is None
    assert await question_count(db, session_id) == 0  # the reserved question is given back


class CommitFails:
    """A sessionmaker whose transactions fail once ``broken`` is set."""

    def __init__(self, real: Sessions) -> None:
        self.real = real
        self.broken = False

    def __call__(self) -> AsyncSession:
        session = self.real()
        event.listen(session.sync_session, "before_commit", self.check)
        return session

    def check(self, _: object) -> None:
        if self.broken:
            raise SQLAlchemyError("commit failed")

    @asynccontextmanager
    async def begin(self) -> AsyncGenerator[AsyncSession]:
        async with self() as session, session.begin():
            yield session


class BusyAndBreaksTheDatabase:
    def __init__(self, sessions: CommitFails) -> None:
        self.sessions = sessions

    async def complete(self, messages: Sequence[ChatTurn]) -> ModelReply:
        self.sessions.broken = True
        raise ModelBusyError("groq 429")


async def test_model_error_is_not_masked_by_a_failing_error_record(db: Sessions) -> None:
    sessions = CommitFails(db)
    chat = ChatService(
        cast(Sessions, sessions),
        FakeRetriever(),
        BusyAndBreaksTheDatabase(sessions),
        hash_salt="salt",
        daily_budget=180_000,
        min_similarity=0.5,
    )
    session_id, _ = await chat.open_session(IP)
    with capture_logs() as logs, pytest.raises(ModelBusyError):
        await chat.ask(session_id, IP, "q?")
    [failure] = [e for e in logs if e["event"] == "could not record chat error"]
    assert failure["log_level"] == "error" and failure["exc_info"]
    assert await messages(db) == []  # the error row was rolled back


class Crashes:
    async def complete(self, messages: Sequence[ChatTurn]) -> ModelReply:
        raise RuntimeError("unexpected bug")


async def test_unexpected_error_gives_the_question_back(db: Sessions) -> None:
    chat = ChatService(
        db, FakeRetriever(), Crashes(), hash_salt="salt", daily_budget=180_000, min_similarity=0.5
    )
    session_id, _ = await chat.open_session(IP)
    with pytest.raises(RuntimeError):
        await chat.ask(session_id, IP, "q?")
    assert await question_count(db, session_id) == 0


class CommitFailsOnce(CommitFails):
    def check(self, _: object) -> None:
        if self.broken:
            self.broken = False
            raise SQLAlchemyError("commit failed")


class AnswersAndBreaksTheDatabase:
    def __init__(self, sessions: CommitFails) -> None:
        self.sessions = sessions

    async def complete(self, messages: Sequence[ChatTurn]) -> ModelReply:
        self.sessions.broken = True
        return ModelReply("He built it with FastAPI [1].", 1000, 50)


async def test_failed_answer_commit_gives_the_question_back(db: Sessions) -> None:
    sessions = CommitFailsOnce(db)
    chat = ChatService(
        cast(Sessions, sessions),
        FakeRetriever(),
        AnswersAndBreaksTheDatabase(sessions),
        hash_salt="salt",
        daily_budget=180_000,
        min_similarity=0.5,
    )
    session_id, _ = await chat.open_session(IP)
    with pytest.raises(SQLAlchemyError):
        await chat.ask(session_id, IP, "q?")
    assert await messages(db) == []
    assert await question_count(db, session_id) == 0


async def test_cancelled_ask_gives_the_question_back(db: Sessions) -> None:
    model = GatedModel()  # never opened: the ask waits in the model until cancelled
    chat = ChatService(
        db, FakeRetriever(), model, hash_salt="salt", daily_budget=180_000, min_similarity=0.5
    )
    session_id, _ = await chat.open_session(IP)
    task = asyncio.create_task(chat.ask(session_id, IP, "q?"))
    await asyncio.wait_for(model.entered.wait(), timeout=5)
    assert await question_count(db, session_id) == 1
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert await question_count(db, session_id) == 0


async def test_release_survives_a_second_cancel(
    db: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = GatedModel()
    chat = ChatService(
        db, FakeRetriever(), model, hash_salt="salt", daily_budget=180_000, min_similarity=0.5
    )
    session_id, _ = await chat.open_session(IP)
    entered, gate, released = asyncio.Event(), asyncio.Event(), asyncio.Event()
    real_release = chat_repo.release_question

    async def slow_release(session: AsyncSession, sid: uuid.UUID) -> None:
        entered.set()
        await gate.wait()
        await real_release(session, sid)
        released.set()

    monkeypatch.setattr(chat_repo, "release_question", slow_release)
    task = asyncio.create_task(chat.ask(session_id, IP, "q?"))
    await asyncio.wait_for(model.entered.wait(), timeout=5)
    task.cancel()  # first cancel: the refund starts
    await asyncio.wait_for(entered.wait(), timeout=5)
    task.cancel()  # second cancel while the refund is running
    gate.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    await asyncio.wait_for(released.wait(), timeout=5)
    # `released` is set before the shielded refund transaction commits, and the cancelled ask no
    # longer awaits it: poll for the committed result instead of reading once.
    async with asyncio.timeout(5):
        while await question_count(db, session_id) != 0:  # noqa: ASYNC110 - polling the database
            await asyncio.sleep(0.01)
    assert await question_count(db, session_id) == 0


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


async def test_purge_expired_chats(db: Sessions) -> None:
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
    await purge_expired_chats(db)
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


async def test_full_width_citations_count_and_are_shown_as_brackets(db: Sessions) -> None:
    chat = service(db, FakeChatModel(ModelReply("He studies Computer Science【1】.", 900, 20)))
    session_id, _ = await chat.open_session(IP)
    answer = await chat.ask(session_id, IP, "What does he study?")
    assert answer.outcome == ChatOutcome.answered
    assert answer.answer == "He studies Computer Science[1]."
    assert answer.sources == [Source(1, HIT.title, HIT.url)]


async def test_questions_tokens_and_budget_are_measured(db: Sessions) -> None:
    answered = metric("chat_questions_total", outcome="answered")
    no_match = metric("chat_questions_total", outcome="no_match")
    tokens_in = metric("chat_tokens_total", kind="input")
    tokens_out = metric("chat_tokens_total", kind="output")
    chat = service(db)
    session_id, _ = await chat.open_session(IP)
    await chat.ask(session_id, IP, "Has he used FastAPI?")
    assert metric("chat_questions_total", outcome="answered") == answered + 1
    assert metric("chat_tokens_total", kind="input") == tokens_in + 1000
    assert metric("chat_tokens_total", kind="output") == tokens_out + 50
    assert metric("chat_budget_used_ratio") == pytest.approx(1050 / 180_000)

    unmatched = service(db, retriever=FakeRetriever(best=0.1))
    session_id, _ = await unmatched.open_session(IP)
    await unmatched.ask(session_id, IP, "Unrelated?")
    assert metric("chat_questions_total", outcome="no_match") == no_match + 1
    assert metric("chat_tokens_total", kind="input") == tokens_in + 1000  # model not called


async def test_model_errors_are_measured(db: Sessions) -> None:
    errors = metric("chat_questions_total", outcome="error")
    chat = service(db, FakeChatModel(ModelUnavailableError("groq 500")))
    session_id, _ = await chat.open_session(IP)
    with pytest.raises(ModelUnavailableError):
        await chat.ask(session_id, IP, "q?")
    assert metric("chat_questions_total", outcome="error") == errors + 1


async def test_answer_time_is_measured_by_outcome(db: Sessions) -> None:
    answered = metric("chat_answer_seconds_count", outcome="answered")
    no_match = metric("chat_answer_seconds_count", outcome="no_match")
    errors = metric("chat_answer_seconds_count", outcome="error")
    chat = service(db)
    session_id, _ = await chat.open_session(IP)
    await chat.ask(session_id, IP, "Has he used FastAPI?")
    assert metric("chat_answer_seconds_count", outcome="answered") == answered + 1

    unmatched = service(db, retriever=FakeRetriever(best=0.1))
    session_id, _ = await unmatched.open_session(IP)
    await unmatched.ask(session_id, IP, "Unrelated?")
    assert metric("chat_answer_seconds_count", outcome="no_match") == no_match + 1

    failing = service(db, FakeChatModel(ModelUnavailableError("groq 500")))
    session_id, _ = await failing.open_session(IP)
    with pytest.raises(ModelUnavailableError):
        await failing.ask(session_id, IP, "q?")
    assert metric("chat_answer_seconds_count", outcome="error") == errors + 1


async def test_budget_gauge_reads_todays_stored_usage(db: Sessions) -> None:
    now = datetime.now(UTC)
    async with db.begin() as session:
        session.add(ChatUsageDaily(day=now.date(), tokens=90_000, requests=10))
    await service(db, clock=now).refresh_budget_gauge()
    assert metric("chat_budget_used_ratio") == 0.5


async def rated(db: Sessions, message_id: int) -> ChatMessage:
    async with db() as session:
        row = await session.get(ChatMessage, message_id)
    assert row is not None
    return row


async def feedback_counts(db: Sessions) -> dict[date, tuple[int, int]]:
    """(feedback_up, feedback_down) for every usage day."""
    async with db() as session:
        rows = (await session.scalars(select(ChatUsageDaily))).all()
    return {r.day: (r.feedback_up, r.feedback_down) for r in rows}


@pytest.mark.parametrize(
    ("model", "retriever", "outcome"),
    [
        (FakeChatModel(), FakeRetriever(), ChatOutcome.answered),
        (FakeChatModel(), FakeRetriever(best=0.3), ChatOutcome.no_match),
        (FakeChatModel(ModelReply("He is great.", 900, 20)), FakeRetriever(), ChatOutcome.uncited),
    ],
)
async def test_every_answer_carries_its_message_id(
    db: Sessions, model: FakeChatModel, retriever: FakeRetriever, outcome: ChatOutcome
) -> None:
    chat = service(db, model, retriever)
    session_id, _ = await chat.open_session(IP)
    answer = await chat.ask(session_id, IP, "q?")
    [msg] = await messages(db)
    assert answer.outcome == outcome
    assert answer.message_id == msg.id


async def test_rating_is_stored_counted_and_measured(db: Sessions) -> None:
    now = datetime.now(UTC)
    chat = service(db, clock=now)
    session_id, _ = await chat.open_session(IP)
    answer = await chat.ask(session_id, IP, "Has he used FastAPI?")
    before = metric("chat_feedback_total", rating="down", outcome="answered")
    await chat.rate(session_id, answer.message_id, IP, ChatFeedback.down)
    msg = await rated(db, answer.message_id)
    assert (msg.feedback, msg.feedback_at) == (ChatFeedback.down, now)
    assert await feedback_counts(db) == {now.date(): (0, 1)}
    assert metric("chat_feedback_total", rating="down", outcome="answered") == before + 1
    assert await question_count(db, session_id) == 1  # rating does not use up a question


async def test_changing_a_rating_the_same_day_moves_the_count(db: Sessions) -> None:
    now = datetime.now(UTC)
    chat = service(db, clock=now)
    session_id, _ = await chat.open_session(IP)
    answer = await chat.ask(session_id, IP, "q?")
    up = metric("chat_feedback_total", rating="up", outcome="answered")
    await chat.rate(session_id, answer.message_id, IP, ChatFeedback.down)
    await chat.rate(session_id, answer.message_id, IP, ChatFeedback.up)
    assert (await rated(db, answer.message_id)).feedback == ChatFeedback.up
    assert await feedback_counts(db) == {now.date(): (1, 0)}
    assert metric("chat_feedback_total", rating="up", outcome="answered") == up + 1


async def test_repeating_a_rating_changes_nothing(db: Sessions) -> None:
    now = datetime.now(UTC)
    chat = service(db, clock=now)
    session_id, _ = await chat.open_session(IP)
    answer = await chat.ask(session_id, IP, "q?")
    down = metric("chat_feedback_total", rating="down", outcome="answered")
    await chat.rate(session_id, answer.message_id, IP, ChatFeedback.down)
    later = service(db, clock=now + timedelta(minutes=5))
    await later.rate(session_id, answer.message_id, IP, ChatFeedback.down)
    assert (await rated(db, answer.message_id)).feedback_at == now
    assert await feedback_counts(db) == {now.date(): (0, 1)}
    assert metric("chat_feedback_total", rating="down", outcome="answered") == down + 1


async def test_changing_a_rating_on_a_later_day_counts_only_today(db: Sessions) -> None:
    evening = datetime(2026, 10, 12, 23, 30, tzinfo=UTC)
    chat = service(db, clock=evening)
    session_id, _ = await chat.open_session(IP)
    async with db.begin() as session:  # opened just before the fake clock, so it is live
        await session.execute(
            update(ChatSession)
            .where(ChatSession.id == session_id)
            .values(created_at=evening - timedelta(minutes=1))
        )
    answer = await chat.ask(session_id, IP, "q?")
    await chat.rate(session_id, answer.message_id, IP, ChatFeedback.up)
    after_midnight = service(db, clock=evening + timedelta(hours=1))
    await after_midnight.rate(session_id, answer.message_id, IP, ChatFeedback.down)
    assert await feedback_counts(db) == {
        date(2026, 10, 12): (1, 0),
        date(2026, 10, 13): (0, 1),
    }


async def test_rating_needs_the_message_in_a_live_session_from_the_same_ip(db: Sessions) -> None:
    chat = service(db)
    session_id, _ = await chat.open_session(IP)
    other_session, _ = await chat.open_session(IP)
    answer = await chat.ask(session_id, IP, "q?")
    later = service(db, clock=datetime.now(UTC) + timedelta(hours=3))
    mid = answer.message_id
    for attempt in (
        lambda: chat.rate(other_session, mid, IP, ChatFeedback.down),  # another session
        lambda: chat.rate(session_id, mid, "198.51.100.1", ChatFeedback.down),  # other IP
        lambda: chat.rate(session_id, mid + 1000, IP, ChatFeedback.down),  # unknown message
        lambda: chat.rate(uuid.uuid4(), mid, IP, ChatFeedback.down),  # unknown session
        lambda: later.rate(session_id, mid, IP, ChatFeedback.down),  # expired session
    ):
        with pytest.raises(MessageNotFoundError):
            await attempt()
    assert (await rated(db, mid)).feedback is None
