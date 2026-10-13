import enum
import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Date, DateTime, Enum, Float, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from portfolio_api.models import Base


class ChatOutcome(enum.StrEnum):
    answered = "answered"
    no_match = "no_match"
    uncited = "uncited"
    error = "error"


def _outcome_values(e: type[ChatOutcome]) -> list[str]:
    return [m.value for m in e]


class ChatFeedback(enum.StrEnum):
    up = "up"
    down = "down"


def _feedback_values(e: type[ChatFeedback]) -> list[str]:
    return [m.value for m in e]


class ChatEvalKind(enum.StrEnum):
    answer = "answer"
    redteam = "redteam"


def _eval_kind_values(e: type[ChatEvalKind]) -> list[str]:
    return [m.value for m in e]


class ChatSession(Base):
    """One terminal session; bound to the visitor's IP hash, never the raw IP."""

    __tablename__ = "chat_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    ip_hash: Mapped[str] = mapped_column(String(64))
    question_count: Mapped[int] = mapped_column(Integer, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class ChatMessage(Base):
    """A question and what the chat did with it; kept 30 days with its session."""

    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="CASCADE"), index=True
    )
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str | None] = mapped_column(Text)
    outcome: Mapped[ChatOutcome] = mapped_column(
        Enum(ChatOutcome, name="chat_outcome", values_callable=_outcome_values)
    )
    sources: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    input_tokens: Mapped[int] = mapped_column(Integer, server_default="0")
    output_tokens: Mapped[int] = mapped_column(Integer, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # The visitor's rating of this reply; the last one wins. Deleted with the row.
    feedback: Mapped[ChatFeedback | None] = mapped_column(
        Enum(ChatFeedback, name="chat_feedback", values_callable=_feedback_values)
    )
    feedback_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ChatUsageDaily(Base):
    """Model tokens and calls per UTC day, for the daily budget gate, plus that day's ratings."""

    __tablename__ = "chat_usage_daily"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    tokens: Mapped[int] = mapped_column(Integer, server_default="0")
    requests: Mapped[int] = mapped_column(Integer, server_default="0")
    feedback_up: Mapped[int] = mapped_column(Integer, server_default="0")
    feedback_down: Mapped[int] = mapped_column(Integer, server_default="0")


class ChatEvalRun(Base):
    """One recorded chat-eval run (`portfolio-api chat-eval --record`); kept forever."""

    __tablename__ = "chat_eval_runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    kind: Mapped[ChatEvalKind] = mapped_column(
        Enum(ChatEvalKind, name="chat_eval_kind", values_callable=_eval_kind_values)
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    commit: Mapped[str | None] = mapped_column(Text)  # the image's git SHA, when known
    cases: Mapped[int] = mapped_column(Integer)
    passed: Mapped[int] = mapped_column(Integer)
    answer_pass_rate: Mapped[float | None] = mapped_column(Float)  # answerable cases only
    refusal_pass_rate: Mapped[float | None] = mapped_column(Float)  # refuse cases (answer kind)
    hit_at_5: Mapped[float | None] = mapped_column(Float)  # golden retrieval, live index
    mrr: Mapped[float | None] = mapped_column(Float)
    latency_p50_ms: Mapped[int] = mapped_column(Integer)  # per-case compose time
    latency_p95_ms: Mapped[int] = mapped_column(Integer)
    tokens_per_question: Mapped[float] = mapped_column(Float)
    # [{id, category, reason}] for each failed case, all taken from the eval files.
    failures: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
