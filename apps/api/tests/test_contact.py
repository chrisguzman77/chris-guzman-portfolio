from datetime import timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.clients.email import OutgoingEmail
from portfolio_api.clients.turnstile import TurnstileUnavailableError
from portfolio_api.config import Settings
from portfolio_api.main import create_app
from portfolio_api.models import ContactSubmission, EmailStatus
from portfolio_api.repositories import contact as repo
from portfolio_api.services.contact import ContactForm, ContactService, build_email
from tests.fakes import FakeSender, FakeTurnstile, metric

Sessions = async_sessionmaker[AsyncSession]

VALID: dict[str, Any] = {
    "name": "  Ada Lovelace ",
    "email": "ada@example.com",
    "message": "Hello Chris, let's talk about a role.",
    "turnstile_token": "tok",
    "website": "",
}


@pytest.fixture
def contact_settings(settings: Settings) -> Settings:
    return settings.model_copy(
        update={"turnstile_secret": "sec", "contact_to": "chris@example.com"}
    )


def make_app(
    settings: Settings,
    db: Sessions | None,
    turnstile: FakeTurnstile | None,
    sender: FakeSender | None,
) -> FastAPI:
    app = create_app(settings)
    app.state.turnstile = turnstile
    if db is not None:
        app.state.contact_service = ContactService(
            db, sender, mail_from=settings.contact_from, mail_to=settings.contact_to
        )
    return app


async def post(app: FastAPI, body: dict[str, Any], ip: str = "203.0.113.7") -> Response:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.post("/v1/contact", json=body, headers={"CF-Connecting-IP": ip})


async def rows(db: Sessions) -> list[ContactSubmission]:
    async with db() as session:
        return list((await session.scalars(select(ContactSubmission))).all())


async def backdate(db: Sessions, minutes: int = 6) -> None:
    async with db.begin() as session:
        await session.execute(
            update(ContactSubmission).values(updated_at=func.now() - timedelta(minutes=minutes))
        )


async def test_valid_message_is_saved_then_emailed(
    contact_settings: Settings, db: Sessions
) -> None:
    turnstile, sender = FakeTurnstile(), FakeSender()
    res = await post(make_app(contact_settings, db, turnstile, sender), VALID)

    assert res.status_code == 202
    assert res.json() == {"status": "received"}
    assert turnstile.calls == [("tok", "203.0.113.7")]
    [row] = await rows(db)
    assert (row.name, row.email_status, row.attempts) == ("Ada Lovelace", EmailStatus.sent, 1)
    assert row.sent_at is not None
    [email] = sender.sent
    assert email.to == "chris@example.com"
    assert email.reply_to == "ada@example.com"
    assert email.sender == "Portfolio <contact@christopherguzman.me>"
    assert email.subject == "Portfolio message from Ada Lovelace"
    assert "Hello Chris, let's talk about a role." in email.text
    assert email.idempotency_key == str(row.id)


async def test_honeypot_returns_202_and_stores_nothing(
    contact_settings: Settings, db: Sessions
) -> None:
    turnstile, sender = FakeTurnstile(), FakeSender()
    res = await post(make_app(contact_settings, db, turnstile, sender), {**VALID, "website": "x"})
    assert res.status_code == 202
    assert res.json() == {"status": "received"}
    assert await rows(db) == []
    assert turnstile.calls == [] and sender.sent == []


async def test_failed_turnstile_is_400(contact_settings: Settings, db: Sessions) -> None:
    res = await post(make_app(contact_settings, db, FakeTurnstile(False), FakeSender()), VALID)
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "turnstile_failed"
    assert await rows(db) == []


async def test_unreachable_turnstile_is_503(contact_settings: Settings, db: Sessions) -> None:
    turnstile = FakeTurnstile(TurnstileUnavailableError("timeout"))
    res = await post(make_app(contact_settings, db, turnstile, FakeSender()), VALID)
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "turnstile_unavailable"


async def test_unconfigured_contact_is_503_before_validation(settings: Settings) -> None:
    res = await post(make_app(settings, None, None, None), {"name": ""})
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "contact_unavailable"


