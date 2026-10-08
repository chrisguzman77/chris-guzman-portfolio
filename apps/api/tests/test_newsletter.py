import re
from datetime import timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.clients.turnstile import TurnstileUnavailableError
from portfolio_api.config import Settings
from portfolio_api.main import create_app
from portfolio_api.models import NewsletterSubscriber, SubscriberStatus
from portfolio_api.newsletter_tokens import unsubscribe_key, unsubscribe_token
from portfolio_api.services.newsletter import NewsletterService
from tests.fakes import FakeBatchSender, FakeTurnstile, metric

Sessions = async_sessionmaker[AsyncSession]
KEY = unsubscribe_key("s3cret")
BASE = "/v1/newsletter"


@pytest.fixture
def nl_settings(settings: Settings) -> Settings:
    return settings.model_copy(
        update={
            "turnstile_secret": "sec",
            "resend_api_key": "re_test",
            "internal_secret": "s3cret",
            "contact_to": "chris@example.com",
        }
    )


def service(db: Sessions, sender: FakeBatchSender) -> NewsletterService:
    return NewsletterService(
        db,
        sender,
        mail_from="Christopher Guzman <posts@christopherguzman.me>",
        site_url="https://christopherguzman.me",
        api_url="https://api.christopherguzman.me",
        unsubscribe_key=KEY,
    )


def make_app(
    settings: Settings,
    db: Sessions | None,
    turnstile: FakeTurnstile | None = None,
    sender: FakeBatchSender | None = None,
) -> FastAPI:
    app = create_app(settings)
    app.state.turnstile = turnstile or FakeTurnstile()
    app.state.newsletter_service = (
        service(db, sender or FakeBatchSender()) if db is not None else None
    )
    return app


async def call(
    app: FastAPI, path: str, body: Any = None, *, ip: str = "203.0.113.7", **kw: Any
) -> Response:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        if body is not None:
            kw["json"] = body
        return await c.post(f"{BASE}{path}", headers={"CF-Connecting-IP": ip}, **kw)


def sub(email: str = "ada@example.com", **extra: Any) -> dict[str, Any]:
    return {"email": email, "turnstile_token": "tok", "website": "", **extra}


def token_in(text: str) -> str:
    found = re.search(r"token=([A-Za-z0-9_\-]+)", text)
    assert found
    return found.group(1)


async def rows(db: Sessions) -> list[NewsletterSubscriber]:
    async with db() as s:
        return list((await s.scalars(select(NewsletterSubscriber))).all())


async def age_all(db: Sessions, hours: float) -> None:
    async with db.begin() as s:
        await s.execute(
            update(NewsletterSubscriber).values(confirm_sent_at=func.now() - timedelta(hours=hours))
        )


async def test_new_address_gets_one_confirmation_email(nl_settings: Settings, db: Sessions) -> None:
    sender, turnstile = FakeBatchSender(), FakeTurnstile()
    before = metric("newsletter_subscribe_requests_total", result="accepted")
    sent_before = metric("newsletter_emails_total", kind="confirm", result="sent")
    res = await call(
        make_app(nl_settings, db, turnstile, sender), "/subscribe", sub("Ada@Example.COM")
    )
    assert (res.status_code, res.json()) == (202, {"status": "check_inbox"})
    assert turnstile.calls == [("tok", "203.0.113.7")]
    [row] = await rows(db)
    assert (row.email, row.status) == ("ada@example.com", SubscriberStatus.pending)
    [email] = sender.sent
    assert email.to == "ada@example.com"
    assert email.subject == "Confirm your subscription to Christopher Guzman's blog"
    assert "https://christopherguzman.me/newsletter/confirm?token=" in email.text
    assert metric("newsletter_subscribe_requests_total", result="accepted") == before + 1
    assert metric("newsletter_emails_total", kind="confirm", result="sent") == sent_before + 1


async def test_pending_and_confirmed_addresses_get_the_same_answer(
    nl_settings: Settings, db: Sessions
) -> None:
    sender = FakeBatchSender()
    app = make_app(nl_settings, db, sender=sender)
    first = await call(app, "/subscribe", sub())
    again = await call(app, "/subscribe", sub())  # pending, within the hour
    await call(app, "/confirm", {"token": token_in(sender.sent[0].text)})
    await age_all(db, 2)
    confirmed = await call(app, "/subscribe", sub())  # confirmed: never re-sent
    assert {r.status_code for r in (first, again, confirmed)} == {202}
    assert first.json() == again.json() == confirmed.json() == {"status": "check_inbox"}
    assert len(sender.sent) == 1


async def test_pending_address_is_re_sent_after_an_hour(
    nl_settings: Settings, db: Sessions
) -> None:
    sender = FakeBatchSender()
    app = make_app(nl_settings, db, sender=sender)
    await call(app, "/subscribe", sub())
    await age_all(db, 2)
    await call(app, "/subscribe", sub())
    assert len(sender.sent) == 2
    assert token_in(sender.sent[0].text) != token_in(sender.sent[1].text)


async def test_honeypot_is_accepted_silently(nl_settings: Settings, db: Sessions) -> None:
    turnstile = FakeTurnstile()
    before = metric("newsletter_subscribe_requests_total", result="rejected")
    res = await call(make_app(nl_settings, db, turnstile), "/subscribe", sub(website="x"))
    assert (res.status_code, res.json()) == (202, {"status": "check_inbox"})
    assert await rows(db) == [] and turnstile.calls == []
    assert metric("newsletter_subscribe_requests_total", result="rejected") == before + 1


