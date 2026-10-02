from dataclasses import dataclass
from typing import Protocol

import httpx

RESEND_URL = "https://api.resend.com/emails"


@dataclass(frozen=True)
class OutgoingEmail:
    sender: str
    to: str
    reply_to: str
    subject: str
    text: str
    # Resend drops a repeat with the same key, so a retry after a lost DB write is not resent.
    idempotency_key: str


class EmailSendError(Exception):
    """The email was not accepted. The message never contains the API key."""


class EmailSender(Protocol):
    async def send(self, email: OutgoingEmail) -> None: ...


class ResendSender:
    def __init__(self, http: httpx.AsyncClient, api_key: str) -> None:
        self._http = http
        self._api_key = api_key

    async def send(self, email: OutgoingEmail) -> None:
        try:
            res = await self._http.post(
                RESEND_URL,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Idempotency-Key": email.idempotency_key,
                },
                json={
                    "from": email.sender,
                    "to": [email.to],
                    "reply_to": email.reply_to,
                    "subject": email.subject,
                    "text": email.text,
                },
                timeout=10.0,
            )
        except httpx.HTTPError as exc:
            raise EmailSendError(f"resend request failed: {type(exc).__name__}") from exc
        if not res.is_success:
            raise EmailSendError(f"resend {res.status_code}: {res.text[:200]}")