@pytest.mark.parametrize(
    ("override", "field"),
    [
        ({"name": "   "}, "name"),
        ({"name": "x" * 101}, "name"),
        ({"email": "not-an-email"}, "email"),
        ({"message": "too short"}, "message"),
        ({"message": "x" * 5001}, "message"),
        ({"turnstile_token": ""}, "turnstile_token"),
    ],
)
async def test_invalid_fields_are_400_with_field_errors(
    contact_settings: Settings, override: dict[str, Any], field: str
) -> None:
    res = await post(make_app(contact_settings, None, FakeTurnstile(), None), {**VALID, **override})
    assert res.status_code == 400
    error = res.json()["error"]
    assert error["code"] == "invalid_request"
    assert field in error["fields"]


async def test_sixth_request_in_a_minute_is_429_per_ip(contact_settings: Settings) -> None:
    app = make_app(contact_settings, None, FakeTurnstile(), None)
    invalid = {**VALID, "message": "short"}  # counted even though invalid; no DB needed
    for _ in range(5):
        assert (await post(app, invalid)).status_code == 400
    limited = await post(app, invalid)
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "rate_limited"
    assert int(limited.headers["retry-after"]) >= 1
    assert (await post(app, invalid, ip="198.51.100.9")).status_code == 400


async def test_send_failure_is_saved_as_failed_then_retried(
    contact_settings: Settings, db: Sessions
) -> None:
    sender = FakeSender(fail_times=1)
    app = make_app(contact_settings, db, FakeTurnstile(), sender)
    assert (await post(app, VALID)).status_code == 202
    [row] = await rows(db)
    assert (row.email_status, row.attempts, row.last_error) == (
        EmailStatus.failed,
        1,
        "resend 500: boom",
    )

    service: ContactService = app.state.contact_service
    await service.retry_due()  # too recent: not retried yet
    assert sender.attempts == 1
    await backdate(db)
    await service.retry_due()
    [row] = await rows(db)
    assert (row.email_status, row.attempts, row.last_error) == (EmailStatus.sent, 2, None)


async def test_retries_stop_after_five_attempts(contact_settings: Settings, db: Sessions) -> None:
    sender = FakeSender(fail_times=99)
    service = ContactService(db, sender, mail_from="f", mail_to="t@example.com")
    submission_id = await service.submit(ContactForm("Ada", "ada@example.com", "Hello there!"))
    for _ in range(7):
        await backdate(db)
        await service.retry_due()
    [row] = await rows(db)
    assert row.id == submission_id
    assert (row.email_status, row.attempts) == (EmailStatus.failed, 5)
    assert sender.attempts == 5


async def test_stuck_pending_rows_are_retried(db: Sessions) -> None:
    sender = FakeSender()
    service = ContactService(db, sender, mail_from="f", mail_to="t@example.com")
    await service.submit(ContactForm("Ada", "ada@example.com", "Hello there!"))
    await service.retry_due()
    assert sender.sent == []  # pending for less than 5 minutes: a send may still be running
    await backdate(db)
    await service.retry_due()
    assert len(sender.sent) == 1


class ExplodingOnceSender(FakeSender):
    async def send(self, email: OutgoingEmail) -> None:
        if self.attempts == 0:
            self.attempts += 1
            raise RuntimeError("unexpected bug")
        await super().send(email)


async def test_one_failing_row_does_not_stop_the_retry_batch(db: Sessions) -> None:
    sender = ExplodingOnceSender()
    service = ContactService(db, sender, mail_from="f", mail_to="t@example.com")
    await service.submit(ContactForm("Ada", "ada@example.com", "Hello there!"))
    await service.submit(ContactForm("Bob", "bob@example.com", "Hello there!"))
    await backdate(db)
    await service.retry_due()
    assert sender.attempts == 2
    assert len(sender.sent) == 1


