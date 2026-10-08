"""Blog subscriptions: double opt-in sign-up, confirm, unsubscribe and post sends."""

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.clients.email import BatchEmailSender, EmailSendError
from portfolio_api.metrics import (
    NEWSLETTER_CONFIRMATIONS,
    NEWSLETTER_EMAILS,
    NEWSLETTER_SUBSCRIBERS,
    NEWSLETTER_UNSUBSCRIBES,
)
from portfolio_api.newsletter_tokens import hash_token, new_confirm_token, read_unsubscribe_token
from portfolio_api.repositories import newsletter as repo
from portfolio_api.repositories.newsletter import ConfirmResult
from portfolio_api.services.newsletter_email import confirm_email

log = structlog.get_logger()


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
    ) -> None:
        self._sessions = sessions
        self._sender = sender
        self._mail_from = mail_from
        self._site_url = site_url.rstrip("/")
        self._api_url = api_url.rstrip("/")
        self._key = unsubscribe_key

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
