import asyncio
import uuid
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.clients.directus import DirectusError, NewsletterPost
from portfolio_api.clients.email import OutgoingEmail
from portfolio_api.config import Settings
from portfolio_api.main import create_app
from portfolio_api.models import NewsletterSend, NewsletterSubscriber
from portfolio_api.newsletter_tokens import read_unsubscribe_token, unsubscribe_key
from portfolio_api.services import newsletter as newsletter_module
from portfolio_api.services.newsletter import NewsletterService
from tests.fakes import FakeBatchSender, metric

Sessions = async_sessionmaker[AsyncSession]
KEY = unsubscribe_key("s3cret")
SECRET = {"X-Internal-Secret": "s3cret"}
POST = NewsletterPost(
    id=3, slug="hello-world", title="Hello world", excerpt="First post.", published=True
)
DRAFT = NewsletterPost(id=4, slug="draft", title="Draft", excerpt="Soon.", published=False)


class FakePosts:
    def __init__(self, *posts: NewsletterPost, error: Exception | None = None) -> None:
        self.posts = {p.id: p for p in posts}
        self.error = error

    async def fetch_post(self, post_id: int) -> NewsletterPost | None:
        if self.error:
            raise self.error
        return self.posts.get(post_id)


class Sleeps:
    def __init__(self) -> None:
        self.calls: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)


def make_service(
    db: Sessions,
    sender: FakeBatchSender,
    posts: FakePosts | None = None,
    sleep: Sleeps | None = None,
) -> NewsletterService:
    return NewsletterService(
        db,
        sender,
        mail_from="Christopher Guzman <posts@christopherguzman.me>",
        site_url="https://christopherguzman.me",
        api_url="https://api.christopherguzman.me",
        unsubscribe_key=KEY,
        posts=posts or FakePosts(POST, DRAFT),
        test_to="chris@example.com",
        sleep=sleep or Sleeps(),
    )


def make_app(settings: Settings, svc: NewsletterService | None) -> FastAPI:
    app = create_app(settings.model_copy(update={"internal_secret": "s3cret"}))
    app.state.newsletter_service = svc
    return app


async def send(app: FastAPI, body: dict[str, Any], headers: dict[str, str] = SECRET) -> Response:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.post("/internal/newsletter/send", json=body, headers=headers)


async def confirmed(db: Sessions, svc: NewsletterService, n: int) -> list[str]:
    emails = [f"reader{i}@example.com" for i in range(n)]
    for email in emails:
        token = await svc.subscribe(email)
        assert token is not None and await svc.confirm(token)
    return emails


def recipients(sender: FakeBatchSender) -> list[str]:
    return [e.to for e in sender.sent]


async def test_drafts_and_unknown_posts_are_refused(settings: Settings, db: Sessions) -> None:
    sender = FakeBatchSender()
    app = make_app(settings, make_service(db, sender))
    for post_id in (DRAFT.id, 99):
        res = await send(app, {"post_id": post_id, "test": False})
        assert (res.status_code, res.json()["error"]["code"]) == (409, "not_published")
    assert sender.sent == []


async def test_full_send_reaches_every_confirmed_subscriber_once(
    settings: Settings, db: Sessions
) -> None:
    sender = FakeBatchSender()
    svc = make_service(db, sender)
    emails = await confirmed(db, svc, 3)
    await svc.subscribe("pending@example.com")  # never confirmed: not emailed
    sender.sent.clear()
    app = make_app(settings, svc)
    before = metric("newsletter_emails_total", kind="post", result="sent")

    res = await send(app, {"post_id": POST.id, "test": False})
    body = res.json()
    assert res.status_code == 200
    assert (body["status"], body["sent"], body["remaining"], body["recipients"]) == (
        "complete",
        3,
        0,
        3,
    )
    assert body["sent_at"] is not None
    assert sorted(recipients(sender)) == sorted(emails)
    assert metric("newsletter_emails_total", kind="post", result="sent") == before + 3

    async with db() as s:
        ids = {r.email: r.id for r in (await s.scalars(select(NewsletterSubscriber))).all()}
    for email in sender.sent:
        assert email.subject == "Hello world"
        assert "utm_source=newsletter&utm_medium=email&utm_campaign=hello-world" in email.text
        assert email.headers is not None
        header = email.headers["List-Unsubscribe"]
        assert header.startswith(
            "<https://api.christopherguzman.me/v1/newsletter/unsubscribe?token="
        )
        token = header.split("token=", 1)[1].rstrip(">")
        assert read_unsubscribe_token(KEY, token) == ids[email.to]
        assert email.headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"

    again = await send(app, {"post_id": POST.id, "test": False})
    assert (again.status_code, again.json()["error"]["code"]) == (409, "already_sent")
    assert len(sender.sent) == 3


