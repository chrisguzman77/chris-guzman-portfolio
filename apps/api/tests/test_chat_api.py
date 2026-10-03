from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.clients.directus import ChatSettings
from portfolio_api.clients.groq import ModelBusyError, ModelUnavailableError
from portfolio_api.clients.turnstile import TurnstileUnavailableError
from portfolio_api.config import Settings
from portfolio_api.main import create_app
from portfolio_api.models import ChatUsageDaily
from portfolio_api.services.chat import ChatService, ChatSwitch
from tests.fakes import FakeChatModel, FakeChatSettingsSource, FakeRetriever, FakeTurnstile

Sessions = async_sessionmaker[AsyncSession]
IP = "203.0.113.7"


def make_app(
    settings: Settings,
    db: Sessions | None,
    *,
    model: FakeChatModel | None = None,
    turnstile: FakeTurnstile | None = None,
    enabled: bool = True,
) -> FastAPI:
    app = create_app(settings)
    app.state.turnstile = turnstile or FakeTurnstile()
    app.state.chat_switch = ChatSwitch(
        FakeChatSettingsSource(ChatSettings(enabled=enabled, suggested_questions=[]))
    )
    app.state.chat_service = (
        ChatService(
            db,
            FakeRetriever(),
            model or FakeChatModel(),
            hash_salt="salt",
            daily_budget=180_000,
            min_similarity=0.5,
        )
        if db is not None
        else None
    )
    return app


async def call(app: FastAPI, path: str, body: Any, ip: str = IP) -> Response:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.post(path, json=body, headers={"CF-Connecting-IP": ip})


async def open_session(app: FastAPI) -> str:
    res = await call(app, "/v1/chat/sessions", {"turnstile_token": "tok"})
    assert res.status_code == 201, res.text
    return res.json()["session_id"]


async def test_open_session(settings: Settings, db: Sessions) -> None:
    turnstile = FakeTurnstile()
    app = make_app(settings, db, turnstile=turnstile)
    res = await call(app, "/v1/chat/sessions", {"turnstile_token": "tok"})
    assert res.status_code == 201
    assert res.json()["questions_left"] == 10
    assert turnstile.calls == [("tok", IP)]


@pytest.mark.parametrize(
    ("result", "status", "code"),
    [
        (False, 400, "turnstile_failed"),
        (TurnstileUnavailableError("down"), 503, "turnstile_unavailable"),
    ],
)
async def test_open_session_turnstile_failures(
    settings: Settings, db: Sessions, result: bool | Exception, status: int, code: str
) -> None:
    app = make_app(settings, db, turnstile=FakeTurnstile(result))
    res = await call(app, "/v1/chat/sessions", {"turnstile_token": "tok"})
    assert (res.status_code, res.json()["error"]["code"]) == (status, code)


async def test_disabled_or_unconfigured_chat(settings: Settings, db: Sessions) -> None:
    for app in (make_app(settings, db, enabled=False), make_app(settings, None)):
        res = await call(app, "/v1/chat/sessions", {"turnstile_token": "tok"})
        assert (res.status_code, res.json()["error"]["code"]) == (503, "chat_disabled")


async def test_session_rate_limit(settings: Settings, db: Sessions) -> None:
    app = make_app(settings, db)
    for _ in range(10):
        await open_session(app)
    res = await call(app, "/v1/chat/sessions", {"turnstile_token": "tok"})
    assert res.status_code == 429 and res.json()["error"]["code"] == "rate_limited"
    assert int(res.headers["Retry-After"]) > 0


async def test_ask(settings: Settings, db: Sessions) -> None:
    app = make_app(settings, db)
    sid = await open_session(app)
    res = await call(app, f"/v1/chat/sessions/{sid}/messages", {"question": "  FastAPI?  "})
    assert res.status_code == 200
    assert res.json() == {
        "answer": "He built it with FastAPI [1].",
        "sources": [{"n": 1, "title": "ACM@AU platform", "url": "/projects/acm"}],
        "outcome": "answered",
        "questions_left": 9,
    }