async def test_without_resend_messages_wait_as_pending(db: Sessions) -> None:
    service = ContactService(db, None, mail_from="f", mail_to="t@example.com")
    submission_id = await service.submit(ContactForm("Ada", "ada@example.com", "Hello there!"))
    await service.deliver(submission_id)
    await backdate(db)
    await service.retry_due()
    [row] = await rows(db)
    assert (row.email_status, row.attempts) == (EmailStatus.pending, 0)


async def test_subject_strips_line_breaks(db: Sessions) -> None:
    service = ContactService(db, None, mail_from="f", mail_to="t@example.com")
    submission_id = await service.submit(
        ContactForm("Ada\r\nBcc: x@evil.test", "ada@example.com", "Hello there!")
    )
    async with db() as session:
        row = await session.get(ContactSubmission, submission_id)
    assert row is not None
    email = build_email(row, sender="f", to="t@example.com")
    assert "\r" not in email.subject and "\n" not in email.subject
    assert email.subject == "Portfolio message from Ada Bcc: x@evil.test"


async def test_deliveries_are_measured(db: Sessions) -> None:
    sent = metric("contact_submissions_total", result="sent")
    failed = metric("contact_submissions_total", result="failed")
    service = ContactService(db, FakeSender(fail_times=1), mail_from="f", mail_to="t@example.com")
    submission_id = await service.submit(ContactForm("Ada", "ada@example.com", "Hello there!"))
    await service.deliver(submission_id)
    assert metric("contact_submissions_total", result="failed") == failed + 1
    assert metric("contact_submissions_total", result="sent") == sent
    await service.deliver(submission_id)
    assert metric("contact_submissions_total", result="sent") == sent + 1
    assert metric("contact_submissions_total", result="failed") == failed + 1


async def post_raw(app: FastAPI, content: bytes, ip: str = "203.0.113.7") -> Response:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.post(
            "/v1/contact",
            content=content,
            headers={"CF-Connecting-IP": ip, "Content-Type": "application/json"},
        )


async def test_malformed_json_counts_against_the_rate_limit(contact_settings: Settings) -> None:
    app = make_app(contact_settings, None, FakeTurnstile(), None)
    for _ in range(5):
        res = await post_raw(app, b"{not json")
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "invalid_request"
    limited = await post_raw(app, b"{not json")
    assert limited.status_code == 429


async def test_malformed_json_on_unconfigured_contact_is_503(settings: Settings) -> None:
    res = await post_raw(make_app(settings, None, None, None), b"{not json")
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "contact_unavailable"


async def test_contact_body_is_documented_in_openapi(contact_settings: Settings) -> None:
    app = make_app(contact_settings, None, FakeTurnstile(), None)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        spec = (await c.get("/openapi.json")).json()
    body = spec["paths"]["/v1/contact"]["post"]["requestBody"]
    schema = body["content"]["application/json"]["schema"]
    if "$ref" in schema:
        schema = spec["components"]["schemas"][schema["$ref"].rsplit("/", 1)[-1]]
    assert set(schema["required"]) == {"name", "email", "message", "turnstile_token"}


async def test_email_body_strips_line_breaks_from_the_name(db: Sessions) -> None:
    service = ContactService(db, None, mail_from="f", mail_to="t@example.com")
    submission_id = await service.submit(
        ContactForm("Ada\r\nReceived: forged", "ada@example.com", "Hello there!")
    )
    async with db() as session:
        row = await session.get(ContactSubmission, submission_id)
    assert row is not None
    email = build_email(row, sender="f", to="t@example.com")
    assert email.text.startswith("Name: Ada Received: forged\nEmail: ada@example.com\n")


async def test_retry_query_uses_the_database_clock(db: Sessions) -> None:
    service = ContactService(db, None, mail_from="f", mail_to="t@example.com")
    due_id = await service.submit(ContactForm("Ada", "ada@example.com", "Hello there!"))
    await backdate(db)
    fresh_id = await service.submit(ContactForm("Bob", "bob@example.com", "Hello there!"))
    async with db() as session:
        due = await repo.due_for_retry(session)
    assert due == [due_id] and fresh_id not in due
