import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.types import Message, Receive, Scope, Send

from portfolio_api.body_limit import BodySizeLimit
from portfolio_api.config import Settings
from portfolio_api.db import make_engine
from portfolio_api.errors import ApiError
from portfolio_api.jobs import Job, run_forever
from portfolio_api.main import create_app
from portfolio_api.models import ContactSubmission, EmailStatus, GitHubActivityCache


class Body(BaseModel):
    name: str


def app_with_routes(settings: Settings) -> FastAPI:
    app = create_app(settings)

    @app.get("/boom")
    async def boom() -> None:  # pyright: ignore[reportUnusedFunction]
        raise ApiError(418, "teapot", "I am a teapot.", headers={"Retry-After": "7"})

    @app.get("/crash")
    async def crash() -> None:  # pyright: ignore[reportUnusedFunction]
        raise RuntimeError("kaboom")

    @app.post("/echo")
    async def echo(body: Body) -> Body:  # pyright: ignore[reportUnusedFunction]
        return body

    return app


async def call(app: FastAPI, method: str, path: str, **kwargs: object):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.request(method, path, **kwargs)  # pyright: ignore[reportArgumentType]


async def test_api_error_uses_the_error_shape_and_headers(settings: Settings) -> None:
    res = await call(app_with_routes(settings), "GET", "/boom")
    assert res.status_code == 418
    assert res.json() == {"error": {"code": "teapot", "message": "I am a teapot."}}
    assert res.headers["retry-after"] == "7"


async def test_validation_errors_become_400_with_fields(settings: Settings) -> None:
    res = await call(app_with_routes(settings), "POST", "/echo", json={"name": 5})
    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "invalid_request"
    assert set(body["error"]["fields"]) == {"name"}


async def test_unknown_route_uses_the_error_shape(settings: Settings) -> None:
    res = await call(app_with_routes(settings), "GET", "/nope")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "not_found"


async def test_request_id_is_echoed_when_valid(settings: Settings) -> None:
    res = await call(app_with_routes(settings), "GET", "/boom", headers={"X-Request-ID": "abc-123"})
    assert res.headers["x-request-id"] == "abc-123"


async def test_request_id_is_generated_when_missing_or_invalid(settings: Settings) -> None:
    app = app_with_routes(settings)
    missing = await call(app, "GET", "/nope")
    invalid = await call(app, "GET", "/nope", headers={"X-Request-ID": "bad id\twith spaces"})
    for res in (missing, invalid):
        rid = res.headers["x-request-id"]
        assert len(rid) == 32 and all(ch in "0123456789abcdef" for ch in rid)


ORIGIN = {"Origin": "http://localhost:3000"}
BIG = b'{"name": "' + b"x" * (64 * 1024) + b'"}'


async def test_oversized_body_with_content_length_is_413(settings: Settings) -> None:
    for path in ("/v1/contact", "/echo"):
        res = await call(
            app_with_routes(settings),
            "POST",
            path,
            content=BIG,
            headers={"Content-Type": "application/json", **ORIGIN},
        )
        assert res.status_code == 413
        assert res.json()["error"]["code"] == "payload_too_large"
        assert res.headers["access-control-allow-origin"] == "http://localhost:3000"
        assert "x-request-id" in res.headers


async def test_oversized_streamed_body_without_length_is_413(settings: Settings) -> None:
    async def chunks() -> AsyncIterator[bytes]:
        for i in range(0, len(BIG), 4096):
            yield BIG[i : i + 4096]

    res = await call(
        app_with_routes(settings),
        "POST",
        "/echo",
        content=chunks(),
        headers={"Content-Type": "application/json"},
    )
    assert "content-length" not in res.request.headers
    assert res.status_code == 413
    assert res.json()["error"]["code"] == "payload_too_large"


async def test_normal_bodies_pass_the_size_cap(settings: Settings) -> None:
    async def chunks() -> AsyncIterator[bytes]:
        yield b'{"name": '
        yield b'"Ada"}'

    app = app_with_routes(settings)
    sized = await call(app, "POST", "/echo", json={"name": "y" * 20_000})
    streamed = await call(
        app, "POST", "/echo", content=chunks(), headers={"Content-Type": "application/json"}
    )
    assert sized.status_code == 200 and sized.json() == {"name": "y" * 20_000}
    assert streamed.status_code == 200 and streamed.json() == {"name": "Ada"}


