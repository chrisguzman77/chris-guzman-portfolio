import uuid
from datetime import timedelta

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from portfolio_api.models import ContactSubmission, EmailStatus

RETRY_AFTER = timedelta(minutes=5)
MAX_ATTEMPTS = 5


async def create(session: AsyncSession, *, name: str, email: str, message: str) -> uuid.UUID:
    row = ContactSubmission(name=name, email=email, message=message)
    session.add(row)
    await session.flush()
    return row.id


async def get(session: AsyncSession, submission_id: uuid.UUID) -> ContactSubmission | None:
    return await session.get(ContactSubmission, submission_id)


async def record_sent(session: AsyncSession, submission_id: uuid.UUID) -> None:
    await session.execute(
        update(ContactSubmission)
        .where(ContactSubmission.id == submission_id)
        .values(
            email_status=EmailStatus.sent,
            attempts=ContactSubmission.attempts + 1,
            last_error=None,
            sent_at=func.now(),
            updated_at=func.now(),
        )
    )


async def record_failure(session: AsyncSession, submission_id: uuid.UUID, error: str) -> int:
    """Mark the row failed and return its attempt count after this failure."""
    result = await session.execute(
        update(ContactSubmission)
        .where(ContactSubmission.id == submission_id)
        .values(
            email_status=EmailStatus.failed,
            attempts=ContactSubmission.attempts + 1,
            last_error=error[:500],
            updated_at=func.now(),
        )
        .returning(ContactSubmission.attempts)
    )
    return result.scalar_one()


async def due_for_retry(session: AsyncSession, *, limit: int = 20) -> list[uuid.UUID]:
    """Unsent rows untouched for RETRY_AFTER (failed, or pending from a send that died).

    Compared against the database clock, the same clock that wrote updated_at.
    """
    stmt = (
        select(ContactSubmission.id)
        .where(
            ContactSubmission.email_status.in_([EmailStatus.pending, EmailStatus.failed]),
            ContactSubmission.attempts < MAX_ATTEMPTS,
            ContactSubmission.updated_at <= func.now() - RETRY_AFTER,
        )
        .order_by(ContactSubmission.created_at)
        .limit(limit)
    )
    return list((await session.scalars(stmt)).all())
