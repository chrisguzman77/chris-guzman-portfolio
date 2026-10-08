"""Blog subscriptions: double opt-in sign-up, confirm, unsubscribe and post sends."""

import asyncio
import hashlib
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Literal, Protocol

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.clients.directus import NewsletterPost
from portfolio_api.clients.email import BatchEmailSender, EmailSendError, OutgoingEmail
from portfolio_api.metrics import (
    NEWSLETTER_CONFIRMATIONS,
    NEWSLETTER_EMAILS,
    NEWSLETTER_SUBSCRIBERS,
    NEWSLETTER_UNSUBSCRIBES,
)
from portfolio_api.models import NewsletterSubscriber, SubscriberStatus
from portfolio_api.newsletter_tokens import (
    hash_token,
    new_confirm_token,
    read_unsubscribe_token,
    unsubscribe_token,
)
from portfolio_api.repositories import newsletter as repo
from portfolio_api.repositories.newsletter import ConfirmResult
from portfolio_api.services.newsletter_email import confirm_email, post_email, post_url

log = structlog.get_logger()

BATCH_SIZE = 100  # Resend's batch limit
BATCH_PAUSE = 0.6  # Resend allows 2 requests a second


class PostSource(Protocol):
    async def fetch_post(self, post_id: int) -> NewsletterPost | None: ...


@dataclass(frozen=True)
class SendResult:
    status: Literal["complete", "partial", "test"]
    sent: int
    remaining: int
    sent_at: datetime | None = None
    recipients: int | None = None