async def test_test_send_goes_only_to_chris_and_records_nothing(
    settings: Settings, db: Sessions
) -> None:
    sender = FakeBatchSender()
    svc = make_service(db, sender)
    await confirmed(db, svc, 2)
    sender.sent.clear()
    app = make_app(settings, svc)
    before = metric("newsletter_emails_total", kind="test", result="sent")
    for _ in range(2):  # repeatable, and never "already_sent"
        res = await send(app, {"post_id": str(POST.id), "test": "true"})
        assert (res.status_code, res.json()["status"], res.json()["sent"]) == (200, "test", 1)
    assert recipients(sender) == ["chris@example.com", "chris@example.com"]
    assert metric("newsletter_emails_total", kind="test", result="sent") == before + 2
    async with db() as s:
        assert await s.scalar(select(func.count()).select_from(NewsletterSend)) == 0


@pytest.mark.parametrize("flag", [False, "false", ""])
async def test_non_true_test_flags_mean_a_real_send(
    settings: Settings, db: Sessions, flag: Any
) -> None:
    sender = FakeBatchSender()
    svc = make_service(db, sender)
    await confirmed(db, svc, 1)
    sender.sent.clear()
    res = await send(make_app(settings, svc), {"post_id": "3", "test": flag})
    assert res.json()["status"] == "complete"


