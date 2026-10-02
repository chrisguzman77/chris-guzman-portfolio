import asyncio
from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.config import Settings
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


def test_blank_secrets_mean_unset() -> None:
    s = Settings(turnstile_secret="", resend_api_key="", contact_to="", github_token="")
    assert (s.turnstile_secret, s.resend_api_key, s.contact_to, s.github_token) == (None,) * 4
    assert s.contact_from == "Portfolio <contact@christopherguzman.me>"
    assert s.github_login == "chrisguzman77"


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
