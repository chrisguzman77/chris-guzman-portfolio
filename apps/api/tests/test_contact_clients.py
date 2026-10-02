import json

import httpx
import pytest

from portfolio_api.clients.email import EmailSendError, OutgoingEmail, ResendSender
from portfolio_api.clients.turnstile import CloudflareTurnstile, TurnstileUnavailableError


def client(handler: httpx.MockTransport) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=handler)


async def test_turnstile_posts_secret_token_and_ip() -> None:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"success": True})

    ok = await CloudflareTurnstile(client(httpx.MockTransport(handle)), "sec").verify(
        "tok", "1.2.3.4"
    )
    assert ok is True
    form = dict(x.split("=") for x in seen[0].content.decode().split("&"))
    assert form == {"secret": "sec", "response": "tok", "remoteip": "1.2.3.4"}
    assert str(seen[0].url) == "https://challenges.cloudflare.com/turnstile/v0/siteverify"


async def test_turnstile_rejection_is_false() -> None:
    transport = httpx.MockTransport(lambda _: httpx.Response(200, json={"success": False}))
    assert await CloudflareTurnstile(client(transport), "sec").verify("tok", None) is False


@pytest.mark.parametrize(
    "response",
    [httpx.Response(502, text="bad gateway"), httpx.Response(200, text="not json")],
)
async def test_turnstile_server_errors_are_unavailable(response: httpx.Response) -> None:
    transport = httpx.MockTransport(lambda _: response)
    with pytest.raises(TurnstileUnavailableError):
        await CloudflareTurnstile(client(transport), "sec").verify("tok", None)


async def test_turnstile_network_errors_are_unavailable() -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    with pytest.raises(TurnstileUnavailableError):
        await CloudflareTurnstile(client(httpx.MockTransport(boom)), "sec").verify("tok", None)


EMAIL = OutgoingEmail(
    sender="Portfolio <contact@christopherguzman.me>",
    to="chris@example.com",
    reply_to="ada@example.com",
    subject="Portfolio message from Ada",
    text="hi",
    idempotency_key="0b6f1c1e-0000-4000-8000-000000000001",
)


async def test_resend_sends_plain_text_with_reply_to() -> None:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": "e1"})

    await ResendSender(client(httpx.MockTransport(handle)), "re_key").send(EMAIL)
    req = seen[0]
    assert str(req.url) == "https://api.resend.com/emails"
    assert req.headers["authorization"] == "Bearer re_key"
    assert req.headers["idempotency-key"] == "0b6f1c1e-0000-4000-8000-000000000001"
    assert json.loads(req.content) == {
        "from": EMAIL.sender,
        "to": ["chris@example.com"],
        "reply_to": "ada@example.com",
        "subject": "Portfolio message from Ada",
        "text": "hi",
    }


async def test_resend_errors_never_include_the_key() -> None:
    transport = httpx.MockTransport(lambda _: httpx.Response(401, json={"message": "invalid"}))
    with pytest.raises(EmailSendError) as info:
        await ResendSender(client(transport), "re_secret_key").send(EMAIL)
    assert "401" in str(info.value)
    assert "re_secret_key" not in str(info.value)
