from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

RESEND_URL = "https://api.resend.com/emails"
RESEND_BATCH_URL = "https://api.resend.com/emails/batch"


@dataclass(frozen=True)
class OutgoingEmail:
    sender: str
    to: str
    subject: str
    text: str
    # Resend drops a repeat with the same key, so a retry after a lost DB write is not resent.
    idempotency_key: str
    reply_to: str | None = None
    html: str | None = None
    headers: dict[str, str] | None = None


class EmailSendError(Exception):
    """The email was not accepted. The message never contains the API key."""


class EmailSender(Protocol):
    async def send(self, email: OutgoingEmail) -> None: ...


class BatchEmailSender(EmailSender, Protocol):
    async def send_batch(self, emails: Sequence[OutgoingEmail], idempotency_key: str) -> None: ...


def _payload(email: OutgoingEmail) -> dict[str, Any]:
    body: dict[str, Any] = {
        "from": email.sender,
        "to": [email.to],
        "subject": email.subject,
        "text": email.text,
    }
    if email.reply_to is not None:
        body["reply_to"] = email.reply_to
    if email.html is not None:
        body["html"] = email.html
    if email.headers:
        body["headers"] = email.headers
    return body


def _describe(res: httpx.Response) -> str:
    """Status plus Resend's error name; the body can echo recipient addresses, so it is dropped."""
    try:
        name = res.json().get("name")
    except (ValueError, AttributeError):
        name = None
    return (
        f"resend {res.status_code}: {name}"
        if isinstance(name, str)
        else f"resend {res.status_code}"
    )


class ResendSender:
    def __init__(self, http: httpx.AsyncClient, api_key: str) -> None:
        self._http = http
        self._api_key = api_key

    async def _post(self, url: str, key: str, body: object, seconds: float) -> None:
        try:
            res = await self._http.post(
                url,
                headers={"Authorization": f"Bearer {self._api_key}", "Idempotency-Key": key},
                json=body,
                timeout=seconds,
            )
        except httpx.HTTPError as exc:
            raise EmailSendError(f"resend request failed: {type(exc).__name__}") from exc
        if not res.is_success:
            raise EmailSendError(_describe(res))

    async def send(self, email: OutgoingEmail) -> None:
        await self._post(RESEND_URL, email.idempotency_key, _payload(email), 10.0)

    async def send_batch(self, emails: Sequence[OutgoingEmail], idempotency_key: str) -> None:
        """Up to 100 emails in one request; Resend accepts all or none of them."""
        await self._post(RESEND_BATCH_URL, idempotency_key, [_payload(e) for e in emails], 30.0)