async def test_turnstile_failure_and_outage(nl_settings: Settings, db: Sessions) -> None:
    res = await call(make_app(nl_settings, db, FakeTurnstile(False)), "/subscribe", sub())
    assert (res.status_code, res.json()["error"]["code"]) == (400, "turnstile_failed")
    down = FakeTurnstile(TurnstileUnavailableError("timeout"))
    res = await call(make_app(nl_settings, db, down), "/subscribe", sub())
    assert (res.status_code, res.json()["error"]["code"]) == (503, "turnstile_unavailable")
    assert await rows(db) == []


async def test_subscribe_is_rate_limited_per_client(nl_settings: Settings, db: Sessions) -> None:
    app = make_app(nl_settings, db)
    for n in range(5):
        assert (await call(app, "/subscribe", sub(f"u{n}@example.com"))).status_code == 202
    res = await call(app, "/subscribe", sub("u9@example.com"))
    assert (res.status_code, res.json()["error"]["code"]) == (429, "rate_limited")
    assert int(res.headers["retry-after"]) >= 1
    other = await call(app, "/subscribe", sub("v@example.com"), ip="198.51.100.9")
    assert other.status_code == 202


async def test_subscribe_requires_json_and_a_valid_email(
    nl_settings: Settings, db: Sessions
) -> None:
    app = make_app(nl_settings, db)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        res = await c.post(
            f"{BASE}/subscribe",
            content=b"email=a@b.co",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    assert (res.status_code, res.json()["error"]["code"]) == (400, "invalid_request")
    res = await call(app, "/subscribe", sub("not-an-email"))
    assert res.status_code == 400 and "email" in res.json()["error"]["fields"]


async def test_unconfigured_newsletter_is_503(nl_settings: Settings) -> None:
    app = make_app(nl_settings, None)
    for path, body in (
        ("/subscribe", sub()),
        ("/confirm", {"token": "t"}),
        ("/unsubscribe", {"token": "t"}),
    ):
        res = await call(app, path, body)
        assert (res.status_code, res.json()["error"]["code"]) == (503, "newsletter_unavailable")


async def test_failed_confirmation_email_still_answers_202(
    nl_settings: Settings, db: Sessions
) -> None:
    before = metric("newsletter_emails_total", kind="confirm", result="failed")
    res = await call(
        make_app(nl_settings, db, sender=FakeBatchSender(fail_times=1)), "/subscribe", sub()
    )
    assert res.status_code == 202
    assert metric("newsletter_emails_total", kind="confirm", result="failed") == before + 1


async def test_confirm_is_idempotent_and_counts_once(nl_settings: Settings, db: Sessions) -> None:
    sender = FakeBatchSender()
    app = make_app(nl_settings, db, sender=sender)
    await call(app, "/subscribe", sub())
    token = token_in(sender.sent[0].text)
    before = metric("newsletter_confirmations_total")
    for _ in range(2):
        res = await call(app, "/confirm", {"token": token})
        assert (res.status_code, res.json()) == (200, {"status": "confirmed"})
    assert metric("newsletter_confirmations_total") == before + 1
    [row] = await rows(db)
    assert row.status == SubscriberStatus.confirmed
    bad = await call(app, "/confirm", {"token": "wrong"})
    assert (bad.status_code, bad.json()["error"]["code"]) == (400, "invalid_token")


async def test_expired_confirm_link_is_invalid(nl_settings: Settings, db: Sessions) -> None:
    sender = FakeBatchSender()
    app = make_app(nl_settings, db, sender=sender)
    await call(app, "/subscribe", sub())
    await age_all(db, 24 * 7 + 1)
    res = await call(app, "/confirm", {"token": token_in(sender.sent[0].text)})
    assert (res.status_code, res.json()["error"]["code"]) == (400, "invalid_token")


async def test_unsubscribe_deletes_and_is_idempotent(nl_settings: Settings, db: Sessions) -> None:
    sender = FakeBatchSender()
    app = make_app(nl_settings, db, sender=sender)
    await call(app, "/subscribe", sub())
    [row] = await rows(db)
    token = unsubscribe_token(KEY, row.id)
    before = metric("newsletter_unsubscribes_total")
    for _ in range(2):
        res = await call(app, "/unsubscribe", {"token": token})
        assert (res.status_code, res.json()) == (200, {"status": "unsubscribed"})
    assert await rows(db) == []
    assert metric("newsletter_unsubscribes_total") == before + 1
    forged = await call(app, "/unsubscribe", {"token": f"{row.id}.AAAA"})
    assert (forged.status_code, forged.json()["error"]["code"]) == (400, "invalid_token")


async def test_one_click_unsubscribe_from_the_query_string(
    nl_settings: Settings, db: Sessions
) -> None:
    """RFC 8058: the mail provider POSTs List-Unsubscribe=One-Click as a form to the header URL."""
    app = make_app(nl_settings, db)
    await call(app, "/subscribe", sub())
    [row] = await rows(db)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        res = await c.post(
            f"{BASE}/unsubscribe",
            params={"token": unsubscribe_token(KEY, row.id)},
            content=b"List-Unsubscribe=One-Click",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    assert (res.status_code, res.json()) == (200, {"status": "unsubscribed"})
    assert await rows(db) == []


async def test_purge_and_gauge(db: Sessions) -> None:
    svc = service(db, FakeBatchSender())
    assert await svc.subscribe("old@example.com") is not None
    await age_all(db, 24 * 7 + 1)
    assert await svc.subscribe("new@example.com") is not None
    await svc.purge_pending()
    await svc.refresh_gauge()
    assert [r.email for r in await rows(db)] == ["new@example.com"]
    assert metric("newsletter_subscribers", status="pending") == 1
    assert metric("newsletter_subscribers", status="confirmed") == 0
