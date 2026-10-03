import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from portfolio_api.clients.groq import (
    GROQ_URL,
    ChatTurn,
    GroqChatModel,
    ModelBusyError,
    ModelReply,
    ModelUnavailableError,
)

TURNS = [ChatTurn("system", "rules"), ChatTurn("user", "question")]


def completion(content: str | None = " Yes [1]. ", **usage: int) -> dict[str, Any]:
    return {
        "choices": [
            {"message": {"role": "assistant", "content": content}, "finish_reason": "stop"}
        ],
        "usage": {"prompt_tokens": 1200, "completion_tokens": 80, **usage},
    }


def model(
    handler: Callable[[httpx.Request], httpx.Response],
) -> tuple[GroqChatModel, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    http = httpx.AsyncClient(transport=httpx.MockTransport(record))
    return GroqChatModel(http, "gsk_test", "openai/gpt-oss-120b"), seen


async def test_request_shape() -> None:
    m, seen = model(lambda _: httpx.Response(200, json=completion()))
    await m.complete(TURNS)
    [req] = seen
    assert str(req.url) == GROQ_URL
    assert req.headers["authorization"] == "Bearer gsk_test"
    assert json.loads(req.content) == {
        "model": "openai/gpt-oss-120b",
        "messages": [
            {"role": "system", "content": "rules"},
            {"role": "user", "content": "question"},
        ],
        "temperature": 0.2,
        "max_completion_tokens": 700,
        "reasoning_effort": "low",
        "include_reasoning": False,
    }


async def test_reply_is_stripped_and_usage_read() -> None:
    m, _ = model(lambda _: httpx.Response(200, json=completion()))
    assert await m.complete(TURNS) == ModelReply("Yes [1].", 1200, 80)


async def test_null_content_is_empty_text() -> None:
    m, _ = model(lambda _: httpx.Response(200, json=completion(None)))
    assert (await m.complete(TURNS)).text == ""


async def test_429_is_busy() -> None:
    m, _ = model(lambda _: httpx.Response(429, json={"error": {"message": "rate"}}))
    with pytest.raises(ModelBusyError):
        await m.complete(TURNS)


@pytest.mark.parametrize(
    "reply",
    [
        httpx.Response(500),
        httpx.Response(401, json={}),
        httpx.Response(200, content=b"<html>"),
        httpx.Response(200, json={"choices": []}),
    ],
)
async def test_bad_replies_are_unavailable(reply: httpx.Response) -> None:
    m, _ = model(lambda _: reply)
    with pytest.raises(ModelUnavailableError):
        await m.complete(TURNS)


async def test_timeout_is_unavailable_and_hides_the_key() -> None:
    def slow(_: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out")

    m, _ = model(slow)
    with pytest.raises(ModelUnavailableError) as info:
        await m.complete(TURNS)
    assert "gsk_test" not in str(info.value)
