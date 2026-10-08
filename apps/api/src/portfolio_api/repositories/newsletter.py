import enum
import uuid
from collections.abc import Sequence
from datetime import timedelta

from sqlalchemy import ColumnElement, func, literal, or_, select, update
from sqlalchemy import delete as sql_delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from portfolio_api.models import (
    NewsletterDelivery,
    NewsletterSend,
    NewsletterSubscriber,
    SubscriberStatus,
)

CONFIRM_TTL = timedelta(days=7)
RESEND_AFTER = timedelta(hours=1)

Sub = NewsletterSubscriber


class ConfirmResult(enum.Enum):
    invalid = "invalid"
    confirmed = "confirmed"
    already_confirmed = "already_confirmed"


async def claim_confirmation(session: AsyncSession, email: str, token_hash: str) -> bool:
    """True when a confirmation email should go out to ``email`` with this token.

    A new address becomes pending. A pending address whose last email is over an hour old
    gets this new token. A confirmed address, or one emailed within the hour, is untouched.
    One statement, so two concurrent requests cannot both send.
    """
    stmt = (
        insert(Sub)
        .values(email=email, confirm_token_hash=token_hash, confirm_sent_at=func.now())
        .on_conflict_do_update(
            index_elements=[Sub.email],
            set_={"confirm_token_hash": token_hash, "confirm_sent_at": func.now()},
            where=(Sub.status == SubscriberStatus.pending)
            & (Sub.confirm_sent_at <= func.now() - RESEND_AFTER),
        )
        .returning(Sub.id)
    )
    return (await session.execute(stmt)).first() is not None


async def confirm(session: AsyncSession, token_hash: str) -> ConfirmResult:
    """Confirm the subscriber holding this token. The hash is kept, so a second click is fine."""
    row = await session.scalar(
        select(Sub)
        .where(
            Sub.confirm_token_hash == token_hash,
            or_(
                Sub.status == SubscriberStatus.confirmed,
                Sub.confirm_sent_at > func.now() - CONFIRM_TTL,
            ),
        )
        .with_for_update()
    )
    if row is None:
        return ConfirmResult.invalid
    if row.status == SubscriberStatus.confirmed:
        return ConfirmResult.already_confirmed
    await session.execute(
        update(Sub)
        .where(Sub.id == row.id)
        .values(status=SubscriberStatus.confirmed, confirmed_at=func.now())
    )
    return ConfirmResult.confirmed


async def delete(session: AsyncSession, subscriber_id: uuid.UUID) -> bool:
    result = await session.execute(sql_delete(Sub).where(Sub.id == subscriber_id).returning(Sub.id))
    return result.first() is not None


async def purge_pending(session: AsyncSession) -> int:
    """Delete pending sign-ups whose confirmation email is over 7 days old."""
    result = await session.execute(
        sql_delete(Sub)
        .where(
            Sub.status == SubscriberStatus.pending,
            Sub.confirm_sent_at <= func.now() - CONFIRM_TTL,
        )
        .returning(Sub.id)
    )
    return len(result.all())


async def counts(session: AsyncSession) -> dict[SubscriberStatus, int]:
    rows = await session.execute(select(Sub.status, func.count()).group_by(Sub.status))
    found: dict[SubscriberStatus, int] = {status: n for status, n in rows.tuples()}
    return {status: found.get(status, 0) for status in SubscriberStatus}


async def list_all(session: AsyncSession) -> list[NewsletterSubscriber]:
    return list((await session.scalars(select(Sub).order_by(Sub.created_at.desc()))).all())


async def get_send(session: AsyncSession, post_id: int) -> NewsletterSend | None:
    return await session.get(NewsletterSend, post_id)


async def start_send(session: AsyncSession, post_id: int) -> None:
    await session.execute(insert(NewsletterSend).values(post_id=post_id).on_conflict_do_nothing())


def _undelivered(post_id: int) -> ColumnElement[bool]:
    delivered = select(NewsletterDelivery.subscriber_id).where(
        NewsletterDelivery.post_id == post_id
    )
    return (Sub.status == SubscriberStatus.confirmed) & Sub.id.not_in(delivered)


async def undelivered(session: AsyncSession, post_id: int, *, limit: int) -> list[Sub]:
    """Confirmed subscribers this post has not reached yet, in a stable order."""
    stmt = select(Sub).where(_undelivered(post_id)).order_by(Sub.id).limit(limit)
    return list((await session.scalars(stmt)).all())


async def count_undelivered(session: AsyncSession, post_id: int) -> int:
    return (await session.scalar(select(func.count()).where(_undelivered(post_id)))) or 0


async def count_recent_deliveries(session: AsyncSession) -> int:
    """Post emails accepted by Resend in the rolling last 24 hours, across all posts."""
    stmt = (
        select(func.count())
        .select_from(NewsletterDelivery)
        .where(NewsletterDelivery.sent_at > func.now() - timedelta(hours=24))
    )
    return (await session.scalar(stmt)) or 0


async def record_deliveries(
    session: AsyncSession, post_id: int, subscriber_ids: Sequence[uuid.UUID]
) -> None:
    if not subscriber_ids:
        return
    await session.execute(
        insert(NewsletterDelivery)
        .from_select(
            ["post_id", "subscriber_id"],
            select(literal(post_id), Sub.id).where(Sub.id.in_(subscriber_ids)),
        )
        .on_conflict_do_nothing()
    )


async def complete_send(session: AsyncSession, post_id: int) -> NewsletterSend:
    delivered = select(func.count()).where(NewsletterDelivery.post_id == post_id).scalar_subquery()
    result = await session.execute(
        update(NewsletterSend)
        .where(NewsletterSend.post_id == post_id)
        .values(completed_at=func.now(), recipients=delivered)
        .returning(NewsletterSend)
    )
    return result.scalar_one()
