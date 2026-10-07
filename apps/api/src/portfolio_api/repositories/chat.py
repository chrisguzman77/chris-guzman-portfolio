import uuid
from collections.abc import Sequence
from datetime import date, datetime
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from portfolio_api.models import ChatMessage, ChatOutcome, ChatSession, ChatUsageDaily


async def create_session(session: AsyncSession, ip_hash: str) -> uuid.UUID:
    row = ChatSession(ip_hash=ip_hash)
    session.add(row)
    await session.flush()
    return row.id


async def get_session(session: AsyncSession, session_id: uuid.UUID) -> ChatSession | None:
    return await session.get(ChatSession, session_id)


async def recent_exchanges(
    session: AsyncSession, session_id: uuid.UUID, limit: int
) -> list[tuple[str, str]]:
    """The last ``limit`` answered (question, answer) pairs, oldest first."""
    rows = (
        await session.execute(
            select(ChatMessage.question, ChatMessage.answer)
            .where(
                ChatMessage.session_id == session_id,
                ChatMessage.outcome == ChatOutcome.answered,
            )
            .order_by(ChatMessage.id.desc())
            .limit(limit)
        )
    ).all()
    return [(q, a or "") for q, a in reversed(rows)]


async def reserve_question(session: AsyncSession, session_id: uuid.UUID, cap: int) -> int | None:
    """Count one question if fewer than ``cap`` are used; the new count, or None if at the cap.

    A single conditional UPDATE, so concurrent asks on one session cannot both take the last one.
    """
    return await session.scalar(
        update(ChatSession)
        .where(ChatSession.id == session_id, ChatSession.question_count < cap)
        .values(question_count=ChatSession.question_count + 1)
        .returning(ChatSession.question_count)
    )


async def release_question(session: AsyncSession, session_id: uuid.UUID) -> None:
    """Give back a reserved question (the ask did not end in a counted answer)."""
    await session.execute(
        update(ChatSession)
        .where(ChatSession.id == session_id, ChatSession.question_count > 0)
        .values(question_count=ChatSession.question_count - 1)
    )


async def record_message(
    session: AsyncSession,
    *,
    session_id: uuid.UUID,
    question: str,
    answer: str | None,
    outcome: ChatOutcome,
    sources: Sequence[dict[str, Any]],
    input_tokens: int,
    output_tokens: int,
) -> None:
    session.add(
        ChatMessage(
            session_id=session_id,
            question=question,
            answer=answer,
            outcome=outcome,
            sources=list(sources),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
    )
    await session.flush()


async def tokens_used(session: AsyncSession, day: date) -> int:
    used = await session.scalar(select(ChatUsageDaily.tokens).where(ChatUsageDaily.day == day))
    return used or 0


async def add_usage(session: AsyncSession, day: date, tokens: int) -> None:
    stmt = insert(ChatUsageDaily).values(day=day, tokens=tokens, requests=1)
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=[ChatUsageDaily.day],
            set_={
                "tokens": ChatUsageDaily.tokens + stmt.excluded.tokens,
                "requests": ChatUsageDaily.requests + 1,
            },
        )
    )


async def purge(session: AsyncSession, *, sessions_before: datetime, usage_before: date) -> None:
    await session.execute(delete(ChatSession).where(ChatSession.created_at < sessions_before))
    await session.execute(delete(ChatUsageDaily).where(ChatUsageDaily.day < usage_before))


async def sessions_since(
    session: AsyncSession, since: datetime
) -> list[tuple[ChatSession, list[ChatMessage]]]:
    """Sessions created since ``since``, newest first, each with its messages in order."""
    sessions = list(
        (
            await session.scalars(
                select(ChatSession)
                .where(ChatSession.created_at >= since)
                .order_by(ChatSession.created_at.desc())
            )
        ).all()
    )
    if not sessions:
        return []
    by_session: dict[uuid.UUID, list[ChatMessage]] = {s.id: [] for s in sessions}
    rows = await session.scalars(
        select(ChatMessage)
        .where(ChatMessage.session_id.in_(list(by_session)))
        .order_by(ChatMessage.id)
    )
    for message in rows:
        by_session[message.session_id].append(message)
    return [(s, by_session[s.id]) for s in sessions]
