from datetime import timedelta

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.models import NewsletterSend, NewsletterSubscriber, SubscriberStatus
from portfolio_api.repositories import newsletter as repo
from portfolio_api.repositories.newsletter import ConfirmResult

Sessions = async_sessionmaker[AsyncSession]


async def subscriber(db: Sessions, email: str) -> NewsletterSubscriber:
    async with db() as s:
        return (
            await s.scalars(select(NewsletterSubscriber).where(NewsletterSubscriber.email == email))
        ).one()


async def age(db: Sessions, email: str, hours: float) -> None:
    async with db.begin() as s:
        await s.execute(
            update(NewsletterSubscriber)
            .where(NewsletterSubscriber.email == email)
            .values(confirm_sent_at=func.now() - timedelta(hours=hours))
        )


async def add_confirmed(db: Sessions, *emails: str) -> None:
    for i, email in enumerate(emails):
        async with db.begin() as s:
            assert await repo.claim_confirmation(s, email, f"h{i}{email}")
            assert await repo.confirm(s, f"h{i}{email}") == ConfirmResult.confirmed


async def test_claim_new_pending_recent_pending_old_and_confirmed(db: Sessions) -> None:
    async with db.begin() as s:
        assert await repo.claim_confirmation(s, "a@example.com", "h1") is True
    async with db.begin() as s:  # within the hour: no second email
        assert await repo.claim_confirmation(s, "a@example.com", "h2") is False
    assert (await subscriber(db, "a@example.com")).confirm_token_hash == "h1"  # noqa: S105
    await age(db, "a@example.com", 2)
    async with db.begin() as s:  # over an hour: a fresh token replaces the old one
        assert await repo.claim_confirmation(s, "a@example.com", "h3") is True
    assert (await subscriber(db, "a@example.com")).confirm_token_hash == "h3"  # noqa: S105
    async with db.begin() as s:
        assert await repo.confirm(s, "h3") == ConfirmResult.confirmed
    await age(db, "a@example.com", 2)
    async with db.begin() as s:  # confirmed: never emailed again
        assert await repo.claim_confirmation(s, "a@example.com", "h4") is False


async def test_confirm_is_idempotent_and_expires_after_seven_days(db: Sessions) -> None:
    async with db.begin() as s:
        await repo.claim_confirmation(s, "b@example.com", "hb")
    async with db.begin() as s:
        assert await repo.confirm(s, "unknown") == ConfirmResult.invalid
    async with db.begin() as s:
        assert await repo.confirm(s, "hb") == ConfirmResult.confirmed
    row = await subscriber(db, "b@example.com")
    assert row.status == SubscriberStatus.confirmed and row.confirmed_at is not None
    async with db.begin() as s:
        assert await repo.confirm(s, "hb") == ConfirmResult.already_confirmed
    async with db.begin() as s:
        await repo.claim_confirmation(s, "c@example.com", "hc")
    await age(db, "c@example.com", 24 * 7 + 1)
    async with db.begin() as s:
        assert await repo.confirm(s, "hc") == ConfirmResult.invalid


async def test_purge_deletes_only_stale_pending_rows(db: Sessions) -> None:
    await add_confirmed(db, "keep@example.com")
    async with db.begin() as s:
        await repo.claim_confirmation(s, "fresh@example.com", "hf")
        await repo.claim_confirmation(s, "stale@example.com", "hs")
    await age(db, "stale@example.com", 24 * 7 + 1)
    await age(db, "keep@example.com", 24 * 30)
    async with db.begin() as s:
        assert await repo.purge_pending(s) == 1
    async with db() as s:
        assert await repo.counts(s) == {
            SubscriberStatus.pending: 1,
            SubscriberStatus.confirmed: 1,
        }
        assert [r.email for r in await repo.list_all(s)] == [
            "fresh@example.com",
            "keep@example.com",
        ]


async def test_delete_reports_whether_a_row_went(db: Sessions) -> None:
    await add_confirmed(db, "d@example.com")
    row = await subscriber(db, "d@example.com")
    async with db.begin() as s:
        assert await repo.delete(s, row.id) is True
    async with db.begin() as s:
        assert await repo.delete(s, row.id) is False


async def test_send_bookkeeping(db: Sessions) -> None:
    await add_confirmed(db, "1@example.com", "2@example.com", "3@example.com")
    async with db.begin() as s:
        await repo.claim_confirmation(s, "pending@example.com", "hp")
    async with db.begin() as s:
        await repo.start_send(s, 42)
        await repo.start_send(s, 42)  # idempotent
    async with db() as s:
        assert (await repo.get_send(s, 42)) is not None and await repo.get_send(s, 7) is None
        first = await repo.undelivered(s, 42, limit=2)
        assert len(first) == 2 and await repo.count_undelivered(s, 42) == 3
    async with db.begin() as s:
        await repo.record_deliveries(s, 42, [r.id for r in first])
        await repo.record_deliveries(s, 42, [first[0].id])  # duplicate is ignored
    async with db() as s:
        rest = await repo.undelivered(s, 42, limit=100)
        assert len(rest) == 1 and rest[0].id not in {r.id for r in first}
        assert await repo.count_undelivered(s, 42) == 1
    async with db.begin() as s:
        await repo.record_deliveries(s, 42, [rest[0].id])
        done = await repo.complete_send(s, 42)
    assert isinstance(done, NewsletterSend)
    assert done.completed_at is not None and done.recipients == 3
