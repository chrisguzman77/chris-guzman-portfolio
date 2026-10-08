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


async def test_resend_includes_html_and_headers_only_when_set() -> None:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": "e1"})

    email = OutgoingEmail(
        sender="Christopher Guzman <posts@christopherguzman.me>",
        to="ada@example.com",
        subject="Hello",
        text="hi",
        html="<p>hi</p>",
        headers={"List-Unsubscribe": "<https://x/u>"},
        idempotency_key="k1",
    )
    await ResendSender(client(httpx.MockTransport(handle)), "re_key").send(email)
    assert json.loads(seen[0].content) == {
        "from": email.sender,
        "to": ["ada@example.com"],
        "subject": "Hello",
        "text": "hi",
        "html": "<p>hi</p>",
        "headers": {"List-Unsubscribe": "<https://x/u>"},
    }


async def test_resend_batch_posts_every_email_with_one_key() -> None:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"data": [{"id": "e1"}, {"id": "e2"}]})

    emails = [
        OutgoingEmail(
            sender="S <s@x.me>", to=f"{n}@example.com", subject="T", text="t", idempotency_key=""
        )
        for n in ("a", "b")
    ]
    await ResendSender(client(httpx.MockTransport(handle)), "re_key").send_batch(emails, "batch-1")
    req = seen[0]
    assert str(req.url) == "https://api.resend.com/emails/batch"
    assert req.headers["idempotency-key"] == "batch-1"
    assert [e["to"] for e in json.loads(req.content)] == [["a@example.com"], ["b@example.com"]]


async def test_resend_batch_failure_raises_without_the_key() -> None:
    transport = httpx.MockTransport(
        lambda _: httpx.Response(429, json={"name": "daily_quota_exceeded"})
    )
    with pytest.raises(EmailSendError) as info:
        await ResendSender(client(transport), "re_key").send_batch([EMAIL], "b")
    assert "429" in str(info.value) and "re_key" not in str(info.value)


async def test_resend_errors_name_the_error_but_never_echo_addresses() -> None:
    body = {"name": "validation_error", "message": "Invalid `to` field: victim@example.com"}
    transport = httpx.MockTransport(lambda _: httpx.Response(422, json=body))
    with pytest.raises(EmailSendError) as info:
        await ResendSender(client(transport), "re_key").send(EMAIL)
    assert str(info.value) == "resend 422: validation_error"
    assert "victim@example.com" not in str(info.value)


async def test_resend_error_without_a_name_is_just_the_status() -> None:
    transport = httpx.MockTransport(lambda _: httpx.Response(502, text="bad gateway a@b.co"))
    with pytest.raises(EmailSendError) as info:
        await ResendSender(client(transport), "re_key").send(EMAIL)
    assert str(info.value) == "resend 502"
