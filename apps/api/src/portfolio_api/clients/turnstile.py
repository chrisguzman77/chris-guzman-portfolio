from typing import Protocol

import httpx
from pydantic import BaseModel, ValidationError

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


class TurnstileUnavailableError(Exception):
    """Cloudflare could not answer (network error, timeout, 5xx or garbled reply)."""


class TurnstileVerifier(Protocol):
    async def verify(self, token: str, remote_ip: str | None) -> bool: ...


class _SiteverifyResult(BaseModel):
    success: bool = False


class CloudflareTurnstile:
    def __init__(self, http: httpx.AsyncClient, secret: str) -> None:
        self._http = http
        self._secret = secret

    async def verify(self, token: str, remote_ip: str | None) -> bool:
        data = {"secret": self._secret, "response": token}
        if remote_ip:
            data["remoteip"] = remote_ip
        try:
            res = await self._http.post(SITEVERIFY_URL, data=data, timeout=5.0)
        except httpx.HTTPError as exc:
            raise TurnstileUnavailableError(type(exc).__name__) from exc
        if res.status_code >= 500:
            raise TurnstileUnavailableError(f"siteverify {res.status_code}")
        try:
            result = _SiteverifyResult.model_validate_json(res.content)
        except ValidationError as exc:
            raise TurnstileUnavailableError("siteverify returned an unexpected body") from exc
        return res.status_code == 200 and result.success