@pytest.mark.parametrize("question", ["   ", "x" * 501])
async def test_ask_validates_question(settings: Settings, db: Sessions, question: str) -> None:
    app = make_app(settings, db)
    sid = await open_session(app)
    res = await call(app, f"/v1/chat/sessions/{sid}/messages", {"question": question})
    assert res.status_code == 400 and res.json()["error"]["code"] == "invalid_request"


@pytest.mark.parametrize(
    ("error", "status", "code", "retry_after"),
    [
        (ModelBusyError("429"), 503, "model_busy", "60"),
        (ModelUnavailableError("500"), 503, "chat_unavailable", None),
    ],
)
async def test_model_errors(
    settings: Settings,
    db: Sessions,
    error: Exception,
    status: int,
    code: str,
    retry_after: str | None,
) -> None:
    app = make_app(settings, db, model=FakeChatModel(error))
    sid = await open_session(app)
    res = await call(app, f"/v1/chat/sessions/{sid}/messages", {"question": "q?"})
    assert (res.status_code, res.json()["error"]["code"]) == (status, code)
    assert res.headers.get("Retry-After") == retry_after


async def test_budget_exhausted(settings: Settings, db: Sessions) -> None:
    from datetime import UTC, datetime

    app = make_app(settings, db)
    sid = await open_session(app)
    async with db.begin() as session:
        session.add(ChatUsageDaily(day=datetime.now(UTC).date(), tokens=999_999, requests=1))
    res = await call(app, f"/v1/chat/sessions/{sid}/messages", {"question": "q?"})
    assert (res.status_code, res.json()["error"]["code"]) == (503, "budget_exhausted")


async def test_unknown_session_and_other_ip(settings: Settings, db: Sessions) -> None:
    app = make_app(settings, db)
    sid = await open_session(app)
    unknown = "00000000-0000-4000-8000-000000000000"
    res = await call(app, f"/v1/chat/sessions/{unknown}/messages", {"question": "q?"})
    assert (res.status_code, res.json()["error"]["code"]) == (404, "session_not_found")
    res = await call(
        app, f"/v1/chat/sessions/{sid}/messages", {"question": "q?"}, ip="198.51.100.9"
    )
    assert res.status_code == 404


async def test_session_limit_is_409(settings: Settings, db: Sessions) -> None:
    app = make_app(settings, db)
    sid = await open_session(app)
    limiter = app.state.chat_message_limiter
    for i in range(10):
        limiter._hits.clear()  # pyright: ignore[reportPrivateUsage]  # isolate the session cap
        res = await call(app, f"/v1/chat/sessions/{sid}/messages", {"question": f"q{i}?"})
        assert res.status_code == 200
    limiter._hits.clear()  # pyright: ignore[reportPrivateUsage]
    res = await call(app, f"/v1/chat/sessions/{sid}/messages", {"question": "one more?"})
    assert (res.status_code, res.json()["error"]["code"]) == (409, "session_limit")


async def test_message_rate_limit(settings: Settings, db: Sessions) -> None:
    app = make_app(settings, db)
    sid = await open_session(app)
    for i in range(5):
        await call(app, f"/v1/chat/sessions/{sid}/messages", {"question": f"q{i}?"})
    res = await call(app, f"/v1/chat/sessions/{sid}/messages", {"question": "sixth?"})
    assert res.status_code == 429 and res.json()["error"]["code"] == "rate_limited"


def test_wiring_depends_on_settings(settings: Settings) -> None:
    off = create_app(settings)
    assert off.state.chat_service is None and off.state.indexer is None
    on = create_app(
        settings.model_copy(
            update={
                "groq_api_key": "gsk",
                "directus_token": "tok",
                "turnstile_secret": "sec",
                "chat_hash_salt": "salt",
            }
        )
    )
    assert isinstance(on.state.chat_service, ChatService)
    assert on.state.indexer is not None and on.state.chat_switch is not None
    partial = create_app(settings.model_copy(update={"directus_token": "tok"}))
    assert partial.state.indexer is not None and partial.state.chat_service is None