class SendRefusedError(Exception):
    """A send that must not happen; the router turns it into an error response."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def batch_key(post_id: int, subscriber_ids: Sequence[uuid.UUID]) -> str:
    """Same post and recipients, same key: Resend drops a repeat within 24 hours."""
    digest = hashlib.sha256(",".join(str(i) for i in subscriber_ids).encode()).hexdigest()
    return f"newsletter-{post_id}-{digest[:32]}"


def normalize_email(email: str) -> str:
    return email.strip().lower()


class NewsletterService:
    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        sender: BatchEmailSender,
        *,
        mail_from: str,
        site_url: str,
        api_url: str,
        unsubscribe_key: bytes,
        posts: PostSource | None = None,
        test_to: str | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._sessions = sessions
        self._sender = sender
        self._mail_from = mail_from
        self._site_url = site_url.rstrip("/")
        self._api_url = api_url.rstrip("/")
        self._key = unsubscribe_key
        self._posts = posts
        self._test_to = test_to
        self._sleep = sleep
        self._lock = asyncio.Lock()

    async def subscribe(self, email: str) -> str | None:
        """Record a sign-up. Returns the confirm token to email, or None when none is due."""
        token, token_hash = new_confirm_token()
        async with self._sessions.begin() as session:
            due = await repo.claim_confirmation(session, normalize_email(email), token_hash)
        return token if due else None

    async def send_confirmation(self, email: str, token: str) -> None:
        """Runs after the response, so every subscribe answers in the same time."""
        message = confirm_email(
            sender=self._mail_from,
            to=normalize_email(email),
            confirm_url=f"{self._site_url}/newsletter/confirm?token={token}",
            idempotency_key=hash_token(token),
        )
        try:
            await self._sender.send(message)
        except EmailSendError as exc:
            NEWSLETTER_EMAILS.labels(kind="confirm", result="failed").inc()
            log.warning("newsletter confirmation email failed", error=str(exc))
            return
        NEWSLETTER_EMAILS.labels(kind="confirm", result="sent").inc()

    async def confirm(self, token: str) -> bool:
        async with self._sessions.begin() as session:
            result = await repo.confirm(session, hash_token(token))
        if result is ConfirmResult.confirmed:
            NEWSLETTER_CONFIRMATIONS.inc()
        return result is not ConfirmResult.invalid

    async def unsubscribe(self, token: str) -> bool:
        """False only for a forged or malformed token; an unknown subscriber is already out."""
        subscriber_id = read_unsubscribe_token(self._key, token)
        if subscriber_id is None:
            return False
        async with self._sessions.begin() as session:
            deleted = await repo.delete(session, subscriber_id)
        if deleted:
            NEWSLETTER_UNSUBSCRIBES.inc()
        return True

    async def purge_pending(self) -> None:
        async with self._sessions.begin() as session:
            purged = await repo.purge_pending(session)
        if purged:
            log.info("newsletter pending sign-ups purged", count=purged)

    async def refresh_gauge(self) -> None:
        async with self._sessions() as session:
            found = await repo.counts(session)
        for status, count in found.items():
            NEWSLETTER_SUBSCRIBERS.labels(status=status.value).set(count)

    def _post_email(self, post: NewsletterPost, to: str, subscriber_id: uuid.UUID) -> OutgoingEmail:
        token = unsubscribe_token(self._key, subscriber_id)
        return post_email(
            sender=self._mail_from,
            to=to,
            title=post.title,
            excerpt=post.excerpt,
            post_url=post_url(self._site_url, post.slug),
            unsubscribe_page_url=f"{self._site_url}/newsletter/unsubscribe?token={token}",
            unsubscribe_api_url=f"{self._api_url}/v1/newsletter/unsubscribe?token={token}",
            idempotency_key=f"newsletter-{post.id}-{subscriber_id}",
        )

    async def send(self, post_id: int, *, test: bool) -> SendResult:
        """Email a published post. A test goes only to CONTACT_TO and records nothing."""
        if self._posts is None:
            raise SendRefusedError(503, "posts_unavailable", "Directus is not configured.")
        post = await self._posts.fetch_post(post_id)  # DirectusError propagates to the router
        if post is None or not post.published:
            raise SendRefusedError(409, "not_published", "The post is not published.")
        if test:
            return await self._send_test(post)
        if self._lock.locked():
            raise SendRefusedError(
                409,
                "send_in_progress",
                "Another newsletter send is in progress. Try again in a minute.",
            )
        async with self._lock:
            return await self._send_all(post)

    async def _send_test(self, post: NewsletterPost) -> SendResult:
        if not self._test_to:
            raise SendRefusedError(503, "test_unavailable", "CONTACT_TO is not set.")
        # The all-zero id is never a subscriber: its unsubscribe link answers 200, harmlessly.
        email = self._post_email(post, self._test_to, uuid.UUID(int=0))
        try:
            # A fresh key per click: every test send really goes out.
            await self._sender.send(
                replace(email, idempotency_key=f"newsletter-test-{uuid.uuid4()}")
            )
        except EmailSendError as exc:
            NEWSLETTER_EMAILS.labels(kind="test", result="failed").inc()
            log.warning("newsletter test email failed", post_id=post.id, error=str(exc))
            raise SendRefusedError(502, "send_failed", "The test email was not sent.") from exc
        NEWSLETTER_EMAILS.labels(kind="test", result="sent").inc()
        return SendResult("test", sent=1, remaining=0)

    async def _send_all(self, post: NewsletterPost) -> SendResult:
        async with self._sessions.begin() as session:
            existing = await repo.get_send(session, post.id)
            if existing is not None and existing.completed_at is not None:
                raise SendRefusedError(
                    409,
                    "already_sent",
                    f"Already emailed on {existing.completed_at.isoformat()}.",
                )
            await repo.start_send(session, post.id)
        sent = 0
        while True:
            async with self._sessions() as session:
                batch = await repo.undelivered(session, post.id, limit=BATCH_SIZE)
            if not batch:
                break
            if sent:
                await self._sleep(BATCH_PAUSE)
            ids = [row.id for row in batch]
            emails = [self._post_email(post, row.email, row.id) for row in batch]
            try:
                await self._sender.send_batch(emails, batch_key(post.id, ids))
            except EmailSendError as exc:
                NEWSLETTER_EMAILS.labels(kind="post", result="failed").inc(len(batch))
                log.warning("newsletter batch failed", post_id=post.id, error=str(exc))
                async with self._sessions() as session:
                    remaining = await repo.count_undelivered(session, post.id)
                return SendResult("partial", sent=sent, remaining=remaining)
            async with self._sessions.begin() as session:
                await repo.record_deliveries(session, post.id, ids)
            NEWSLETTER_EMAILS.labels(kind="post", result="sent").inc(len(batch))
            sent += len(batch)
        async with self._sessions.begin() as session:
            done = await repo.complete_send(session, post.id)
        log.info("newsletter sent", post_id=post.id, recipients=done.recipients)
        return SendResult(
            "complete",
            sent=sent,
            remaining=0,
            sent_at=done.completed_at,
            recipients=done.recipients,
        )

    async def subscribers(
        self,
    ) -> tuple[list[NewsletterSubscriber], dict[SubscriberStatus, int]]:
        async with self._sessions() as session:
            return await repo.list_all(session), await repo.counts(session)

    async def remove(self, subscriber_id: uuid.UUID) -> None:
        async with self._sessions.begin() as session:
            await repo.delete(session, subscriber_id)
