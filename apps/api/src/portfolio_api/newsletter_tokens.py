"""Newsletter link tokens.

Confirm tokens are random and stored only as a sha256. Unsubscribe tokens are not stored:
``<subscriber id>.<HMAC>``, so they stop working when the row is deleted. The HMAC key is
derived from INTERNAL_API_SECRET; rotating that secret invalidates old unsubscribe links.
"""

import base64
import hashlib
import hmac
import secrets
import uuid

_KEY_LABEL = b"newsletter-unsubscribe-v1"


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_confirm_token() -> tuple[str, str]:
    """A fresh confirm token and the hash to store."""
    token = secrets.token_urlsafe(32)
    return token, hash_token(token)


def unsubscribe_key(internal_secret: str) -> bytes:
    return hmac.new(internal_secret.encode(), _KEY_LABEL, hashlib.sha256).digest()


def unsubscribe_token(key: bytes, subscriber_id: uuid.UUID) -> str:
    mac = hmac.new(key, f"unsub:{subscriber_id}".encode(), hashlib.sha256).digest()
    return f"{subscriber_id}.{base64.urlsafe_b64encode(mac).rstrip(b'=').decode()}"


def read_unsubscribe_token(key: bytes, token: str) -> uuid.UUID | None:
    """The subscriber id if the token is genuine, else None."""
    id_part, _, _ = token.partition(".")
    try:
        subscriber_id = uuid.UUID(id_part)
    except ValueError:
        return None
    if str(subscriber_id) != id_part:  # only the canonical form we issue
        return None
    expected = unsubscribe_token(key, subscriber_id)
    return subscriber_id if hmac.compare_digest(expected.encode(), token.encode()) else None
