import enum
import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Integer, String, Text, func, text
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


class ChatUsageDaily(Base):
    """Model tokens and calls per UTC day, for the daily budget gate."""

    __tablename__ = "chat_usage_daily"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    tokens: Mapped[int] = mapped_column(Integer, server_default="0")
    requests: Mapped[int] = mapped_column(Integer, server_default="0")