async def test_unhandled_errors_are_json_500_with_request_id_and_cors(
    settings: Settings,
) -> None:
    res = await call(
        app_with_routes(settings), "GET", "/crash", headers={"X-Request-ID": "r-1", **ORIGIN}
    )
    assert res.status_code == 500
    assert res.json() == {"error": {"code": "internal_error", "message": "Something went wrong."}}
    assert res.headers["x-request-id"] == "r-1"
    assert res.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_blank_secrets_mean_unset() -> None:
    s = Settings(turnstile_secret="", resend_api_key="", contact_to="", github_token="")
    assert (s.turnstile_secret, s.resend_api_key, s.contact_to, s.github_token) == (None,) * 4
    assert s.contact_from == "Portfolio <contact@christopherguzman.me>"
    assert s.github_login == "chrisguzman77"


@pytest.mark.parametrize("budget", [0, -1])
def test_chat_daily_token_budget_must_be_positive(budget: int) -> None:
    with pytest.raises(ValidationError):
        Settings(chat_daily_token_budget=budget)


async def test_run_forever_survives_a_failing_run() -> None:
    calls = 0
    done = asyncio.Event()

    async def flaky() -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("first run fails")
        done.set()

    task = asyncio.create_task(run_forever(Job("flaky", 0, flaky)))
    await asyncio.wait_for(done.wait(), timeout=2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert calls >= 2


async def test_tables_exist_with_defaults(db: async_sessionmaker[AsyncSession]) -> None:
    async with db.begin() as session:
        row = ContactSubmission(name="Ada", email="ada@example.com", message="Hello there!")
        session.add(row)
        session.add(
            GitHubActivityCache(
                key="contributions", payload={"total": 1, "weeks": []}, fetched_at=datetime.now(UTC)
            )
        )
    async with db() as session:
        saved = await session.get(ContactSubmission, row.id)
        cache = await session.get(GitHubActivityCache, "contributions")
    assert saved is not None and cache is not None
    assert saved.email_status == EmailStatus.pending
    assert saved.attempts == 0
    assert saved.created_at.tzinfo is not None
    assert cache.payload == {"total": 1, "weeks": []}


@pytest.mark.parametrize("length", ["١٢".encode(), "²".encode("latin-1"), b"12x", b""])
async def test_non_ascii_digit_content_length_is_400(length: bytes) -> None:
    reached: list[bool] = []

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        reached.append(True)

    sent: list[Message] = []

    async def receive() -> Message:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: Message) -> None:
        sent.append(message)

    scope: Scope = {
        "type": "http",
        "method": "POST",
        "path": "/v1/contact",
        "headers": [(b"content-length", length)],
    }
    await BodySizeLimit(app)(scope, receive, send)
    assert reached == []
    assert sent[0]["status"] == 400


def test_engine_hides_parameters_in_errors() -> None:
    engine = make_engine("postgresql+asyncpg://nobody:nobody@127.0.0.1:1/portfolio")
    assert engine.sync_engine.hide_parameters is True


class Stop(Exception):
    pass


def recording_sleep(waits: list[float], limit: int):
    async def sleep(seconds: float) -> None:
        waits.append(seconds)
        if len(waits) >= limit:
            raise Stop

    return sleep


async def test_run_forever_backs_off_after_failures_and_resets_on_success() -> None:
    results = [False, False, False, True, False]
    waits: list[float] = []

    async def job() -> None:
        if not results.pop(0):
            raise RuntimeError("down")

    with pytest.raises(Stop):
        await run_forever(Job("flaky", 10, job), sleep=recording_sleep(waits, 5))
    assert waits == [20, 40, 80, 10, 20]


async def test_run_forever_backoff_is_capped_at_an_hour() -> None:
    waits: list[float] = []

    async def job() -> None:
        raise RuntimeError("down")

    with pytest.raises(Stop):
        await run_forever(Job("down", 1000, job), sleep=recording_sleep(waits, 3))
    assert waits == [2000, 3600, 3600]


async def test_lifespan_cleans_up_when_the_app_fails(settings: Settings) -> None:
    app = create_app(settings)
    with pytest.raises(RuntimeError):
        async with app.router.lifespan_context(app):
            raise RuntimeError("startup failed after the jobs started")
    assert app.state.http.is_closed
