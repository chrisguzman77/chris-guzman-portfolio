import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.clients.email import EmailSender, EmailSendError, OutgoingEmail
from portfolio_api.models import ContactSubmission, EmailStatus
from portfolio_api.repositories import contact as repo

log = structlog.get_logger()


@dataclass(frozen=True)
class ContactForm:
    name: str
    email: str
    message: str


def build_email(row: ContactSubmission, *, sender: str, to: str) -> OutgoingEmail:
    # Collapsing whitespace removes CR/LF, so a name cannot inject extra headers.
    subject_name = " ".join(row.name.split())
    received = row.created_at.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC")
    text = f"Name: {row.name}\nEmail: {row.email}\nReceived: {received}\n\n{row.message}\n"
    return OutgoingEmail(
        sender=sender,
        to=to,
        reply_to=row.email,
        subject=f"Portfolio message from {subject_name}",
        text=text,
        idempotency_key=str(row.id),
    )


def _utcnow() -> datetime:
    return datetime.now(UTC)


class ContactService:
    """Persist-then-send: a message is in the database before any email is attempted."""

    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        sender: EmailSender | None,
        *,
        mail_from: str,
        mail_to: str | None,
        clock: Callable[[], datetime] = _utcnow,
    ) -> None:
        self._sessions = sessions
        self._sender = sender
        self._mail_from = mail_from
        self._mail_to = mail_to
        self._clock = clock

    async def submit(self, form: ContactForm) -> uuid.UUID:
        async with self._sessions.begin() as session:
            return await repo.create(
                session, name=form.name, email=form.email, message=form.message
            )

    async def deliver(self, submission_id: uuid.UUID) -> None:
        if self._sender is None or self._mail_to is None:
            log.warning(
                "contact email not configured; message kept", submission_id=str(submission_id)
            )
            return
        async with self._sessions() as session:
            row = await repo.get(session, submission_id)
        if row is None or row.email_status == EmailStatus.sent:
            return
        try:
            await self._sender.send(build_email(row, sender=self._mail_from, to=self._mail_to))
        except EmailSendError as exc:
            async with self._sessions.begin() as session:
                attempts = await repo.record_failure(session, submission_id, str(exc))
            if attempts >= repo.MAX_ATTEMPTS:
                log.error(
                    "contact email gave up", submission_id=str(submission_id), attempts=attempts
                )
            else:
                log.warning("contact email failed; will retry", submission_id=str(submission_id))
            return
        async with self._sessions.begin() as session:
            await repo.record_sent(session, submission_id)
        log.info("contact email sent", submission_id=str(submission_id))

    async def retry_due(self) -> None:
        if self._sender is None or self._mail_to is None:
            return
        async with self._sessions() as session:
            due = await repo.due_for_retry(session, now=self._clock())
        for submission_id in due:
            try:
                await self.deliver(submission_id)
            except Exception:
                # One bad row must not stall every row after it.
                log.exception("contact retry failed", submission_id=str(submission_id))
