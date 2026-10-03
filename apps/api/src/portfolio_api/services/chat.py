import hashlib
import hmac
import time
import uuid
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.clients.directus import ChatSettings, DirectusError
from portfolio_api.clients.groq import ChatModel, ModelBusyError, ModelUnavailableError
from portfolio_api.models import ChatOutcome
from portfolio_api.rag.retrieval import Retrieved
from portfolio_api.repositories import chat as repo
from portfolio_api.services.grounding import (
    CANNED_ANSWER,
    CONTACT_SOURCE,
    HISTORY_PAIRS,
    Exchange,
    Source,
    build_messages,
    cited_sources,
)

log = structlog.get_logger()

MAX_QUESTIONS = 10
SESSION_MAX_AGE = timedelta(hours=2)
RETENTION = timedelta(days=30)
USAGE_RETENTION = timedelta(days=90)


class SessionNotFoundError(Exception):
    """Unknown, expired, or opened from another IP."""


class SessionLimitError(Exception):
    """The session has used all its questions."""


class BudgetExhaustedError(Exception):
    """Today's site-wide token budget is spent."""


class SearchesIndex(Protocol):
    async def search(self, question: str) -> Retrieved: ...


class ChatSettingsSource(Protocol):
    async def fetch_chat_settings(self) -> ChatSettings: ...


@dataclass(frozen=True)
class Composed:
    answer: str  # what the visitor sees
    sources: list[Source]
    outcome: ChatOutcome
    raw: str | None  # the model's own text, kept for review (None when it was not called)
    input_tokens: int
    output_tokens: int


@dataclass(frozen=True)
class ChatAnswer:
    answer: str
    sources: list[Source]
    outcome: ChatOutcome
    questions_left: int


def _utcnow() -> datetime:
    return datetime.now(UTC)


class ChatSwitch:
    """chat_settings.enabled from Directus, read at most once per ``ttl`` seconds."""

    def __init__(
        self,
        source: ChatSettingsSource,
        *,
        ttl: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._source = source
        self._ttl = ttl
        self._clock = clock
        self._value = True  # until Directus says otherwise; limits and budget still apply
        self._checked_at: float | None = None

    async def enabled(self) -> bool:
        now = self._clock()
        if self._checked_at is not None and now - self._checked_at < self._ttl:
            return self._value
        self._checked_at = now
        try:
            self._value = (await self._source.fetch_chat_settings()).enabled
        except DirectusError as exc:
            log.warning("chat settings unavailable; keeping last value", error=str(exc))
        return self._value


class ChatService:
    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        retriever: SearchesIndex,
        model: ChatModel,
        *,
        hash_salt: str,
        daily_budget: int,
        min_similarity: float,
        clock: Callable[[], datetime] = _utcnow,
    ) -> None:
        self._sessions = sessions
        self._retriever = retriever
        self._model = model
        self._salt = hash_salt.encode()
        self._daily_budget = daily_budget
        self._min_similarity = min_similarity
        self._clock = clock

    def ip_hash(self, ip: str) -> str:
        return hmac.new(self._salt, ip.encode(), hashlib.sha256).hexdigest()

    async def open_session(self, ip: str) -> tuple[uuid.UUID, int]:
        async with self._sessions.begin() as session:
            session_id = await repo.create_session(session, self.ip_hash(ip))
        return session_id, MAX_QUESTIONS

    async def compose(self, question: str, history: Sequence[Exchange]) -> Composed:
        """Retrieve, ask the model, check citations. Raises the model's errors."""
        retrieved = await self._retriever.search(question)
        if not retrieved.hits or retrieved.best_similarity < self._min_similarity:
            return Composed(CANNED_ANSWER, [CONTACT_SOURCE], ChatOutcome.no_match, None, 0, 0)
        reply = await self._model.complete(build_messages(question, retrieved.hits, history))
        sources = cited_sources(reply.text, retrieved.hits)
        if sources is None:
            return Composed(
                CANNED_ANSWER,
                [CONTACT_SOURCE],
                ChatOutcome.uncited,
                reply.text,
                reply.input_tokens,
                reply.output_tokens,
            )
        return Composed(
            reply.text,
            sources,
            ChatOutcome.answered,
            reply.text,
            reply.input_tokens,
            reply.output_tokens,
        )

    async def record_usage(self, tokens: int) -> None:
        async with self._sessions.begin() as session:
            await repo.add_usage(session, self._clock().date(), tokens)

    async def ask(self, session_id: uuid.UUID, ip: str, question: str) -> ChatAnswer:
        now = self._clock()
        async with self._sessions() as session:
            row = await repo.get_session(session, session_id)
            if (
                row is None
                or not hmac.compare_digest(row.ip_hash, self.ip_hash(ip))
                or now - row.created_at > SESSION_MAX_AGE
            ):
                raise SessionNotFoundError
            if row.question_count >= MAX_QUESTIONS:
                raise SessionLimitError
            used = await repo.tokens_used(session, now.date())
            pairs = await repo.recent_exchanges(session, session_id, HISTORY_PAIRS)
        if used >= self._daily_budget:
            raise BudgetExhaustedError
        try:
            composed = await self.compose(question, [Exchange(q, a) for q, a in pairs])
        except (ModelBusyError, ModelUnavailableError) as exc:
            log.warning("chat model failed", error=str(exc))
            async with self._sessions.begin() as session:
                await repo.record_message(
                    session,
                    session_id=session_id,
                    question=question,
                    answer=None,
                    outcome=ChatOutcome.error,
                    sources=[],
                    input_tokens=0,
                    output_tokens=0,
                    counts=False,
                )
            raise
        counts = composed.outcome == ChatOutcome.answered
        async with self._sessions.begin() as session:
            await repo.record_message(
                session,
                session_id=session_id,
                question=question,
                answer=composed.raw if composed.outcome == ChatOutcome.uncited else composed.answer,
                outcome=composed.outcome,
                sources=[asdict(s) for s in composed.sources],
                input_tokens=composed.input_tokens,
                output_tokens=composed.output_tokens,
                counts=counts,
            )
            if composed.raw is not None:  # the model was called
                await repo.add_usage(
                    session, now.date(), composed.input_tokens + composed.output_tokens
                )
        left = MAX_QUESTIONS - row.question_count - (1 if counts else 0)
        return ChatAnswer(composed.answer, composed.sources, composed.outcome, left)

    async def purge_expired(self) -> None:
        now = self._clock()
        async with self._sessions.begin() as session:
            await repo.purge(
                session,
                sessions_before=now - RETENTION,
                usage_before=(now - USAGE_RETENTION).date(),
            )