async def test_partial_send_resumes_without_duplicates(
    settings: Settings, db: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(newsletter_module, "BATCH_SIZE", 2)
    sender = FakeBatchSender(fail_batches={1})  # the second batch hits the daily quota
    sleeps = Sleeps()
    svc = make_service(db, sender, sleep=sleeps)
    emails = await confirmed(db, svc, 5)
    sender.sent.clear()
    app = make_app(settings, svc)
    failed_before = metric("newsletter_emails_total", kind="post", result="failed")

    first = await send(app, {"post_id": POST.id, "test": False})
    assert first.status_code == 207
    assert (first.json()["status"], first.json()["sent"], first.json()["remaining"]) == (
        "partial",
        2,
        3,
    )
    assert metric("newsletter_emails_total", kind="post", result="failed") == failed_before + 2

    second = await send(app, {"post_id": POST.id, "test": False})
    assert second.status_code == 200
    assert (second.json()["sent"], second.json()["recipients"]) == (3, 5)
    assert sorted(recipients(sender)) == sorted(emails)  # each exactly once
    assert len({key for key, _ in sender.batches}) == len(sender.batches)
    assert sleeps.calls and all(s > 0 for s in sleeps.calls)


async def test_no_subscribers_completes_with_zero(settings: Settings, db: Sessions) -> None:
    res = await send(make_app(settings, make_service(db, FakeBatchSender())), {"post_id": POST.id})
    assert (res.json()["status"], res.json()["recipients"]) == ("complete", 0)


async def test_a_second_click_during_a_send_is_refused(settings: Settings, db: Sessions) -> None:
    started = asyncio.Event()
    release = asyncio.Event()

    class SlowSender(FakeBatchSender):
        async def send_batch(self, emails: Any, idempotency_key: str) -> None:
            started.set()
            await release.wait()
            await super().send_batch(emails, idempotency_key)

    svc = make_service(db, SlowSender())
    await confirmed(db, svc, 1)
    first = asyncio.create_task(svc.send(POST.id, test=False))
    await started.wait()
    res = await send(make_app(settings, svc), {"post_id": POST.id})
    assert (res.status_code, res.json()["error"]["code"]) == (409, "send_in_progress")
    release.set()
    assert (await first).status == "complete"


async def test_directus_outage_is_502(settings: Settings, db: Sessions) -> None:
    svc = make_service(db, FakeBatchSender(), posts=FakePosts(error=DirectusError("down")))
    res = await send(make_app(settings, svc), {"post_id": POST.id})
    assert (res.status_code, res.json()["error"]["code"]) == (502, "directus_unavailable")


async def test_internal_routes_refuse_tunnel_traffic_and_wrong_secrets(
    settings: Settings, db: Sessions
) -> None:
    app = make_app(settings, make_service(db, FakeBatchSender()))
    for headers in (
        {},
        {"X-Internal-Secret": "nope"},
        {**SECRET, "CF-Connecting-IP": "203.0.113.7"},
    ):
        assert (await send(app, {"post_id": 3}, headers)).status_code == 404
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (
                await c.get("/internal/newsletter/subscribers", headers=headers)
            ).status_code == 404
            res = await c.delete(
                f"/internal/newsletter/subscribers/{uuid.uuid4()}", headers=headers
            )
            assert res.status_code == 404


async def test_unconfigured_newsletter_is_503_behind_the_secret(settings: Settings) -> None:
    res = await send(make_app(settings, None), {"post_id": 3})
    assert (res.status_code, res.json()["error"]["code"]) == (503, "newsletter_unavailable")


async def test_list_and_remove_subscribers(settings: Settings, db: Sessions) -> None:
    svc = make_service(db, FakeBatchSender())
    await confirmed(db, svc, 2)
    await svc.subscribe("pending@example.com")
    app = make_app(settings, svc)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        listed = (await c.get("/internal/newsletter/subscribers", headers=SECRET)).json()
        assert listed["totals"] == {"confirmed": 2, "pending": 1}
        assert {s["email"] for s in listed["subscribers"]} == {
            "reader0@example.com",
            "reader1@example.com",
            "pending@example.com",
        }
        target = listed["subscribers"][0]["id"]
        for _ in range(2):  # idempotent
            res = await c.delete(f"/internal/newsletter/subscribers/{target}", headers=SECRET)
            assert res.status_code == 204
        bad = await c.delete("/internal/newsletter/subscribers/not-a-uuid", headers=SECRET)
        assert bad.status_code == 400
        after = (await c.get("/internal/newsletter/subscribers", headers=SECRET)).json()
    assert target not in {s["id"] for s in after["subscribers"]}


async def test_post_emails_are_plain(db: Sessions) -> None:
    """No tracking: no images, and the only links are the post and the unsubscribe page."""
    svc = make_service(db, FakeBatchSender())
    email: OutgoingEmail = svc._post_email(POST, "a@example.com", uuid.UUID(int=1))  # pyright: ignore[reportPrivateUsage]
    assert email.html is not None and "<img" not in email.html
    hrefs = [part.split('"', 1)[0] for part in email.html.split('href="')[1:]]
    assert len(hrefs) == 2
    assert hrefs[0].startswith("https://christopherguzman.me/blog/hello-world?")
    assert hrefs[1].startswith("https://christopherguzman.me/newsletter/unsubscribe?token=")


@pytest.mark.parametrize("flag", ["undefined", "1", 1, "True"])
async def test_ambiguous_test_flags_are_rejected_and_send_nothing(
    settings: Settings, db: Sessions, flag: Any
) -> None:
    sender = FakeBatchSender()
    svc = make_service(db, sender)
    await confirmed(db, svc, 1)
    sender.sent.clear()
    res = await send(make_app(settings, svc), {"post_id": "3", "test": flag})
    assert (res.status_code, res.json()["error"]["code"]) == (400, "invalid_request")
    assert sender.sent == []


async def test_unsubscribe_during_a_send_does_not_resend(settings: Settings, db: Sessions) -> None:
    class UnsubscribingSender(FakeBatchSender):
        victim: str | None = None

        async def send_batch(self, emails: Any, idempotency_key: str) -> None:
            if self.victim is None:
                self.victim = emails[-1].to
                async with db() as s:
                    sub_id = await s.scalar(
                        select(NewsletterSubscriber.id).where(
                            NewsletterSubscriber.email == self.victim
                        )
                    )
                assert sub_id is not None
                await svc.remove(sub_id)
            await super().send_batch(emails, idempotency_key)

    sender = UnsubscribingSender()
    svc = make_service(db, sender)
    await confirmed(db, svc, 4)
    sender.sent.clear()
    res = await send(make_app(settings, svc), {"post_id": POST.id, "test": False})
    assert res.status_code == 200
    assert (res.json()["status"], res.json()["recipients"]) == ("complete", 3)
    assert len(recipients(sender)) == len(set(recipients(sender)))


async def test_posts_unavailable_is_503(settings: Settings, db: Sessions) -> None:
    svc = NewsletterService(
        db,
        FakeBatchSender(),
        mail_from="Christopher Guzman <posts@christopherguzman.me>",
        site_url="https://christopherguzman.me",
        api_url="https://api.christopherguzman.me",
        unsubscribe_key=KEY,
        posts=None,
        test_to="chris@example.com",
        sleep=Sleeps(),
    )
    res = await send(make_app(settings, svc), {"post_id": POST.id})
    assert (res.status_code, res.json()["error"]["code"]) == (503, "posts_unavailable")


async def test_test_send_without_contact_to_is_503(settings: Settings, db: Sessions) -> None:
    svc = make_service(db, FakeBatchSender())
    svc._test_to = None  # pyright: ignore[reportPrivateUsage]
    res = await send(make_app(settings, svc), {"post_id": POST.id, "test": True})
    assert (res.status_code, res.json()["error"]["code"]) == (503, "test_unavailable")


async def test_failed_test_send_is_502(settings: Settings, db: Sessions) -> None:
    svc = make_service(db, FakeBatchSender(fail_times=1))
    res = await send(make_app(settings, svc), {"post_id": POST.id, "test": True})
    assert (res.status_code, res.json()["error"]["code"]) == (502, "send_failed")
