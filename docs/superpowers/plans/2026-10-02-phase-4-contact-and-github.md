# Phase 4: Contact Form and GitHub Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a contact form on `/contact` that reliably reaches Chris's inbox and a GitHub contribution heatmap on the home page, both backed by the FastAPI service and both degrading gracefully.

**Architecture:** The API gains a shared foundation (error shape, request IDs, background jobs, two tables), then `POST /v1/contact` (rate limit → configured check → validation → honeypot → Turnstile → persist → background send via Resend with retries) and `GET /v1/github/activity` (served from a Postgres cache an hourly job fills from GitHub GraphQL). The browser posts the form straight to `api.christopherguzman.me`; the home page reads the heatmap server-side over the Docker network.

**Tech Stack:** FastAPI, SQLAlchemy 2 async + asyncpg, Alembic, httpx, Pydantic v2, structlog, pytest; Next.js 16 App Router, React 19, Tailwind 4, zod 4, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-02-phase-4-contact-and-github-design.md` (binding; this plan implements it).

## Global Constraints

- Contact fields: `name` trimmed 1–100 chars; `email` valid address (≤ 254); `message` trimmed 10–5000 chars; `turnstile_token` 1–2048 chars; `website` honeypot (must be empty).
- Contact processing order: rate limit (5/min and 20/day per IP) → configured check (`503 contact_unavailable`) → validation (`400 invalid_request` with `error.fields`) → honeypot (`202`, store nothing) → Turnstile (`400 turnstile_failed`; unreachable → `503 turnstile_unavailable`) → persist `pending` → `202 {"status": "received"}` → background send.
- Client IP: `CF-Connecting-IP`, falling back to the socket peer. No IP or IP hash is ever stored.
- Email: plain text; From `API_CONTACT_FROM` (default `Portfolio <contact@christopherguzman.me>`), To `API_CONTACT_TO`, Reply-To the visitor, subject `Portfolio message from {name}` with CR/LF stripped. No auto-reply.
- Retries: every 5 minutes, rows `failed` or `pending` and not updated for 5 minutes, while `attempts < 5`. Missing Resend key or inbox → skip without counting an attempt.
- Error shape everywhere: `{"error": {"code", "message"}}` (+ `fields` for `invalid_request`); every response echoes `X-Request-ID`.
- GitHub: GraphQL contribution calendar for `API_GITHUB_LOGIN` (default `chrisguzman77`); levels `NONE`→0 … `FOURTH_QUARTILE`→4; cache table row key `contributions`; refresh when missing or ≥ 1 hour old; failures keep the old row; no token → no job.
- `GET /v1/github/activity`: `200` with `Cache-Control: public, max-age=300`; no row → `503 activity_unavailable` with `Cache-Control: no-store`. Never calls GitHub during a request.
- All new API settings optional; empty string (compose `${VAR:-}`) means unset.
- Web: `PageHeader` title `text-3xl`, `mt-4` under the prompt. `/contact` layout B (form left ~1.7 : 1, compact Email/LinkedIn/GitHub rows right, form first on phones). Copy strings exactly: "Send a message", "Send message", "Sending…", "Message sent. I'll reply to the email you gave.", "Too many messages. Try again later, or email me directly.", "Spam check failed. Try again.", "Couldn't send. Email me at {email} instead.", "Contact form coming soon. Email me directly.".
- Heatmap: home section "GitHub activity" after Experience, before Blog; link label `@{handle}`; footer `N contributions in the last year · updated hourly`; cell titles `3 contributions on Sep 14, 2026` / `1 contribution on …` / `No contributions on …`; grid `role="img"` with `aria-label="N GitHub contributions in the last year"`; last 22 weeks below `md`.
- Phase 3 rules still bind the web app: no emojis, Lucide icons, semantic Tailwind tokens only (no raw hex), dark default theme, external links `target="_blank" rel="noopener noreferrer"`, `pnpm build` passes with no env vars set.
- Never read/write `.env*`; never run sops or `make secrets-*`. Python via `uv` only (`uv run`, `uv add`), never pip.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Execution structure

Four tracks, each in its own git worktree off `phase-4`, with disjoint files:

| Track | Tasks | Branch |
|---|---|---|
| A: API | 1 → 2 → 3 (sequential, same worktree) | `p4-api` |
| B: Web contact | 4 | `p4-web-contact` |
| C: Web heatmap | 5 | `p4-web-heatmap` |
| D: Infra + docs | 6 | `p4-infra-docs` |

Tracks run in parallel. Task 7 (integration) merges all four into `phase-4`. Task 8 (Chris's accounts and secrets) happens after the Phase 4 PR merges; the site works without it (form shows "coming soon", heatmap hidden).

### Running API tests locally

Host port 5432 is taken on Chris's Mac, so start the dev Postgres on 55432:

```bash
POSTGRES_PORT=55432 docker compose -f infra/compose/compose.dev.yaml up -d postgres
cd apps/api
export API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio
uv run alembic upgrade head
uv run pytest
```

Parallel worktrees share that one database; DB tests truncate the Phase 4 tables, so run the API suite from only one worktree at a time (only Track A has DB tests).

---

### Task 1: API foundation (errors, request IDs, jobs, settings, tables)

**Files:**
- Modify: `apps/api/pyproject.toml` (runtime deps), `apps/api/uv.lock`
- Modify: `apps/api/src/portfolio_api/config.py`
- Create: `apps/api/src/portfolio_api/errors.py`
- Create: `apps/api/src/portfolio_api/request_id.py`
- Create: `apps/api/src/portfolio_api/jobs.py`
- Modify: `apps/api/src/portfolio_api/db.py`
- Modify: `apps/api/src/portfolio_api/models/__init__.py`
- Create: `apps/api/src/portfolio_api/models/contact.py`
- Create: `apps/api/src/portfolio_api/models/github.py`
- Create: `apps/api/alembic/versions/5c2e8a1f9d40_contact_and_github.py`
- Modify: `apps/api/src/portfolio_api/main.py`
- Modify: `apps/api/tests/conftest.py`
- Create: `apps/api/tests/test_foundation.py`
- Modify: `apps/api/README.md` (how to run DB tests locally; copy the "Running API tests locally" block above)
- Modify: `apps/api/env.example` (new optional keys, empty values)

**Interfaces:**
- Produces:
  - `portfolio_api.errors.ApiError(status: int, code: str, message: str, *, headers: dict[str, str] | None = None, fields: dict[str, str] | None = None)`; `install_error_handlers(app)`.
  - `portfolio_api.request_id.install_request_id(app)`.
  - `portfolio_api.jobs.Job(name: str, interval: float, run: Callable[[], Awaitable[None]])`; `run_forever(job) -> None`.
  - `portfolio_api.db.make_sessionmaker(engine) -> async_sessionmaker[AsyncSession]`.
  - Models `ContactSubmission`, `EmailStatus` (`pending`/`sent`/`failed`), `GitHubActivityCache`, importable from `portfolio_api.models`.
  - `create_app` locals later tasks extend: `settings`, `http: httpx.AsyncClient`, `sessions: async_sessionmaker[AsyncSession]`, `jobs: list[Job]` (the lifespan starts every job in `jobs`).
  - Settings fields: `turnstile_secret`, `resend_api_key`, `contact_to` (all `str | None`), `contact_from: str`, `github_token: str | None`, `github_login: str`.
  - Test fixture `db` (conftest): `async_sessionmaker[AsyncSession]` on a migrated Postgres with both Phase 4 tables truncated.

- [ ] **Step 1: Add runtime dependencies**

```bash
cd apps/api
uv add "httpx>=0.28" "pydantic[email]>=2.13"
```

`httpx` moves from dev-only to runtime (keep it out of the dev group if `uv add` leaves a duplicate). Expected: `pyproject.toml` lists both under `dependencies`; `uv.lock` updated.

- [ ] **Step 2: Write the failing tests**

`apps/api/tests/conftest.py` — keep the existing `settings` and `client` fixtures; add:

```python
import os
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.db import make_engine, make_sessionmaker


@pytest.fixture
async def db() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """Session factory on a real, migrated Postgres with the Phase 4 tables emptied."""
    url = os.environ.get("API_DATABASE_URL")
    if not url:
        pytest.fail("DB tests need API_DATABASE_URL pointing at a migrated Postgres (apps/api/README.md)")
    engine = make_engine(url)
    async with engine.begin() as conn:
        await conn.execute(text("TRUNCATE contact_submissions, github_activity_cache"))
    yield make_sessionmaker(engine)
    await engine.dispose()
```

(Merge the imports with the existing ones at the top of the file.)

`apps/api/tests/test_foundation.py`:

```python
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/api && uv run pytest tests/test_foundation.py -v`
Expected: collection error (`portfolio_api.errors` / `portfolio_api.jobs` / models not found).

- [ ] **Step 4: Implement settings**

`apps/api/src/portfolio_api/config.py`:

```python
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Every field is overridable via an ``API_``-prefixed env var."""

    model_config = SettingsConfigDict(env_prefix="API_", env_file=".env", extra="ignore")

    app_version: str = "dev"
    database_url: str = "postgresql+asyncpg://portfolio:portfolio@localhost:5432/portfolio"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    cors_origins: list[str] = ["http://localhost:3000"]

    # Phase 4 integrations. Each feature stays off until its secret is set.
    turnstile_secret: str | None = None
    resend_api_key: str | None = None
    contact_to: str | None = None
    contact_from: str = "Portfolio <contact@christopherguzman.me>"
    github_token: str | None = None
    github_login: str = "chrisguzman77"

    @field_validator("turnstile_secret", "resend_api_key", "contact_to", "github_token", mode="before")
    @classmethod
    def _blank_is_unset(cls, value: object) -> object:
        # Compose passes secrets that are not set yet as "" (${VAR:-}).
        return None if value == "" else value
```

- [ ] **Step 5: Implement errors, request IDs and jobs**

`apps/api/src/portfolio_api/errors.py`:

```python
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

_HTTP_CODES = {404: "not_found", 405: "method_not_allowed"}


class ApiError(Exception):
    """An error returned to clients as ``{"error": {"code", "message"}}``."""

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        *,
        headers: dict[str, str] | None = None,
        fields: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.headers = headers
        self.fields = fields


def error_body(code: str, message: str, fields: dict[str, str] | None = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if fields is not None:
        error["fields"] = fields
    return {"error": error}


def _field_name(loc: tuple[Any, ...]) -> str:
    # ("body", "email") -> "email"; a body that is not a JSON object -> "body".
    return str(loc[-1]) if len(loc) > 1 else "body"


async def _api_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, ApiError)
    return JSONResponse(
        error_body(exc.code, exc.message, exc.fields), status_code=exc.status, headers=exc.headers
    )


async def _validation_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    fields: dict[str, str] = {}
    for err in exc.errors():
        fields.setdefault(_field_name(tuple(err["loc"])), str(err["msg"]))
    return JSONResponse(
        error_body("invalid_request", "Some fields are invalid.", fields), status_code=400
    )


async def _http_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    code = _HTTP_CODES.get(exc.status_code, "http_error")
    return JSONResponse(
        error_body(code, str(exc.detail)), status_code=exc.status_code, headers=exc.headers
    )


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, _api_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(StarletteHTTPException, _http_error)
```

`apps/api/src/portfolio_api/request_id.py`:

```python
import re
import uuid
from collections.abc import Awaitable, Callable

import structlog
from fastapi import FastAPI, Request, Response

_VALID = re.compile(r"[A-Za-z0-9._-]{1,128}")


def install_request_id(app: FastAPI) -> None:
    """Echo a well-formed incoming X-Request-ID, or mint one, and bind it to every log line."""

    @app.middleware("http")
    async def request_id(  # pyright: ignore[reportUnusedFunction]
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming = request.headers.get("x-request-id", "")
        rid = incoming if _VALID.fullmatch(incoming) else uuid.uuid4().hex
        structlog.contextvars.bind_contextvars(request_id=rid)
        try:
            response = await call_next(request)
        finally:
            structlog.contextvars.unbind_contextvars("request_id")
        response.headers["X-Request-ID"] = rid
        return response
```

`apps/api/src/portfolio_api/jobs.py`:

```python
import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import structlog

log = structlog.get_logger()


@dataclass(frozen=True)
class Job:
    """A coroutine the API runs at startup and then every ``interval`` seconds while it is up."""

    name: str
    interval: float
    run: Callable[[], Awaitable[None]]


async def run_forever(job: Job) -> None:
    # One API instance, so plain asyncio tasks are enough (see docs/adr/0007).
    while True:
        try:
            await job.run()
        except Exception:
            log.exception("background job failed", job=job.name)
        await asyncio.sleep(job.interval)
```

- [ ] **Step 6: Implement the session factory and models**

`apps/api/src/portfolio_api/db.py` — add (keep `make_engine` and `ping`):

```python
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
```

`apps/api/src/portfolio_api/models/__init__.py`:

```python
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base for every table in the ``portfolio`` database."""


# Imported after Base so Alembic's autogenerate sees every table through this module.
from portfolio_api.models.contact import ContactSubmission, EmailStatus  # noqa: E402
from portfolio_api.models.github import GitHubActivityCache  # noqa: E402

__all__ = ["Base", "ContactSubmission", "EmailStatus", "GitHubActivityCache"]
```

`apps/api/src/portfolio_api/models/contact.py`:

```python
import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from portfolio_api.models import Base


class EmailStatus(enum.StrEnum):
    pending = "pending"
    sent = "sent"
    failed = "failed"


class ContactSubmission(Base):
    """A contact-form message, saved before any email is attempted."""

    __tablename__ = "contact_submissions"
    __table_args__ = (Index("ix_contact_submissions_status_updated", "email_status", "updated_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(254))
    message: Mapped[str] = mapped_column(Text)
    email_status: Mapped[EmailStatus] = mapped_column(
        Enum(EmailStatus, name="email_status", values_callable=lambda e: [m.value for m in e]),
        server_default=EmailStatus.pending.value,
    )
    attempts: Mapped[int] = mapped_column(Integer, server_default="0")
    last_error: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
```

`apps/api/src/portfolio_api/models/github.py`:

```python
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from portfolio_api.models import Base


class GitHubActivityCache(Base):
    """Last good GitHub response per key; served when GitHub is slow or down."""

    __tablename__ = "github_activity_cache"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
```

If pyright strict flags the `values_callable` lambda's parameter type, annotate it: `values_callable=lambda e: [m.value for m in e]` → define `def _enum_values(e: type[EmailStatus]) -> list[str]: return [m.value for m in e]` and pass that.

- [ ] **Step 7: Write the migration**

`apps/api/alembic/versions/5c2e8a1f9d40_contact_and_github.py`:

```python
"""contact submissions and github activity cache

Revision ID: 5c2e8a1f9d40
Revises: 37a0a41c316f
Create Date: 2026-10-02 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5c2e8a1f9d40"
down_revision: str | Sequence[str] | None = "37a0a41c316f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EMAIL_STATUS = postgresql.ENUM("pending", "sent", "failed", name="email_status", create_type=False)


def upgrade() -> None:
    """Upgrade schema."""
    postgresql.ENUM("pending", "sent", "failed", name="email_status").create(op.get_bind())
    op.create_table(
        "contact_submissions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("email_status", EMAIL_STATUS, server_default="pending", nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_contact_submissions_status_updated",
        "contact_submissions",
        ["email_status", "updated_at"],
    )
    op.create_table(
        "github_activity_cache",
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("github_activity_cache")
    op.drop_index("ix_contact_submissions_status_updated", table_name="contact_submissions")
    op.drop_table("contact_submissions")
    postgresql.ENUM(name="email_status").drop(op.get_bind())
```

Run (with the dev Postgres from "Running API tests locally"):

```bash
uv run alembic upgrade head && uv run alembic check && uv run alembic downgrade -1 && uv run alembic upgrade head
```

Expected: `No new upgrade operations detected.` from `check`; downgrade and re-upgrade succeed. If `check` reports a diff, change the migration (not the model) until it is clean, and note it in the report.

- [ ] **Step 8: Wire the app**

`apps/api/src/portfolio_api/main.py`:

```python
import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from functools import partial

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from portfolio_api.config import Settings
from portfolio_api.db import make_engine, make_sessionmaker, ping
from portfolio_api.errors import install_error_handlers
from portfolio_api.jobs import Job, run_forever
from portfolio_api.observability import configure_logging
from portfolio_api.request_id import install_request_id
from portfolio_api.routers import health


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    configure_logging(settings.log_level)
    engine = make_engine(settings.database_url)
    sessions = make_sessionmaker(engine)
    http = httpx.AsyncClient(
        timeout=10.0, headers={"User-Agent": f"portfolio-api/{settings.app_version}"}
    )
    jobs: list[Job] = []

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        tasks = [asyncio.create_task(run_forever(job), name=job.name) for job in jobs]
        yield
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await http.aclose()
        await engine.dispose()

    app = FastAPI(title="Portfolio API", version=settings.app_version, lifespan=lifespan)
    app.state.settings = settings
    app.state.db_ping = partial(ping, engine)
    app.state.sessionmaker = sessions
    app.state.http = http
    install_error_handlers(app)
    install_request_id(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.include_router(health.router)
    return app
```

`apps/api/env.example` — append:

```
# Phase 4 (optional; each feature stays off until set)
API_TURNSTILE_SECRET=
API_RESEND_API_KEY=
API_CONTACT_TO=
API_GITHUB_TOKEN=
```

- [ ] **Step 9: Run tests, lint, types**

Run: `cd apps/api && uv run pytest -v && uv run ruff check . && uv run ruff format --check . && uv run pyright`
Expected: all tests pass (including the existing health tests); ruff and pyright clean.

- [ ] **Step 10: Commit**

```bash
git add apps/api
git commit -m "feat(api): error shape, request IDs, background jobs, Phase 4 tables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Contact endpoint (rate limit, Turnstile, Resend, retries)

**Files:**
- Create: `apps/api/src/portfolio_api/ratelimit.py`
- Create: `apps/api/src/portfolio_api/clients/__init__.py` (empty)
- Create: `apps/api/src/portfolio_api/clients/turnstile.py`
- Create: `apps/api/src/portfolio_api/clients/email.py`
- Create: `apps/api/src/portfolio_api/repositories/__init__.py` (empty)
- Create: `apps/api/src/portfolio_api/repositories/contact.py`
- Create: `apps/api/src/portfolio_api/services/__init__.py` (empty)
- Create: `apps/api/src/portfolio_api/services/contact.py`
- Create: `apps/api/src/portfolio_api/schemas/contact.py`
- Create: `apps/api/src/portfolio_api/routers/contact.py`
- Modify: `apps/api/src/portfolio_api/main.py`
- Create: `apps/api/tests/fakes.py`
- Create: `apps/api/tests/test_ratelimit.py`
- Create: `apps/api/tests/test_contact_clients.py`
- Create: `apps/api/tests/test_contact.py`

**Interfaces:**
- Consumes (Task 1): `ApiError`, `Job`, `jobs` list and `sessions`/`http` locals in `create_app`, `ContactSubmission`, `EmailStatus`, fixture `db`, fixture `settings`.
- Produces:
  - `SlidingWindowLimiter(limits: list[tuple[int, float]], clock=time.monotonic, prune_every=1000)` with `hit(key: str) -> int | None` (None = allowed and recorded; int = seconds to wait, nothing recorded) and `__len__`.
  - `client_ip(request) -> str | None`.
  - `TurnstileVerifier` Protocol `verify(token, remote_ip) -> bool`, raising `TurnstileUnavailableError`; `CloudflareTurnstile(http, secret)`.
  - `OutgoingEmail(sender, to, reply_to, subject, text)`, `EmailSender` Protocol `send(email) -> None` raising `EmailSendError`; `ResendSender(http, api_key)`.
  - `ContactService(sessions, sender, *, mail_from, mail_to, clock=...)` with `submit(ContactForm) -> UUID`, `deliver(UUID)`, `retry_due()`; `build_email(row, *, sender, to) -> OutgoingEmail`.
  - `app.state.contact_limiter`, `app.state.turnstile`, `app.state.contact_service`.

- [ ] **Step 1: Write the fakes and failing tests**

`apps/api/tests/fakes.py`:

```python
from portfolio_api.clients.email import EmailSendError, OutgoingEmail


class FakeTurnstile:
    def __init__(self, result: bool | Exception = True) -> None:
        self.result = result
        self.calls: list[tuple[str, str | None]] = []

    async def verify(self, token: str, remote_ip: str | None) -> bool:
        self.calls.append((token, remote_ip))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class FakeSender:
    def __init__(self, fail_times: int = 0) -> None:
        self.fail_times = fail_times
        self.sent: list[OutgoingEmail] = []
        self.attempts = 0

    async def send(self, email: OutgoingEmail) -> None:
        self.attempts += 1
        if self.fail_times > 0:
            self.fail_times -= 1
            raise EmailSendError("resend 500: boom")
        self.sent.append(email)
```

`apps/api/tests/test_ratelimit.py`:

```python
from portfolio_api.ratelimit import SlidingWindowLimiter


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_allows_up_to_the_limit_then_reports_the_wait() -> None:
    clock = Clock()
    limiter = SlidingWindowLimiter([(5, 60)], clock=clock)
    assert [limiter.hit("a") for _ in range(5)] == [None] * 5
    clock.now += 10
    assert limiter.hit("a") == 50  # the first hit leaves the window 50 s from now


def test_window_slides_and_rejections_are_not_recorded() -> None:
    clock = Clock()
    limiter = SlidingWindowLimiter([(2, 60)], clock=clock)
    limiter.hit("a")
    limiter.hit("a")
    for _ in range(10):
        assert limiter.hit("a") is not None
    clock.now += 60
    assert limiter.hit("a") is None


def test_daily_limit_applies_after_the_minute_limit_resets() -> None:
    clock = Clock()
    limiter = SlidingWindowLimiter([(5, 60), (20, 86_400)], clock=clock)
    for _ in range(4):
        assert all(limiter.hit("a") is None for _ in range(5))
        clock.now += 61
    wait = limiter.hit("a")
    assert wait is not None and wait > 60


def test_keys_are_independent() -> None:
    limiter = SlidingWindowLimiter([(1, 60)], clock=Clock())
    assert limiter.hit("a") is None
    assert limiter.hit("a") is not None
    assert limiter.hit("b") is None


def test_wait_is_at_least_one_second() -> None:
    clock = Clock()
    limiter = SlidingWindowLimiter([(1, 60)], clock=clock)
    limiter.hit("a")
    clock.now += 59.9
    assert limiter.hit("a") == 1


def test_idle_keys_are_pruned() -> None:
    clock = Clock()
    limiter = SlidingWindowLimiter([(5, 60)], clock=clock, prune_every=3)
    limiter.hit("old")
    clock.now += 61
    limiter.hit("x")
    limiter.hit("y")  # third call prunes "old"
    assert len(limiter) == 2
```

`apps/api/tests/test_contact_clients.py`:

```python
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

    ok = await CloudflareTurnstile(client(httpx.MockTransport(handle)), "sec").verify("tok", "1.2.3.4")
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
```

`apps/api/tests/test_contact.py`:

```python
from datetime import timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.clients.turnstile import TurnstileUnavailableError
from portfolio_api.config import Settings
from portfolio_api.main import create_app
from portfolio_api.models import ContactSubmission, EmailStatus
from portfolio_api.services.contact import ContactForm, ContactService, build_email
from tests.fakes import FakeSender, FakeTurnstile

Sessions = async_sessionmaker[AsyncSession]

VALID: dict[str, Any] = {
    "name": "  Ada Lovelace ",
    "email": "ada@example.com",
    "message": "Hello Chris, let's talk about a role.",
    "turnstile_token": "tok",
    "website": "",
}


@pytest.fixture
def contact_settings(settings: Settings) -> Settings:
    return settings.model_copy(update={"turnstile_secret": "sec", "contact_to": "chris@example.com"})


def make_app(
    settings: Settings,
    db: Sessions | None,
    turnstile: FakeTurnstile | None,
    sender: FakeSender | None,
) -> FastAPI:
    app = create_app(settings)
    app.state.turnstile = turnstile
    if db is not None:
        app.state.contact_service = ContactService(
            db, sender, mail_from=settings.contact_from, mail_to=settings.contact_to
        )
    return app


async def post(app: FastAPI, body: dict[str, Any], ip: str = "203.0.113.7") -> Response:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.post("/v1/contact", json=body, headers={"CF-Connecting-IP": ip})


async def rows(db: Sessions) -> list[ContactSubmission]:
    async with db() as session:
        return list((await session.scalars(select(ContactSubmission))).all())


async def backdate(db: Sessions, minutes: int = 6) -> None:
    async with db.begin() as session:
        await session.execute(
            update(ContactSubmission).values(updated_at=func.now() - timedelta(minutes=minutes))
        )


async def test_valid_message_is_saved_then_emailed(contact_settings: Settings, db: Sessions) -> None:
    turnstile, sender = FakeTurnstile(), FakeSender()
    res = await post(make_app(contact_settings, db, turnstile, sender), VALID)

    assert res.status_code == 202
    assert res.json() == {"status": "received"}
    assert turnstile.calls == [("tok", "203.0.113.7")]
    [row] = await rows(db)
    assert (row.name, row.email_status, row.attempts) == ("Ada Lovelace", EmailStatus.sent, 1)
    assert row.sent_at is not None
    [email] = sender.sent
    assert email.to == "chris@example.com"
    assert email.reply_to == "ada@example.com"
    assert email.sender == "Portfolio <contact@christopherguzman.me>"
    assert email.subject == "Portfolio message from Ada Lovelace"
    assert "Hello Chris, let's talk about a role." in email.text


async def test_honeypot_returns_202_and_stores_nothing(
    contact_settings: Settings, db: Sessions
) -> None:
    turnstile, sender = FakeTurnstile(), FakeSender()
    res = await post(make_app(contact_settings, db, turnstile, sender), {**VALID, "website": "x"})
    assert res.status_code == 202
    assert res.json() == {"status": "received"}
    assert await rows(db) == []
    assert turnstile.calls == [] and sender.sent == []


async def test_failed_turnstile_is_400(contact_settings: Settings, db: Sessions) -> None:
    res = await post(make_app(contact_settings, db, FakeTurnstile(False), FakeSender()), VALID)
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "turnstile_failed"
    assert await rows(db) == []


async def test_unreachable_turnstile_is_503(contact_settings: Settings, db: Sessions) -> None:
    turnstile = FakeTurnstile(TurnstileUnavailableError("timeout"))
    res = await post(make_app(contact_settings, db, turnstile, FakeSender()), VALID)
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "turnstile_unavailable"


async def test_unconfigured_contact_is_503_before_validation(settings: Settings) -> None:
    res = await post(make_app(settings, None, None, None), {"name": ""})
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "contact_unavailable"


@pytest.mark.parametrize(
    ("override", "field"),
    [
        ({"name": "   "}, "name"),
        ({"name": "x" * 101}, "name"),
        ({"email": "not-an-email"}, "email"),
        ({"message": "too short"}, "message"),
        ({"message": "x" * 5001}, "message"),
        ({"turnstile_token": ""}, "turnstile_token"),
    ],
)
async def test_invalid_fields_are_400_with_field_errors(
    contact_settings: Settings, override: dict[str, Any], field: str
) -> None:
    res = await post(make_app(contact_settings, None, FakeTurnstile(), None), {**VALID, **override})
    assert res.status_code == 400
    error = res.json()["error"]
    assert error["code"] == "invalid_request"
    assert field in error["fields"]


async def test_sixth_request_in_a_minute_is_429_per_ip(contact_settings: Settings) -> None:
    app = make_app(contact_settings, None, FakeTurnstile(), None)
    invalid = {**VALID, "message": "short"}  # counted even though invalid; no DB needed
    for _ in range(5):
        assert (await post(app, invalid)).status_code == 400
    limited = await post(app, invalid)
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "rate_limited"
    assert int(limited.headers["retry-after"]) >= 1
    assert (await post(app, invalid, ip="198.51.100.9")).status_code == 400


async def test_send_failure_is_saved_as_failed_then_retried(
    contact_settings: Settings, db: Sessions
) -> None:
    sender = FakeSender(fail_times=1)
    app = make_app(contact_settings, db, FakeTurnstile(), sender)
    assert (await post(app, VALID)).status_code == 202
    [row] = await rows(db)
    assert (row.email_status, row.attempts, row.last_error) == (
        EmailStatus.failed,
        1,
        "resend 500: boom",
    )

    service: ContactService = app.state.contact_service
    await service.retry_due()  # too recent: not retried yet
    assert sender.attempts == 1
    await backdate(db)
    await service.retry_due()
    [row] = await rows(db)
    assert (row.email_status, row.attempts, row.last_error) == (EmailStatus.sent, 2, None)


async def test_retries_stop_after_five_attempts(contact_settings: Settings, db: Sessions) -> None:
    sender = FakeSender(fail_times=99)
    service = ContactService(db, sender, mail_from="f", mail_to="t@example.com")
    submission_id = await service.submit(ContactForm("Ada", "ada@example.com", "Hello there!"))
    for _ in range(7):
        await backdate(db)
        await service.retry_due()
    [row] = await rows(db)
    assert row.id == submission_id
    assert (row.email_status, row.attempts) == (EmailStatus.failed, 5)
    assert sender.attempts == 5


async def test_stuck_pending_rows_are_retried(db: Sessions) -> None:
    sender = FakeSender()
    service = ContactService(db, sender, mail_from="f", mail_to="t@example.com")
    await service.submit(ContactForm("Ada", "ada@example.com", "Hello there!"))
    await service.retry_due()
    assert sender.sent == []  # pending for less than 5 minutes: a send may still be running
    await backdate(db)
    await service.retry_due()
    assert len(sender.sent) == 1


async def test_without_resend_messages_wait_as_pending(db: Sessions) -> None:
    service = ContactService(db, None, mail_from="f", mail_to="t@example.com")
    submission_id = await service.submit(ContactForm("Ada", "ada@example.com", "Hello there!"))
    await service.deliver(submission_id)
    await backdate(db)
    await service.retry_due()
    [row] = await rows(db)
    assert (row.email_status, row.attempts) == (EmailStatus.pending, 0)


async def test_subject_strips_line_breaks(db: Sessions) -> None:
    service = ContactService(db, None, mail_from="f", mail_to="t@example.com")
    submission_id = await service.submit(
        ContactForm("Ada\r\nBcc: x@evil.test", "ada@example.com", "Hello there!")
    )
    async with db() as session:
        row = await session.get(ContactSubmission, submission_id)
    assert row is not None
    email = build_email(row, sender="f", to="t@example.com")
    assert "\r" not in email.subject and "\n" not in email.subject
    assert email.subject == "Portfolio message from Ada Bcc: x@evil.test"
```

`tests/fakes.py` is imported as `tests.fakes`; if that import fails, add an empty `apps/api/tests/__init__.py`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && uv run pytest tests/test_ratelimit.py tests/test_contact_clients.py tests/test_contact.py -v`
Expected: collection errors (modules not found).

- [ ] **Step 3: Implement the rate limiter**

`apps/api/src/portfolio_api/ratelimit.py`:

```python
import math
import time
from collections import deque
from collections.abc import Callable

from fastapi import Request


class SlidingWindowLimiter:
    """In-process limiter: a key may make ``limit`` hits per ``window`` seconds, for every pair.

    One API instance (no Redis), so memory is the source of truth. Rejected calls are not
    recorded. Keys idle for the longest window are pruned every ``prune_every`` calls.
    """

    def __init__(
        self,
        limits: list[tuple[int, float]],
        clock: Callable[[], float] = time.monotonic,
        prune_every: int = 1000,
    ) -> None:
        self._limits = limits
        self._horizon = max(window for _, window in limits)
        self._clock = clock
        self._prune_every = prune_every
        self._calls = 0
        self._hits: dict[str, deque[float]] = {}

    def hit(self, key: str) -> int | None:
        """Record a hit and return None, or return whole seconds to wait without recording."""
        now = self._clock()
        self._calls += 1
        if self._calls % self._prune_every == 0:
            self._prune(now)
        hits = self._hits.setdefault(key, deque())
        while hits and hits[0] <= now - self._horizon:
            hits.popleft()
        wait = 0.0
        for limit, window in self._limits:
            recent = [t for t in hits if t > now - window]
            if len(recent) >= limit:
                wait = max(wait, recent[-limit] + window - now)
        if wait > 0:
            return max(1, math.ceil(wait))
        hits.append(now)
        return None

    def _prune(self, now: float) -> None:
        cutoff = now - self._horizon
        for key in [k for k, v in self._hits.items() if not v or v[-1] <= cutoff]:
            del self._hits[key]

    def __len__(self) -> int:
        return len(self._hits)


def client_ip(request: Request) -> str | None:
    # The API is reachable only through the Cloudflare Tunnel (which sets CF-Connecting-IP)
    # or the internal Docker network, so the header cannot be forged from the internet.
    forwarded = request.headers.get("cf-connecting-ip", "").strip()
    if forwarded:
        return forwarded
    return request.client.host if request.client else None
```

- [ ] **Step 4: Implement the clients**

`apps/api/src/portfolio_api/clients/turnstile.py`:

```python
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
```

`apps/api/src/portfolio_api/clients/email.py`:

```python
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
                headers={"Authorization": f"Bearer {self._api_key}"},
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
```

- [ ] **Step 5: Implement the repository, service and schemas**

`apps/api/src/portfolio_api/repositories/contact.py`:

```python
import uuid
from datetime import datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from portfolio_api.models import ContactSubmission, EmailStatus

RETRY_AFTER = timedelta(minutes=5)
MAX_ATTEMPTS = 5


async def create(session: AsyncSession, *, name: str, email: str, message: str) -> uuid.UUID:
    row = ContactSubmission(name=name, email=email, message=message)
    session.add(row)
    await session.flush()
    return row.id


async def get(session: AsyncSession, submission_id: uuid.UUID) -> ContactSubmission | None:
    return await session.get(ContactSubmission, submission_id)


async def record_sent(session: AsyncSession, submission_id: uuid.UUID) -> None:
    await session.execute(
        update(ContactSubmission)
        .where(ContactSubmission.id == submission_id)
        .values(
            email_status=EmailStatus.sent,
            attempts=ContactSubmission.attempts + 1,
            last_error=None,
            sent_at=func.now(),
            updated_at=func.now(),
        )
    )


async def record_failure(session: AsyncSession, submission_id: uuid.UUID, error: str) -> int:
    """Mark the row failed and return its attempt count after this failure."""
    result = await session.execute(
        update(ContactSubmission)
        .where(ContactSubmission.id == submission_id)
        .values(
            email_status=EmailStatus.failed,
            attempts=ContactSubmission.attempts + 1,
            last_error=error[:500],
            updated_at=func.now(),
        )
        .returning(ContactSubmission.attempts)
    )
    return result.scalar_one()


async def due_for_retry(
    session: AsyncSession, *, now: datetime, limit: int = 20
) -> list[uuid.UUID]:
    """Unsent rows untouched for RETRY_AFTER (failed, or pending from a send that died)."""
    stmt = (
        select(ContactSubmission.id)
        .where(
            ContactSubmission.email_status.in_([EmailStatus.pending, EmailStatus.failed]),
            ContactSubmission.attempts < MAX_ATTEMPTS,
            ContactSubmission.updated_at <= now - RETRY_AFTER,
        )
        .order_by(ContactSubmission.created_at)
        .limit(limit)
    )
    return list((await session.scalars(stmt)).all())
```

`apps/api/src/portfolio_api/services/contact.py`:

```python
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.clients.email import EmailSender, EmailSendError, OutgoingEmail
from portfolio_api.models import ContactSubmission, EmailStatus
from portfolio_api.repositories import contact as repo

log = structlog.get_logger()


@dataclass(frozen=True)
class ContactForm:
    name: str
    email: str
    message: str


def build_email(row: ContactSubmission, *, sender: str, to: str) -> OutgoingEmail:
    # Collapsing whitespace removes CR/LF, so a name cannot inject extra headers.
    subject_name = " ".join(row.name.split())
    received = row.created_at.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC")
    text = f"Name: {row.name}\nEmail: {row.email}\nReceived: {received}\n\n{row.message}\n"
    return OutgoingEmail(
        sender=sender,
        to=to,
        reply_to=row.email,
        subject=f"Portfolio message from {subject_name}",
        text=text,
    )


def _utcnow() -> datetime:
    return datetime.now(UTC)


class ContactService:
    """Persist-then-send: a message is in the database before any email is attempted."""

    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        sender: EmailSender | None,
        *,
        mail_from: str,
        mail_to: str | None,
        clock: Callable[[], datetime] = _utcnow,
    ) -> None:
        self._sessions = sessions
        self._sender = sender
        self._mail_from = mail_from
        self._mail_to = mail_to
        self._clock = clock

    async def submit(self, form: ContactForm) -> uuid.UUID:
        async with self._sessions.begin() as session:
            return await repo.create(
                session, name=form.name, email=form.email, message=form.message
            )

    async def deliver(self, submission_id: uuid.UUID) -> None:
        if self._sender is None or self._mail_to is None:
            log.warning("contact email not configured; message kept", submission_id=str(submission_id))
            return
        async with self._sessions() as session:
            row = await repo.get(session, submission_id)
        if row is None or row.email_status == EmailStatus.sent:
            return
        try:
            await self._sender.send(build_email(row, sender=self._mail_from, to=self._mail_to))
        except EmailSendError as exc:
            async with self._sessions.begin() as session:
                attempts = await repo.record_failure(session, submission_id, str(exc))
            if attempts >= repo.MAX_ATTEMPTS:
                log.error("contact email gave up", submission_id=str(submission_id), attempts=attempts)
            else:
                log.warning("contact email failed; will retry", submission_id=str(submission_id))
            return
        async with self._sessions.begin() as session:
            await repo.record_sent(session, submission_id)
        log.info("contact email sent", submission_id=str(submission_id))

    async def retry_due(self) -> None:
        if self._sender is None or self._mail_to is None:
            return
        async with self._sessions() as session:
            due = await repo.due_for_retry(session, now=self._clock())
        for submission_id in due:
            await self.deliver(submission_id)
```

`apps/api/src/portfolio_api/schemas/contact.py`:

```python
from typing import Annotated, Literal

from pydantic import BaseModel, EmailStr, StringConstraints

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Message = Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=5000)]
Token = Annotated[str, StringConstraints(min_length=1, max_length=2048)]


class ContactRequest(BaseModel):
    name: Name
    email: EmailStr  # email-validator also rejects addresses over 254 characters
    message: Message
    turnstile_token: Token
    website: str = ""  # honeypot: humans never see it, so any value means a bot


class ContactAccepted(BaseModel):
    status: Literal["received"] = "received"
```

- [ ] **Step 6: Implement the router and wire it**

`apps/api/src/portfolio_api/routers/contact.py`:

```python
from typing import Annotated

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, Request

from portfolio_api.clients.turnstile import TurnstileUnavailableError, TurnstileVerifier
from portfolio_api.errors import ApiError
from portfolio_api.ratelimit import SlidingWindowLimiter, client_ip
from portfolio_api.schemas.contact import ContactAccepted, ContactRequest
from portfolio_api.services.contact import ContactForm, ContactService

log = structlog.get_logger()
router = APIRouter(prefix="/v1", tags=["contact"])


def get_limiter(request: Request) -> SlidingWindowLimiter:
    return request.app.state.contact_limiter


def get_turnstile(request: Request) -> TurnstileVerifier | None:
    return request.app.state.turnstile


def get_contact_service(request: Request) -> ContactService:
    return request.app.state.contact_service


async def enforce_rate_limit(
    request: Request, limiter: Annotated[SlidingWindowLimiter, Depends(get_limiter)]
) -> None:
    wait = limiter.hit(client_ip(request) or "unknown")
    if wait is not None:
        raise ApiError(
            429,
            "rate_limited",
            "Too many messages. Try again later.",
            headers={"Retry-After": str(wait)},
        )


async def require_turnstile(
    turnstile: Annotated[TurnstileVerifier | None, Depends(get_turnstile)],
) -> TurnstileVerifier:
    if turnstile is None:
        raise ApiError(503, "contact_unavailable", "The contact form is not configured.")
    return turnstile


# Dependencies resolve in order before the body is validated: rate limit, then configuration.
@router.post(
    "/contact",
    status_code=202,
    response_model=ContactAccepted,
    dependencies=[Depends(enforce_rate_limit)],
)
async def submit_contact(
    request: Request,
    background: BackgroundTasks,
    turnstile: Annotated[TurnstileVerifier, Depends(require_turnstile)],
    service: Annotated[ContactService, Depends(get_contact_service)],
    body: ContactRequest,
) -> ContactAccepted:
    if body.website:
        log.info("contact honeypot tripped")
        return ContactAccepted()
    try:
        ok = await turnstile.verify(body.turnstile_token, client_ip(request))
    except TurnstileUnavailableError as exc:
        log.warning("turnstile unavailable", error=str(exc))
        raise ApiError(
            503, "turnstile_unavailable", "Spam check is unavailable. Try again later."
        ) from exc
    if not ok:
        raise ApiError(400, "turnstile_failed", "Spam check failed. Try again.")
    submission_id = await service.submit(
        ContactForm(name=body.name, email=str(body.email), message=body.message)
    )
    background.add_task(service.deliver, submission_id)
    return ContactAccepted()
```

`apps/api/src/portfolio_api/main.py` — inside `create_app`, after `app.state.http = http`:

```python
    app.state.contact_limiter = SlidingWindowLimiter([(5, 60), (20, 86_400)])
    app.state.turnstile = (
        CloudflareTurnstile(http, settings.turnstile_secret) if settings.turnstile_secret else None
    )
    sender = ResendSender(http, settings.resend_api_key) if settings.resend_api_key else None
    contact_service = ContactService(
        sessions, sender, mail_from=settings.contact_from, mail_to=settings.contact_to
    )
    app.state.contact_service = contact_service
    jobs.append(Job("contact-retry", 300, contact_service.retry_due))
```

and `app.include_router(contact.router)` after the health router, with the matching imports (`from portfolio_api.routers import contact, health`, `SlidingWindowLimiter`, `CloudflareTurnstile`, `ResendSender`, `ContactService`).

If the rate-limit test shows validation running before the dependency (FastAPI version behavior), stop and report: do not reorder the spec's processing order silently.

- [ ] **Step 7: Run tests, lint, types**

Run: `cd apps/api && uv run pytest -v && uv run ruff check . && uv run ruff format --check . && uv run pyright`
Expected: all pass, clean.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): POST /v1/contact with rate limit, Turnstile and Resend retries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: GitHub activity endpoint and refresh job

**Files:**
- Create: `apps/api/src/portfolio_api/clients/github.py`
- Create: `apps/api/src/portfolio_api/schemas/github.py`
- Create: `apps/api/src/portfolio_api/repositories/github.py`
- Create: `apps/api/src/portfolio_api/services/github.py`
- Create: `apps/api/src/portfolio_api/routers/github.py`
- Modify: `apps/api/src/portfolio_api/main.py`
- Create: `apps/api/tests/test_github.py`

**Interfaces:**
- Consumes (Task 1): `ApiError`, `Job`, `jobs`/`sessions`/`http` in `create_app`, `GitHubActivityCache`, fixtures `db`, `settings`.
- Produces: `GET /v1/github/activity` returning `{"total", "weeks": [{"days": [{"date", "count", "level"}]}], "fetched_at"}`; `GitHubActivityService(sessions, source, *, login, clock=...)` with `get()`, `refresh()`, `refresh_if_stale()`; `app.state.github_activity`.

- [ ] **Step 1: Write the failing tests**

`apps/api/tests/test_github.py`:

```python
import json
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.clients.github import GitHubError, GitHubGraphQL
from portfolio_api.config import Settings
from portfolio_api.main import create_app
from portfolio_api.schemas.github import Activity, ActivityDay, ActivityWeek
from portfolio_api.services.github import GitHubActivityService

Sessions = async_sessionmaker[AsyncSession]

ACTIVITY = Activity(
    total=3,
    weeks=[
        ActivityWeek(
            days=[
                ActivityDay(date="2026-09-13", count=0, level=0),
                ActivityDay(date="2026-09-14", count=3, level=4),
            ]
        )
    ],
)


class FakeSource:
    def __init__(self, result: Activity | Exception = ACTIVITY) -> None:
        self.result = result
        self.calls = 0

    async def fetch(self, login: str) -> Activity:
        self.calls += 1
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 10, 2, 12, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now


GRAPHQL_OK: dict[str, Any] = {
    "data": {
        "user": {
            "contributionsCollection": {
                "contributionCalendar": {
                    "totalContributions": 3,
                    "weeks": [
                        {
                            "contributionDays": [
                                {"date": "2026-09-13", "contributionCount": 0, "contributionLevel": "NONE"},
                                {"date": "2026-09-14", "contributionCount": 3, "contributionLevel": "FOURTH_QUARTILE"},
                            ]
                        }
                    ],
                }
            }
        }
    }
}


async def test_graphql_client_maps_the_calendar() -> None:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=GRAPHQL_OK)

    http = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    activity = await GitHubGraphQL(http, "gh_tok").fetch("chrisguzman77")
    assert activity == ACTIVITY
    assert seen[0].headers["authorization"] == "bearer gh_tok"
    assert json.loads(seen[0].content)["variables"] == {"login": "chrisguzman77"}


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(401, json={"message": "Bad credentials"}),
        httpx.Response(200, json={"errors": [{"message": "rate limited"}]}),
        httpx.Response(200, json={"data": {"user": None}}),
        httpx.Response(200, text="<html>"),
    ],
)
async def test_graphql_failures_raise_github_error(response: httpx.Response) -> None:
    http = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: response))
    with pytest.raises(GitHubError):
        await GitHubGraphQL(http, "gh_tok").fetch("chrisguzman77")


async def test_refresh_stores_and_get_returns_it(db: Sessions) -> None:
    clock = Clock()
    service = GitHubActivityService(db, FakeSource(), login="chrisguzman77", clock=clock)
    assert await service.get() is None
    await service.refresh()
    got = await service.get()
    assert got is not None
    assert got.total == 3 and got.weeks == ACTIVITY.weeks
    assert got.fetched_at == clock.now


async def test_failed_refresh_keeps_the_old_copy(db: Sessions) -> None:
    clock = Clock()
    await GitHubActivityService(db, FakeSource(), login="x", clock=clock).refresh()
    failing = GitHubActivityService(db, FakeSource(GitHubError("down")), login="x", clock=clock)
    await failing.refresh()
    got = await failing.get()
    assert got is not None and got.total == 3


async def test_refresh_if_stale_only_refreshes_after_an_hour(db: Sessions) -> None:
    clock = Clock()
    source = FakeSource()
    service = GitHubActivityService(db, source, login="x", clock=clock)
    await service.refresh_if_stale()  # nothing cached
    assert source.calls == 1
    clock.now += timedelta(minutes=59)
    await service.refresh_if_stale()
    assert source.calls == 1
    clock.now += timedelta(minutes=1)
    await service.refresh_if_stale()
    assert source.calls == 2


async def test_without_a_token_refresh_is_a_no_op(db: Sessions) -> None:
    service = GitHubActivityService(db, None, login="x")
    await service.refresh()
    assert await service.get() is None


async def test_endpoint_serves_the_cache_with_max_age(settings: Settings, db: Sessions) -> None:
    app = create_app(settings)
    service = GitHubActivityService(db, FakeSource(), login="x")
    app.state.github_activity = service
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        empty = await c.get("/v1/github/activity")
        await service.refresh()
        full = await c.get("/v1/github/activity")

    assert empty.status_code == 503
    assert empty.json()["error"]["code"] == "activity_unavailable"
    assert empty.headers["cache-control"] == "no-store"
    assert full.status_code == 200
    assert full.headers["cache-control"] == "public, max-age=300"
    body = full.json()
    assert body["total"] == 3
    assert body["weeks"][0]["days"][1] == {"date": "2026-09-14", "count": 3, "level": 4}
    assert "fetched_at" in body
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && uv run pytest tests/test_github.py -v`
Expected: collection error (modules not found).

- [ ] **Step 3: Implement schemas and the GraphQL client**

`apps/api/src/portfolio_api/schemas/github.py`:

```python
from datetime import datetime

from pydantic import BaseModel, Field


class ActivityDay(BaseModel):
    date: str
    count: int
    level: int = Field(ge=0, le=4)


class ActivityWeek(BaseModel):
    days: list[ActivityDay]


class Activity(BaseModel):
    total: int
    weeks: list[ActivityWeek]


class ActivityResponse(Activity):
    fetched_at: datetime
```

`apps/api/src/portfolio_api/clients/github.py`:

```python
from typing import Literal, Protocol

import httpx
from pydantic import BaseModel, ValidationError

from portfolio_api.schemas.github import Activity, ActivityDay, ActivityWeek

GRAPHQL_URL = "https://api.github.com/graphql"
QUERY = """
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount contributionLevel } }
      }
    }
  }
}
"""

Level = Literal["NONE", "FIRST_QUARTILE", "SECOND_QUARTILE", "THIRD_QUARTILE", "FOURTH_QUARTILE"]
LEVELS: dict[Level, int] = {
    "NONE": 0,
    "FIRST_QUARTILE": 1,
    "SECOND_QUARTILE": 2,
    "THIRD_QUARTILE": 3,
    "FOURTH_QUARTILE": 4,
}


class GitHubError(Exception):
    """GitHub did not return a usable calendar. Never contains the token."""


class ContributionsSource(Protocol):
    async def fetch(self, login: str) -> Activity: ...


# GraphQL field names are camelCase; these models mirror the response exactly.
class _Day(BaseModel):
    date: str
    contributionCount: int
    contributionLevel: Level


class _Week(BaseModel):
    contributionDays: list[_Day]


class _Calendar(BaseModel):
    totalContributions: int
    weeks: list[_Week]


class _Collection(BaseModel):
    contributionCalendar: _Calendar


class _User(BaseModel):
    contributionsCollection: _Collection


class _Data(BaseModel):
    user: _User | None


class _Response(BaseModel):
    data: _Data | None = None
    errors: list[dict[str, object]] | None = None


class GitHubGraphQL:
    def __init__(self, http: httpx.AsyncClient, token: str) -> None:
        self._http = http
        self._token = token

    async def fetch(self, login: str) -> Activity:
        try:
            res = await self._http.post(
                GRAPHQL_URL,
                json={"query": QUERY, "variables": {"login": login}},
                headers={"Authorization": f"bearer {self._token}"},
                timeout=15.0,
            )
        except httpx.HTTPError as exc:
            raise GitHubError(f"request failed: {type(exc).__name__}") from exc
        if res.status_code != 200:
            raise GitHubError(f"github {res.status_code}")
        try:
            parsed = _Response.model_validate_json(res.content)
        except ValidationError as exc:
            raise GitHubError("unexpected response shape") from exc
        if parsed.errors:
            raise GitHubError(f"graphql errors: {len(parsed.errors)}")
        if parsed.data is None or parsed.data.user is None:
            raise GitHubError(f"user {login!r} not found")
        calendar = parsed.data.user.contributionsCollection.contributionCalendar
        return Activity(
            total=calendar.totalContributions,
            weeks=[
                ActivityWeek(
                    days=[
                        ActivityDay(
                            date=d.date,
                            count=d.contributionCount,
                            level=LEVELS[d.contributionLevel],
                        )
                        for d in week.contributionDays
                    ]
                )
                for week in calendar.weeks
            ],
        )
```

- [ ] **Step 4: Implement the repository, service and router**

`apps/api/src/portfolio_api/repositories/github.py`:

```python
from datetime import datetime
from typing import Any

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from portfolio_api.models import GitHubActivityCache

CACHE_KEY = "contributions"


async def load(session: AsyncSession) -> GitHubActivityCache | None:
    return await session.get(GitHubActivityCache, CACHE_KEY)


async def save(session: AsyncSession, payload: dict[str, Any], fetched_at: datetime) -> None:
    stmt = insert(GitHubActivityCache).values(
        key=CACHE_KEY, payload=payload, fetched_at=fetched_at
    )
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=[GitHubActivityCache.key],
            set_={"payload": stmt.excluded.payload, "fetched_at": stmt.excluded.fetched_at},
        )
    )
```

`apps/api/src/portfolio_api/services/github.py`:

```python
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.clients.github import ContributionsSource, GitHubError
from portfolio_api.repositories import github as repo
from portfolio_api.schemas.github import ActivityResponse

log = structlog.get_logger()

STALE_AFTER = timedelta(hours=1)


def _utcnow() -> datetime:
    return datetime.now(UTC)


class GitHubActivityService:
    """Serves the cached calendar; only the background job ever talks to GitHub."""

    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        source: ContributionsSource | None,
        *,
        login: str,
        clock: Callable[[], datetime] = _utcnow,
    ) -> None:
        self._sessions = sessions
        self._source = source
        self._login = login
        self._clock = clock

    async def get(self) -> ActivityResponse | None:
        async with self._sessions() as session:
            row = await repo.load(session)
        if row is None:
            return None
        return ActivityResponse.model_validate({**row.payload, "fetched_at": row.fetched_at})

    async def refresh(self) -> None:
        if self._source is None:
            return
        try:
            activity = await self._source.fetch(self._login)
        except GitHubError as exc:
            log.warning("github refresh failed; keeping cached copy", error=str(exc))
            return
        async with self._sessions.begin() as session:
            await repo.save(session, activity.model_dump(), self._clock())
        log.info("github activity refreshed", total=activity.total)

    async def refresh_if_stale(self) -> None:
        async with self._sessions() as session:
            row = await repo.load(session)
        if row is None or self._clock() - row.fetched_at >= STALE_AFTER:
            await self.refresh()
```

`apps/api/src/portfolio_api/routers/github.py`:

```python
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from portfolio_api.errors import ApiError
from portfolio_api.schemas.github import ActivityResponse
from portfolio_api.services.github import GitHubActivityService

router = APIRouter(prefix="/v1", tags=["github"])


def get_github_activity(request: Request) -> GitHubActivityService:
    return request.app.state.github_activity


@router.get("/github/activity", response_model=ActivityResponse)
async def github_activity(
    response: Response,
    service: Annotated[GitHubActivityService, Depends(get_github_activity)],
) -> ActivityResponse:
    activity = await service.get()
    if activity is None:
        raise ApiError(
            503,
            "activity_unavailable",
            "GitHub activity has not been fetched yet.",
            headers={"Cache-Control": "no-store"},
        )
    response.headers["Cache-Control"] = "public, max-age=300"
    return activity
```

`apps/api/src/portfolio_api/main.py` — inside `create_app`, after the contact wiring:

```python
    github_source = GitHubGraphQL(http, settings.github_token) if settings.github_token else None
    github_activity = GitHubActivityService(sessions, github_source, login=settings.github_login)
    app.state.github_activity = github_activity
    if github_source is not None:
        # Checked every 10 minutes; GitHub is called only when the copy is an hour old.
        jobs.append(Job("github-refresh", 600, github_activity.refresh_if_stale))
```

and `app.include_router(github.router)` after the contact router, with matching imports.

- [ ] **Step 5: Run tests, lint, types**

Run: `cd apps/api && uv run pytest -v && uv run ruff check . && uv run ruff format --check . && uv run pyright`
Expected: all pass, clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): GET /v1/github/activity served from an hourly-refreshed cache

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Web contact page (layout B, form, Turnstile, page titles)

**Files:**
- Modify: `apps/web/src/components/content/page-header.tsx`
- Modify: `apps/web/src/components/content/primitives.test.tsx` (PageHeader assertions)
- Modify: `apps/web/src/lib/env.ts` (+ its test if one exists)
- Create: `apps/web/src/lib/contact.ts`, `apps/web/src/lib/contact.test.ts`
- Create: `apps/web/src/components/contact/turnstile.tsx`
- Create: `apps/web/src/components/contact/contact-form.tsx`, `apps/web/src/components/contact/contact-form.test.tsx`
- Modify: `apps/web/src/app/contact/page.tsx`, `apps/web/src/app/contact/page.test.tsx`

**Interfaces:**
- Consumes: `getProfile()` (`@/lib/directus/queries`), `CopyEmail`, `GitHubIcon`/`LinkedInIcon`, `serverEnv()`, `next-themes` `useTheme()`.
- Produces: `serverEnv()` gains `turnstileSiteKey: string | undefined` (env `TURNSTILE_SITE_KEY`) and `publicApiUrl: string` (env `PUBLIC_API_URL`, default `https://api.christopherguzman.me`). `POST {publicApiUrl}/v1/contact` contract per Global Constraints.

- [ ] **Step 1: PageHeader size and spacing (test first)**

In `primitives.test.tsx`, add to the `PageHeader` describe:

```tsx
  it("sets the title at 30px with 16px under the prompt", () => {
    render(<PageHeader prompt="$ ls" title="Title" />);
    const h1 = screen.getByRole("heading", { level: 1, name: "Title" });
    expect(h1.className).toContain("text-3xl");
    expect(h1.className).toContain("mt-4");
    expect(h1.className).not.toContain("text-4xl");
  });
```

Run: `pnpm --dir apps/web test primitives` → FAIL. Then in `page-header.tsx` change the h1 class to `mt-4 text-3xl font-semibold tracking-tight`. Run again → PASS.

- [ ] **Step 2: env (test first if `lib/env.test.ts` exists, else add one)**

`apps/web/src/lib/env.ts` — add to `ServerEnv` and `serverEnv()`:

```ts
  turnstileSiteKey: string | undefined;
  publicApiUrl: string;
```

```ts
    turnstileSiteKey: read("TURNSTILE_SITE_KEY"),
    publicApiUrl: readUrl("PUBLIC_API_URL") ?? "https://api.christopherguzman.me",
```

Test: with neither set → `turnstileSiteKey` undefined and `publicApiUrl` the default; with `PUBLIC_API_URL=http://localhost:8000/` → trailing slash stripped.

- [ ] **Step 3: Write failing tests for `lib/contact.ts`**

`apps/web/src/lib/contact.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { submitContact, validateContact } from "./contact";

const good = { name: "Ada", email: "ada@example.com", message: "Hello there, Chris!" };
const payload = { ...good, turnstile_token: "tok", website: "" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("validateContact", () => {
  it("accepts a valid message", () => {
    expect(validateContact(good)).toEqual({});
  });

  it.each([
    [{ name: "   " }, "name", "Enter your name."],
    [{ name: "x".repeat(101) }, "name", "Name must be at most 100 characters."],
    [{ email: "nope" }, "email", "Enter a valid email address."],
    [{ message: "too short" }, "message", "Message must be at least 10 characters."],
    [{ message: "x".repeat(5001) }, "message", "Message must be at most 5000 characters."],
  ])("rejects %o", (override, field, text) => {
    expect(validateContact({ ...good, ...override })).toEqual({ [field]: text });
  });

  it("measures trimmed values", () => {
    expect(validateContact({ ...good, message: "   123456789   " }).message).toBeDefined();
  });
});

function respond(status: number, body?: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    body === undefined ? new Response(null, { status }) : Response.json(body, { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("submitContact", () => {
  it("posts trimmed JSON to the API and maps 202 to sent", async () => {
    const fetchMock = respond(202, { status: "received" });
    const result = await submitContact("https://api.example.com", { ...payload, name: " Ada " });
    expect(result).toEqual({ kind: "sent" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/contact");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ ...payload, name: "Ada" });
  });

  it("maps 429 to rate_limited", async () => {
    respond(429, { error: { code: "rate_limited", message: "x" } });
    expect(await submitContact("https://a", payload)).toEqual({ kind: "rate_limited" });
  });

  it("maps turnstile_failed to turnstile", async () => {
    respond(400, { error: { code: "turnstile_failed", message: "x" } });
    expect(await submitContact("https://a", payload)).toEqual({ kind: "turnstile" });
  });

  it("maps invalid_request to the known field errors", async () => {
    respond(400, {
      error: { code: "invalid_request", message: "x", fields: { email: "bad", other: "x" } },
    });
    expect(await submitContact("https://a", payload)).toEqual({
      kind: "invalid",
      fields: { email: "bad" },
    });
  });

  it.each([500, 503])("maps %i to unavailable", async (status) => {
    respond(status, { error: { code: "x", message: "x" } });
    expect(await submitContact("https://a", payload)).toEqual({ kind: "unavailable" });
  });

  it("maps a network error to unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await submitContact("https://a", payload)).toEqual({ kind: "unavailable" });
  });
});
```

Run: `pnpm --dir apps/web test lib/contact` → FAIL (module missing).

- [ ] **Step 4: Implement `lib/contact.ts`**

```ts
import { z } from "zod";

export const CONTACT_LIMITS = { name: 100, email: 254, messageMin: 10, messageMax: 5000 } as const;

export const CONTACT_MESSAGES = {
  sent: "Message sent. I'll reply to the email you gave.",
  rateLimited: "Too many messages. Try again later, or email me directly.",
  turnstile: "Spam check failed. Try again.",
  pendingToken: "Spam check is still running. Try again in a moment.",
} as const;

export type ContactField = "name" | "email" | "message";
export type ContactValues = Record<ContactField, string>;
export type ContactErrors = Partial<Record<ContactField, string>>;
export type ContactPayload = ContactValues & { turnstile_token: string; website: string };

export type SubmitResult =
  | { kind: "sent" }
  | { kind: "invalid"; fields: ContactErrors }
  | { kind: "turnstile" }
  | { kind: "rate_limited" }
  | { kind: "unavailable" };

export const CONTACT_FIELDS: ContactField[] = ["name", "email", "message"];

// Same limits as the API (apps/api/src/portfolio_api/schemas/contact.py); the API stays the authority.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContact(values: ContactValues): ContactErrors {
  const errors: ContactErrors = {};
  const name = values.name.trim();
  const email = values.email.trim();
  const message = values.message.trim();
  if (!name) errors.name = "Enter your name.";
  else if (name.length > CONTACT_LIMITS.name)
    errors.name = `Name must be at most ${CONTACT_LIMITS.name} characters.`;
  if (!EMAIL_PATTERN.test(email) || email.length > CONTACT_LIMITS.email)
    errors.email = "Enter a valid email address.";
  if (message.length < CONTACT_LIMITS.messageMin)
    errors.message = `Message must be at least ${CONTACT_LIMITS.messageMin} characters.`;
  else if (message.length > CONTACT_LIMITS.messageMax)
    errors.message = `Message must be at most ${CONTACT_LIMITS.messageMax} characters.`;
  return errors;
}

const ErrorBody = z.object({
  error: z.object({ code: z.string(), fields: z.record(z.string(), z.string()).optional() }),
});

export async function submitContact(apiUrl: string, payload: ContactPayload): Promise<SubmitResult> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/v1/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        name: payload.name.trim(),
        email: payload.email.trim(),
        message: payload.message.trim(),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (res.status === 202) return { kind: "sent" };
  if (res.status === 429) return { kind: "rate_limited" };
  if (res.status === 400) {
    const parsed = ErrorBody.safeParse(await res.json().catch(() => null));
    if (parsed.success && parsed.data.error.code === "turnstile_failed") return { kind: "turnstile" };
    if (parsed.success && parsed.data.error.code === "invalid_request") {
      const fields: ContactErrors = {};
      for (const key of CONTACT_FIELDS) {
        const text = parsed.data.error.fields?.[key];
        if (text) fields[key] = text;
      }
      return { kind: "invalid", fields };
    }
  }
  return { kind: "unavailable" };
}
```

Run: `pnpm --dir apps/web test lib/contact` → PASS.

- [ ] **Step 5: Implement the Turnstile widget**

`apps/web/src/components/contact/turnstile.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";

type TurnstileOptions = {
  sitekey: string;
  theme: "light" | "dark";
  appearance: "interaction-only";
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
};

export type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileOptions) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_ID = "cf-turnstile-script";

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve, reject) => {
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener(
      "load",
      () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("no turnstile"))),
      { once: true },
    );
    script.addEventListener("error", () => reject(new Error("turnstile failed to load")), {
      once: true,
    });
  });
}

// Loaded only on /contact. "interaction-only" keeps the widget invisible unless Cloudflare
// needs the visitor to click.
export function Turnstile({
  siteKey,
  theme,
  resetSignal,
  onToken,
}: {
  siteKey: string;
  theme: "light" | "dark";
  resetSignal: number;
  onToken: (token: string | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);

  useEffect(() => {
    onTokenRef.current = onToken;
  });

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId.current = api.render(container.current, {
          sitekey: siteKey,
          theme,
          appearance: "interaction-only",
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
        });
      })
      .catch(() => onTokenRef.current(null));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, theme]);

  useEffect(() => {
    if (resetSignal === 0) return;
    if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
    onTokenRef.current(null);
  }, [resetSignal]);

  return <div ref={container} />;
}
```

- [ ] **Step 6: Write failing tests for the form**

`apps/web/src/components/contact/contact-form.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContactForm } from "./contact-form";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));

const fetchMock = vi.fn();
const turnstile = {
  render: vi.fn(),
  reset: vi.fn(),
  remove: vi.fn(),
};

function renderForm() {
  return render(
    <ContactForm
      apiUrl="https://api.example.com"
      siteKey="site-key"
      fallbackEmail="chris@example.com"
    />,
  );
}

function fill(values: Partial<Record<"Name" | "Email" | "Message", string>>) {
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}

const valid = { Name: "Ada", Email: "ada@example.com", Message: "Hello there, Chris!" };

async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  turnstile.render.mockImplementation((_el, options: { callback: (t: string) => void }) => {
    options.callback("tok-1");
    return "widget-1";
  });
  window.turnstile = turnstile;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  turnstile.render.mockReset();
  turnstile.reset.mockReset();
  delete window.turnstile;
});

describe("ContactForm", () => {
  it("renders Turnstile with the site key, theme and interaction-only appearance", async () => {
    await act(async () => {
      renderForm();
    });
    expect(turnstile.render).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        sitekey: "site-key",
        theme: "dark",
        appearance: "interaction-only",
      }),
    );
  });

  it("shows field errors, marks fields invalid and focuses the first one without calling the API", async () => {
    await act(async () => {
      renderForm();
    });
    fill({ Email: "nope" });
    await submit();
    expect(screen.getByText("Enter your name.")).toBeTruthy();
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect(screen.getByText("Message must be at least 10 characters.")).toBeTruthy();
    const name = screen.getByLabelText("Name");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(name.getAttribute("aria-describedby")).toBe("contact-name-error");
    expect(document.activeElement).toBe(name);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the message with the Turnstile token and replaces the form on success", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    await act(async () => {
      renderForm();
    });
    fill(valid);
    await submit();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/contact");
    expect(JSON.parse(init.body)).toMatchObject({ turnstile_token: "tok-1", website: "" });
    expect(screen.getByRole("status").textContent).toBe(
      "Message sent. I'll reply to the email you gave.",
    );
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("disables the button and shows Sending… while waiting", async () => {
    let resolve: (r: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    await act(async () => {
      renderForm();
    });
    fill(valid);
    await submit();
    const button = screen.getByRole("button", { name: "Sending…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await act(async () => resolve(new Response(null, { status: 202 })));
  });

  it.each([
    [429, { error: { code: "rate_limited", message: "x" } }, "Too many messages. Try again later, or email me directly."],
    [400, { error: { code: "turnstile_failed", message: "x" } }, "Spam check failed. Try again."],
  ])("shows the banner for %i and resets Turnstile", async (status, body, text) => {
    fetchMock.mockResolvedValue(Response.json(body, { status }));
    await act(async () => {
      renderForm();
    });
    fill(valid);
    await submit();
    expect(screen.getByRole("alert").textContent).toBe(text);
    expect(turnstile.reset).toHaveBeenCalledWith("widget-1");
  });

  it("shows API field errors under the fields", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { code: "invalid_request", message: "x", fields: { email: "Email rejected." } } },
        { status: 400 },
      ),
    );
    await act(async () => {
      renderForm();
    });
    fill(valid);
    await submit();
    expect(screen.getByText("Email rejected.")).toBeTruthy();
  });

  it("falls back to the email address and keeps the input when the API is down", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    await act(async () => {
      renderForm();
    });
    fill(valid);
    await submit();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Couldn't send. Email me at chris@example.com instead.");
    expect(alert.querySelector('a[href="mailto:chris@example.com"]')).toBeTruthy();
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(valid.Message);
  });

  it("asks the visitor to wait when Turnstile has no token yet", async () => {
    turnstile.render.mockImplementation(() => "widget-1");
    await act(async () => {
      renderForm();
    });
    fill(valid);
    await submit();
    expect(screen.getByRole("alert").textContent).toBe(
      "Spam check is still running. Try again in a moment.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hides the honeypot from people and keyboards", async () => {
    await act(async () => {
      renderForm();
    });
    const honeypot = document.querySelector('input[name="website"]') as HTMLInputElement;
    expect(honeypot.tabIndex).toBe(-1);
    expect(honeypot.closest('[aria-hidden="true"]')).toBeTruthy();
  });
});
```

Run: `pnpm --dir apps/web test contact-form` → FAIL (module missing).

- [ ] **Step 7: Implement the form**

`apps/web/src/components/contact/contact-form.tsx`:

```tsx
"use client";

import { useTheme } from "next-themes";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  CONTACT_FIELDS,
  CONTACT_LIMITS,
  CONTACT_MESSAGES,
  submitContact,
  validateContact,
  type ContactErrors,
  type ContactField,
  type ContactValues,
} from "@/lib/contact";

import { Turnstile } from "./turnstile";

type Banner = "rateLimited" | "turnstile" | "pendingToken" | "unavailable";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand aria-[invalid=true]:border-destructive";
const submitClass =
  "inline-flex items-center gap-2 rounded-md bg-accent-brand px-3.5 py-2 text-[13px] font-semibold text-accent-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand";

function Field({
  field,
  label,
  error,
  children,
}: {
  field: ContactField;
  label: string;
  error: string | undefined;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={`contact-${field}`} className="mb-1.5 block text-xs text-muted-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`contact-${field}-error`} className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ContactForm({
  apiUrl,
  siteKey,
  fallbackEmail,
}: {
  apiUrl: string;
  siteKey: string;
  fallbackEmail: string;
}) {
  const { resolvedTheme } = useTheme();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<ContactValues>({ name: "", email: "", message: "" });
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<ContactErrors>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);

  function focusFirst(found: ContactErrors): boolean {
    const first = CONTACT_FIELDS.find((field) => found[field]);
    if (!first) return false;
    (formRef.current?.elements.namedItem(first) as HTMLElement | null)?.focus();
    return true;
  }

  function fieldProps(field: ContactField) {
    return {
      id: `contact-${field}`,
      name: field,
      value: values[field],
      onChange: (event: { target: { value: string } }) =>
        setValues((current) => ({ ...current, [field]: event.target.value })),
      "aria-invalid": errors[field] ? true : undefined,
      "aria-describedby": errors[field] ? `contact-${field}-error` : undefined,
      className: inputClass,
    };
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validateContact(values);
    setErrors(found);
    setBanner(null);
    if (focusFirst(found)) return;
    if (!token) {
      setBanner("pendingToken");
      return;
    }
    setSending(true);
    const result = await submitContact(apiUrl, { ...values, turnstile_token: token, website });
    setSending(false);
    if (result.kind === "sent") {
      setSent(true);
      return;
    }
    // Turnstile tokens are single-use: get a fresh one for the next attempt.
    setResetSignal((n) => n + 1);
    if (result.kind === "invalid" && Object.keys(result.fields).length > 0) {
      setErrors(result.fields);
      focusFirst(result.fields);
      return;
    }
    setBanner(
      result.kind === "rate_limited"
        ? "rateLimited"
        : result.kind === "turnstile"
          ? "turnstile"
          : "unavailable",
    );
  }

  if (sent) {
    return (
      <p role="status" className="text-sm text-foreground">
        {CONTACT_MESSAGES.sent}
      </p>
    );
  }

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} aria-label="Contact form" className="relative space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field field="name" label="Name" error={errors.name}>
          <input type="text" autoComplete="name" maxLength={CONTACT_LIMITS.name} {...fieldProps("name")} />
        </Field>
        <Field field="email" label="Email" error={errors.email}>
          <input type="email" autoComplete="email" maxLength={CONTACT_LIMITS.email} {...fieldProps("email")} />
        </Field>
      </div>
      <Field field="message" label="Message" error={errors.message}>
        <textarea rows={6} maxLength={CONTACT_LIMITS.messageMax} {...fieldProps("message")} />
      </Field>
      <div aria-hidden="true" className="absolute -left-[9999px] size-px overflow-hidden">
        <label htmlFor="contact-website">Website</label>
        <input
          id="contact-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>
      <Turnstile
        siteKey={siteKey}
        theme={resolvedTheme === "light" ? "light" : "dark"}
        resetSignal={resetSignal}
        onToken={setToken}
      />
      {banner ? (
        <p role="alert" className="text-sm text-destructive">
          {banner === "unavailable" ? (
            <>
              Couldn&apos;t send. Email me at{" "}
              <a href={`mailto:${fallbackEmail}`} className="underline underline-offset-4">
                {fallbackEmail}
              </a>{" "}
              instead.
            </>
          ) : (
            CONTACT_MESSAGES[banner]
          )}
        </p>
      ) : null}
      <button type="submit" disabled={sending} className={submitClass}>
        {sending ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
```

Run: `pnpm --dir apps/web test contact-form` → PASS. (`role="form"` exists because the form has an `aria-label`; the success test asserts it is gone.)

- [ ] **Step 8: Rewrite the contact page (layout B) — tests first**

Replace the first test in `apps/web/src/app/contact/page.test.tsx` and add the new ones (keep the existing card/link tests, adjusting them to the compact rows where queries change). Mock the form so the page test stays a server-render test:

```tsx
vi.mock("@/components/contact/contact-form", () => ({
  ContactForm: (props: { apiUrl: string; siteKey: string; fallbackEmail: string }) => (
    <div data-testid="contact-form">{JSON.stringify(props)}</div>
  ),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

it("shows the prompt and title with no caption or phone number", async () => {
  vi.mocked(getProfile).mockResolvedValue(profile);
  const { container } = render(await ContactPage());
  expect(screen.getByText("$ ping chris")).toBeTruthy();
  expect(screen.getByRole("heading", { level: 1, name: "Get in touch" })).toBeTruthy();
  expect(container.querySelector('a[href^="tel:"]')).toBeNull();
});

it("renders the form with the site key, public API URL and profile email", async () => {
  vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
  vi.stubEnv("PUBLIC_API_URL", "https://api.example.com");
  vi.mocked(getProfile).mockResolvedValue(profile);
  render(await ContactPage());
  expect(screen.getByRole("heading", { level: 2, name: "Send a message" })).toBeTruthy();
  expect(JSON.parse(screen.getByTestId("contact-form").textContent ?? "")).toEqual({
    apiUrl: "https://api.example.com",
    siteKey: "site-key",
    fallbackEmail: "chris@example.com",
  });
});

it("says the form is coming soon when Turnstile is not configured", async () => {
  vi.mocked(getProfile).mockResolvedValue(profile);
  render(await ContactPage());
  expect(screen.queryByTestId("contact-form")).toBeNull();
  expect(screen.getByText("Contact form coming soon. Email me directly.")).toBeTruthy();
});

it("lists email, LinkedIn and GitHub as compact rows under a hidden heading", async () => {
  vi.mocked(getProfile).mockResolvedValue(profile);
  render(await ContactPage());
  expect(screen.getByRole("heading", { level: 2, name: "Other ways to reach me" }).className).toContain("sr-only");
  for (const name of ["Email", "LinkedIn", "GitHub"]) {
    expect(screen.getByRole("heading", { level: 3, name })).toBeTruthy();
  }
  const linkedin = screen.getByRole("link", { name: "Open LinkedIn profile" });
  expect(linkedin.getAttribute("href")).toBe(profile.linkedin_url);
  expect(linkedin.getAttribute("rel")).toBe("noopener noreferrer");
});
```

Run: `pnpm --dir apps/web test app/contact` → FAIL.

`apps/web/src/app/contact/page.tsx` — keep the imports, `metadata`, `FALLBACK_EMAIL`, `lastPathSegment` and the profile fallbacks; replace the cards with:

```tsx
const rowClass = "flex items-center gap-3 rounded-[10px] border border-border bg-card px-3.5 py-3";
const iconClass =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-brand/15 text-accent-brand";
const valueClass = "break-all font-mono text-[11px] text-muted-foreground";
const openClass =
  "ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-background";

export default async function ContactPage() {
  const profile = await getProfile();
  const { turnstileSiteKey, publicApiUrl } = serverEnv();
  const email = profile?.email || FALLBACK_EMAIL;
  // ProfileSchema turns empty or non-http(s) URLs into null, so they fall back here.
  const linkedin = profile?.linkedin_url ?? siteConfig.links.linkedin;
  const github = profile?.github_url ?? siteConfig.links.github;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-16">
      <PageHeader prompt="$ ping chris" title="Get in touch" />
      <div className="mt-6 grid items-start gap-4 md:grid-cols-[1.7fr_1fr]">
        <section
          aria-labelledby="contact-form-heading"
          className="rounded-[10px] border border-border bg-card p-5"
        >
          <h2 id="contact-form-heading" className="mb-4 text-[15px] font-semibold">
            Send a message
          </h2>
          {turnstileSiteKey ? (
            <ContactForm apiUrl={publicApiUrl} siteKey={turnstileSiteKey} fallbackEmail={email} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Contact form coming soon. Email me directly.
            </p>
          )}
        </section>

        <section aria-labelledby="contact-direct">
          <h2 id="contact-direct" className="sr-only">
            Other ways to reach me
          </h2>
          <ul className="flex flex-col gap-2.5">
            <li className={rowClass}>
              <span className={iconClass}>
                <Mail className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Email</h3>
                <p className={valueClass}>{email}</p>
              </div>
              <div className="ml-auto shrink-0">
                <CopyEmail email={email} />
              </div>
            </li>
            <li className={rowClass}>
              <span className={iconClass}>
                <LinkedInIcon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">LinkedIn</h3>
                <p className={valueClass}>{lastPathSegment(linkedin)}</p>
              </div>
              <a
                href={linkedin}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open LinkedIn profile"
                className={openClass}
              >
                <ExternalLink className="size-3.5" aria-hidden />
                Open
              </a>
            </li>
            <li className={rowClass}>
              <span className={iconClass}>
                <GitHubIcon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">GitHub</h3>
                <p className={valueClass}>@{lastPathSegment(github)}</p>
              </div>
              <a
                href={github}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open GitHub profile"
                className={openClass}
              >
                <ExternalLink className="size-3.5" aria-hidden />
                Open
              </a>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
```

Add imports: `ContactForm` from `@/components/contact/contact-form`, `serverEnv` from `@/lib/env`. Check the gap other pages put under `PageHeader` (e.g. `app/experience/page.tsx`) and use the same value instead of `mt-6` if it differs. On phones the grid is one column with the form first (DOM order), as approved.

Run: `pnpm --dir apps/web test app/contact` → PASS.

- [ ] **Step 9: Full checks and commit**

```bash
pnpm --dir apps/web test && pnpm --dir apps/web typecheck && pnpm --dir apps/web lint && pnpm --dir apps/web format && pnpm --dir apps/web build
git add apps/web
git commit -m "feat(web): contact form on /contact (layout B) and 30px page titles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: all green; build passes with no env vars set (form shows "coming soon").

---

### Task 5: Home page GitHub activity heatmap

**Files:**
- Create: `apps/web/src/lib/github-activity.ts`, `apps/web/src/lib/github-activity.test.ts`
- Create: `apps/web/src/components/content/github-activity.tsx`, `apps/web/src/components/content/github-activity.test.tsx`
- Modify: `apps/web/src/lib/format.ts` (+ `format.test.ts` if it exists, else create): add `lastPathSegment`
- Modify: `apps/web/src/app/page.tsx`, `apps/web/src/app/page.test.tsx`, `apps/web/src/app/page.jsonld.test.tsx` (mock the new module)

**Interfaces:**
- Consumes: `serverEnv().apiInternalUrl`, `formatPostDate`, `sectionNumbers`, `SectionHeading`, `cn` (`@/lib/utils`), API `GET /v1/github/activity` (shape in Global Constraints).
- Produces: `getGithubActivity(): Promise<Activity | null>`; `GitHubActivity({ activity, profileUrl })`; `contributionTitle(day)`; `lastPathSegment(url: string): string` in `@/lib/format` (Task 7 switches `/contact` to it).

- [ ] **Step 1: `lastPathSegment` (test first)**

Test: `lastPathSegment("https://github.com/chrisguzman77")` → `"chrisguzman77"`; `"https://www.linkedin.com/in/christopher-emmanuel-guzman/"` → `"christopher-emmanuel-guzman"`.

```ts
export function lastPathSegment(url: string): string {
  return new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? url;
}
```

- [ ] **Step 2: Write failing tests for the data loader**

`apps/web/src/lib/github-activity.test.ts`:

```ts
import { connection } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Module from "./github-activity";

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));

const fetchMock = vi.fn();
let getGithubActivity: typeof Module.getGithubActivity;

const body = {
  total: 3,
  weeks: [{ days: [{ date: "2026-09-14", count: 3, level: 4 }] }],
  fetched_at: "2026-10-02T12:00:00Z",
};

beforeEach(async () => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_INTERNAL_URL", "http://api:8000");
  vi.resetModules(); // the memo lives at module level
  ({ getGithubActivity } = await import("./github-activity"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe("getGithubActivity", () => {
  it("fetches the API over the internal network with a short timeout", async () => {
    fetchMock.mockResolvedValue(Response.json(body));
    expect(await getGithubActivity()).toEqual(body);
    expect(connection).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api:8000/v1/github/activity",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
  });

  it.each([
    ["a 503", () => Response.json({ error: { code: "activity_unavailable" } }, { status: 503 })],
    ["a wrong shape", () => Response.json({ total: "many" })],
  ])("returns null for %s", async (_label, make) => {
    fetchMock.mockResolvedValue(make());
    expect(await getGithubActivity()).toBeNull();
  });

  it("returns null when the request fails", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    expect(await getGithubActivity()).toBeNull();
  });

  it("returns null without calling anything when API_INTERNAL_URL is unset", async () => {
    vi.stubEnv("API_INTERNAL_URL", "");
    expect(await getGithubActivity()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reuses a success for 5 minutes and a failure for 1 minute", async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValueOnce(new Error("down")).mockResolvedValue(Response.json(body));
    expect(await getGithubActivity()).toBeNull();
    vi.advanceTimersByTime(59_000);
    expect(await getGithubActivity()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    expect(await getGithubActivity()).toEqual(body);
    vi.advanceTimersByTime(299_000);
    await getGithubActivity();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(2_000);
    fetchMock.mockResolvedValue(Response.json(body));
    await getGithubActivity();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
```

Run: `pnpm --dir apps/web test lib/github-activity` → FAIL.

- [ ] **Step 3: Implement the loader**

`apps/web/src/lib/github-activity.ts`:

```ts
import { connection } from "next/server";
import { z } from "zod";

import { serverEnv } from "@/lib/env";

const DaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  count: z.number().int().nonnegative(),
  level: z.number().int().min(0).max(4),
});

export const ActivitySchema = z.object({
  total: z.number().int().nonnegative(),
  weeks: z.array(z.object({ days: z.array(DaySchema) })).min(1),
  fetched_at: z.string(),
});

export type Activity = z.infer<typeof ActivitySchema>;
export type ActivityDay = z.infer<typeof DaySchema>;

const SUCCESS_MS = 300_000;
const FAILURE_MS = 60_000;
const TIMEOUT_MS = 1_500;

// Module memo, not the Next data cache. The home page awaits this with its other data (section
// numbers depend on it), so failures are remembered too: a hung API costs one timeout a minute.
let memo: { value: Activity | null; until: number } | undefined;

async function fetchActivity(base: string): Promise<Activity | null> {
  try {
    const res = await fetch(`${base}/v1/github/activity`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status !== 200) return null;
    const parsed = ActivitySchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function getGithubActivity(): Promise<Activity | null> {
  await connection();
  const { apiInternalUrl } = serverEnv();
  if (!apiInternalUrl) return null;
  if (memo && Date.now() < memo.until) return memo.value;
  const value = await fetchActivity(apiInternalUrl);
  memo = { value, until: Date.now() + (value ? SUCCESS_MS : FAILURE_MS) };
  return value;
}
```

Run: `pnpm --dir apps/web test lib/github-activity` → PASS.

- [ ] **Step 4: Write failing tests for the heatmap**

`apps/web/src/components/content/github-activity.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Activity } from "@/lib/github-activity";

import { contributionTitle, GitHubActivity, MOBILE_WEEKS } from "./github-activity";

afterEach(cleanup);

// 30 Sunday-start weeks from 2026-03-01; the first week starts on a Wednesday (partial).
function makeActivity(): Activity {
  const weeks: Activity["weeks"] = [];
  const start = Date.UTC(2026, 2, 1);
  for (let w = 0; w < 30; w++) {
    const days = [];
    for (let d = w === 0 ? 3 : 0; d < 7; d++) {
      const date = new Date(start + (w * 7 + d) * 86_400_000).toISOString().slice(0, 10);
      days.push({ date, count: d, level: Math.min(d, 4) });
    }
    weeks.push({ days });
  }
  return { total: 1234, weeks, fetched_at: "2026-10-02T12:00:00Z" };
}

describe("contributionTitle", () => {
  it.each([
    [0, "No contributions on Sep 14, 2026"],
    [1, "1 contribution on Sep 14, 2026"],
    [3, "3 contributions on Sep 14, 2026"],
  ])("count %i", (count, text) => {
    expect(contributionTitle({ date: "2026-09-14", count, level: 1 })).toBe(text);
  });
});

describe("GitHubActivity", () => {
  it("labels the grid for screen readers and links to the profile in a new tab", () => {
    render(<GitHubActivity activity={makeActivity()} profileUrl="https://github.com/octo" />);
    expect(screen.getByRole("img", { name: "1,234 GitHub contributions in the last year" })).toBeTruthy();
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://github.com/octo");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("1,234 contributions in the last year · updated hourly")).toBeTruthy();
  });

  it("renders one column per week with 7 slots, padding partial weeks", () => {
    const { container } = render(<GitHubActivity activity={makeActivity()} profileUrl="https://github.com/octo" />);
    const columns = container.querySelectorAll('[role="img"] > div');
    expect(columns).toHaveLength(30);
    expect(columns[0].children).toHaveLength(7);
    expect(columns[0].querySelectorAll("[title]")).toHaveLength(4); // Wed–Sat
    expect(container.querySelector('[title="3 contributions on Mar 4, 2026"]')).toBeTruthy();
  });

  it("hides all but the last 22 weeks below md", () => {
    const { container } = render(<GitHubActivity activity={makeActivity()} profileUrl="https://github.com/octo" />);
    const columns = [...container.querySelectorAll('[role="img"] > div')];
    const hidden = columns.filter((c) => c.className.includes("hidden md:flex"));
    expect(hidden).toHaveLength(30 - MOBILE_WEEKS);
    expect(columns.at(-1)?.className).not.toContain("hidden");
  });

  it("labels each month once, where it starts", () => {
    render(<GitHubActivity activity={makeActivity()} profileUrl="https://github.com/octo" />);
    for (const month of ["Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"]) {
      expect(screen.getAllByText(month)).toHaveLength(1);
    }
  });

  it("says contribution in the singular for a total of one", () => {
    const activity = { ...makeActivity(), total: 1 };
    render(<GitHubActivity activity={activity} profileUrl="https://github.com/octo" />);
    expect(screen.getByRole("img", { name: "1 GitHub contribution in the last year" })).toBeTruthy();
  });
});
```

Run: `pnpm --dir apps/web test components/content/github-activity` → FAIL.

- [ ] **Step 5: Implement the heatmap**

`apps/web/src/components/content/github-activity.tsx`:

```tsx
import { formatPostDate } from "@/lib/format";
import type { Activity, ActivityDay } from "@/lib/github-activity";
import { cn } from "@/lib/utils";

export const MOBILE_WEEKS = 22;

// Empty plus four strengths of the accent, in both themes (semantic tokens only).
const LEVEL_CLASS = [
  "bg-muted",
  "bg-accent-brand/25",
  "bg-accent-brand/45",
  "bg-accent-brand/70",
  "bg-accent-brand",
] as const;

const monthFormat = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function plural(count: number): string {
  return count === 1 ? "contribution" : "contributions";
}

export function contributionTitle(day: ActivityDay): string {
  const date = formatPostDate(day.date);
  return day.count === 0
    ? `No contributions on ${date}`
    : `${day.count} ${plural(day.count)} on ${date}`;
}

// GitHub weeks start on Sunday; the first and last week of the year can be partial.
function slots(days: ActivityDay[]): (ActivityDay | null)[] {
  const out: (ActivityDay | null)[] = Array.from({ length: 7 }, () => null);
  for (const day of days) out[utc(day.date).getUTCDay()] = day;
  return out;
}

function monthLabels(weeks: Activity["weeks"]): (string | null)[] {
  let previous = "";
  return weeks.map((week) => {
    const first = week.days[0];
    if (!first) return null;
    const month = monthFormat.format(utc(first.date));
    if (month === previous) return null;
    previous = month;
    return month;
  });
}

export function GitHubActivity({ activity, profileUrl }: { activity: Activity; profileUrl: string }) {
  const { weeks, total } = activity;
  const totalText = total.toLocaleString("en-US");
  const labels = monthLabels(weeks);
  const olderThanMobile = (index: number) => index < weeks.length - MOBILE_WEEKS;

  return (
    <a
      href={profileUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-[10px] border border-border bg-card p-4 transition-colors hover:border-input focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand"
    >
      <div aria-hidden="true" className="mb-1.5 flex gap-[3px] font-mono text-[10px] text-muted-foreground">
        {labels.map((month, index) => (
          <span
            key={weeks[index].days[0]?.date ?? index}
            className={cn("flex-1 overflow-visible whitespace-nowrap", olderThanMobile(index) && "hidden md:block")}
          >
            {month ?? ""}
          </span>
        ))}
      </div>
      <div role="img" aria-label={`${totalText} GitHub ${plural(total)} in the last year`} className="flex gap-[3px]">
        {weeks.map((week, index) => (
          <div
            key={week.days[0]?.date ?? index}
            className={cn("flex flex-1 flex-col gap-[3px]", olderThanMobile(index) && "hidden md:flex")}
          >
            {slots(week.days).map((day, slot) =>
              day ? (
                <span
                  key={day.date}
                  title={contributionTitle(day)}
                  className={cn("aspect-square rounded-[2px]", LEVEL_CLASS[day.level])}
                />
              ) : (
                <span key={`empty-${slot}`} className="aspect-square" />
              ),
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[11px] text-muted-foreground">
          {`${totalText} ${plural(total)} in the last year · updated hourly`}
        </p>
        <div aria-hidden="true" className="flex items-center gap-1 text-[10px] text-muted-foreground">
          less
          {LEVEL_CLASS.map((level) => (
            <span key={level} className={cn("size-[9px] rounded-[2px]", level)} />
          ))}
          more
        </div>
      </div>
    </a>
  );
}
```

Run: `pnpm --dir apps/web test components/content/github-activity` → PASS.

- [ ] **Step 6: Wire the home page — tests first**

In `apps/web/src/app/page.test.tsx` add:

```tsx
vi.mock("@/lib/github-activity", () => ({ getGithubActivity: vi.fn() }));
```

(with `import { getGithubActivity } from "@/lib/github-activity";`, defaulting it to `mockResolvedValue(null)` in `beforeEach`), and tests:

```tsx
const activity = {
  total: 42,
  weeks: [{ days: [{ date: "2026-09-14", count: 3, level: 4 }] }],
  fetched_at: "2026-10-02T12:00:00Z",
};

it("shows GitHub activity after Experience and numbers it", async () => {
  // projects + roles present, no posts
  vi.mocked(getGithubActivity).mockResolvedValue(activity);
  render(await HomePage());
  const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(headings).toEqual(["01Featured projects", "02Experience", "03GitHub activity"]);
  const handle = screen.getByRole("link", { name: "@profile-gh" }); // the " →" is aria-hidden
  expect(handle.getAttribute("href")).toBe("https://github.com/profile-gh");
});

it("hides the section and renumbers Blog when activity is unavailable", async () => {
  // projects + roles + posts present
  vi.mocked(getGithubActivity).mockResolvedValue(null);
  render(await HomePage());
  const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(headings).not.toContain("03GitHub activity");
  expect(headings.at(-1)).toBe("03Blog");
});
```

Adapt the fixture setup to the file's existing helpers (`profile`, `project`, `role`, a post fixture). Also add the same `vi.mock("@/lib/github-activity", …)` returning `null` to `page.jsonld.test.tsx`.

Run: `pnpm --dir apps/web test app/page` → FAIL.

`apps/web/src/app/page.tsx` changes:

```tsx
type HomeSection = "projects" | "experience" | "activity" | "blog";
```

```tsx
  const [profile, projects, experience, posts, activity] = await Promise.all([
    getProfile(),
    getProjects(),
    getExperience(),
    getPosts(),
    getGithubActivity(),
  ]);
```

```tsx
  if (homeRoles.length > 0) visible.push("experience");
  if (activity) visible.push("activity");
  if (latestPosts.length > 0) visible.push("blog");
```

and between the Experience and Blog sections:

```tsx
      {activity ? (
        <section className="border-t border-border py-9">
          <SectionHeading
            number={numbers.activity}
            title="GitHub activity"
            href={githubUrl}
            linkLabel={`@${lastPathSegment(githubUrl)}`}
          />
          <div className="mt-4">
            <GitHubActivity activity={activity} profileUrl={githubUrl} />
          </div>
        </section>
      ) : null}
```

with imports `GitHubActivity`, `getGithubActivity`, `lastPathSegment`.

Run: `pnpm --dir apps/web test app/page` → PASS.

- [ ] **Step 7: Full checks and commit**

```bash
pnpm --dir apps/web test && pnpm --dir apps/web typecheck && pnpm --dir apps/web lint && pnpm --dir apps/web format && pnpm --dir apps/web build
git add apps/web
git commit -m "feat(web): GitHub activity heatmap on the home page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Compose, smoke test and docs

**Files:**
- Modify: `infra/compose/compose.yaml`, `infra/compose/compose.dev.yaml`
- Modify: `scripts/smoke.sh`
- Modify: `docs/runbook.md`, `docs/setup.md`, `docs/architecture.md`
- Create: `docs/adr/0007-in-process-rate-limits-and-jobs.md`; Modify: `docs/adr/README.md` (index)

**Interfaces:**
- Consumes: env names from Tasks 1/4 (`API_TURNSTILE_SECRET`, `API_RESEND_API_KEY`, `API_CONTACT_TO`, `API_GITHUB_TOKEN`, `TURNSTILE_SITE_KEY`, `PUBLIC_API_URL`); routes `/v1/contact`, `/v1/github/activity`.
- Produces: nothing code depends on. Do **not** add keys to `infra/compose/prod.env.example` (that happens in Chris's secrets PR, Task 8).

- [ ] **Step 1: Compose**

`infra/compose/compose.yaml` — `api.environment` add:

```yaml
      # Phase 4: optional until Chris's secrets PR; empty means the feature is off.
      API_TURNSTILE_SECRET: ${TURNSTILE_SECRET_KEY:-}
      API_RESEND_API_KEY: ${RESEND_API_KEY:-}
      API_CONTACT_TO: ${CONTACT_TO:-}
      API_GITHUB_TOKEN: ${GITHUB_ACTIVITY_TOKEN:-}
```

`web.environment` add:

```yaml
      TURNSTILE_SITE_KEY: ${TURNSTILE_SITE_KEY:-}
      PUBLIC_API_URL: https://api.christopherguzman.me
```

`infra/compose/compose.dev.yaml` — `api.environment` add:

```yaml
      # Cloudflare's published Turnstile test secret: every token passes.
      API_TURNSTILE_SECRET: 1x0000000000000000000000000000000AA
      API_CONTACT_TO: ${CONTACT_TO:-dev@example.com}
      API_RESEND_API_KEY: ${RESEND_API_KEY:-}
      API_GITHUB_TOKEN: ${GITHUB_ACTIVITY_TOKEN:-}
```

`web.environment` add:

```yaml
      # Cloudflare's published Turnstile test site key (always passes).
      TURNSTILE_SITE_KEY: 1x00000000000000000000AA
      PUBLIC_API_URL: http://localhost:8000
```

Verify: `make prod-config` (or the CI compose-validation command in `.github/workflows/ci.yml`'s infra job) and `docker compose -f infra/compose/compose.dev.yaml config -q` both succeed.

- [ ] **Step 2: Smoke check**

In `scripts/smoke.sh`, after the `api /health` check:

```bash
# 200 (cached calendar) and 503 (nothing fetched yet / no token) both prove the route is wired.
check "api /v1/github/activity is routed" in_service api python -c "
import sys, urllib.error, urllib.request
try:
    status = urllib.request.urlopen('http://127.0.0.1:8000/v1/github/activity', timeout=3).status
except urllib.error.HTTPError as err:
    status = err.code
sys.exit(status not in (200, 503))" || status=1
```

Update the header comment's list of checks if it enumerates them. Verify: `shellcheck scripts/smoke.sh` clean.

- [ ] **Step 3: Docs**

`docs/runbook.md` — add a `## Contact messages` section after "Content (CMS)":

- Messages are saved before any email is sent; the API retries failed or stuck sends every 5 minutes, up to 5 attempts.
- Read recent messages on the VM:
  `docker exec -it portfolio-postgres-1 psql -U postgres -d portfolio -c "select created_at, name, email, email_status, attempts, last_error from contact_submissions order by created_at desc limit 20;"`
- Retry one that gave up (after fixing the cause, e.g. a new Resend key):
  `... -c "update contact_submissions set attempts = 0, updated_at = now() - interval '6 minutes' where id = '<id>';"` — the next retry run (≤ 5 minutes) sends it.
- Until `TURNSTILE_SECRET_KEY`/`TURNSTILE_SITE_KEY` are set, `/contact` shows "Contact form coming soon" and the API answers `503 contact_unavailable`. Without `RESEND_API_KEY` or `CONTACT_TO`, messages are saved and wait as `pending`.

Add a `## GitHub activity` section: the API refreshes the calendar when it is an hour old (checked every 10 minutes); GitHub failures keep the last copy; with no `GITHUB_ACTIVITY_TOKEN` the home page hides the section; check with `curl -s https://api.christopherguzman.me/v1/github/activity | head -c 200`.

Under "Rotate secrets" add bullets: **Resend API key** (create new key in Resend → `make secrets-edit` `RESEND_API_KEY` → merge → delete the old key in Resend); **Turnstile keys** (rotate the secret in the Turnstile widget settings → update `TURNSTILE_SECRET_KEY` (and `TURNSTILE_SITE_KEY` if it changed) → merge); **GitHub activity token (expires yearly)** (new fine-grained token, public repositories read-only → `GITHUB_ACTIVITY_TOKEN` → merge); **Contact inbox** (`CONTACT_TO`, e.g. after graduation).

`docs/setup.md` — replace the "Email, Turnstile, GitHub PAT (Phase 4)" section body with the five setup steps from the spec's "Chris's setup steps" section (Resend domain + DNS + key; Turnstile widget with hostnames `christopherguzman.me` and `localhost`, mode Managed; GitHub private-contributions setting + fine-grained token; `make secrets-edit` keys `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY`, `GITHUB_ACTIVITY_TOKEN`, `CONTACT_TO` plus adding them to `prod.env.example`; optional Cloudflare rate-limit rule on `api.christopherguzman.me/v1/contact`). Note that local dev uses Turnstile's test keys and needs none of these.

`docs/architecture.md` — add an `## Interactions (Phase 4)` section: browser → `api.christopherguzman.me/v1/contact` (rate limit → Turnstile → Postgres → background Resend send, retry job); home page server → `http://api:8000/v1/github/activity` ← Postgres cache ← hourly GitHub GraphQL job; the degradation table from the spec.

`docs/adr/0007-in-process-rate-limits-and-jobs.md` (match the format of 0006):

- Context: one API container; Phase 4 needs per-IP rate limits and two periodic jobs (contact retries, GitHub refresh).
- Decision: an in-memory sliding-window limiter and asyncio tasks started in the FastAPI lifespan; no Redis, Celery or cron container.
- Consequences: limits reset on restart (acceptable: Turnstile and the Cloudflare edge rule still apply); running two API replicas would double limits and run jobs twice, so scaling out requires Redis (or Postgres advisory locks) first; job failures are logged and retried next interval.

Add the ADR to `docs/adr/README.md`'s index.

- [ ] **Step 4: Commit**

```bash
git add infra/compose scripts/smoke.sh docs
git commit -m "chore(infra,docs): Phase 4 env wiring, smoke check, runbook, ADR 0007

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Integration (controller)

- [ ] Merge `p4-api`, `p4-web-contact`, `p4-web-heatmap`, `p4-infra-docs` into `phase-4`.
- [ ] Replace the local `lastPathSegment` in `apps/web/src/app/contact/page.tsx` with the import from `@/lib/format`; commit.
- [ ] Run everything from `phase-4`: API (`uv run pytest`, ruff, pyright, `alembic check` against the dev DB), web (`test`, `typecheck`, `lint`, `format`, `build` with no env), `shellcheck scripts/*.sh`, compose config for prod and dev.
- [ ] Dev stack end-to-end: `POSTGRES_PORT=55432 make up`, `make migrate`; on http://localhost:3000/contact submit the form (test Turnstile keys) → success message; the row is in `contact_submissions` as `pending` with `attempts = 0` (no Resend key); `curl -i localhost:8000/v1/github/activity` → `503` and the home page shows no GitHub section; 6 quick `curl` POSTs → the 6th is `429`.
- [ ] Final whole-branch review (most capable model) with the Minor-findings list from the ledger; one fix pass; open the PR.

### Task 8: Accounts and secrets (Chris, after the PR merges)

Follow `docs/setup.md` "Email, Turnstile, GitHub PAT (Phase 4)". Then a small PR (prepared by Claude): add the five keys to `infra/compose/prod.env.example`; Chris runs `make secrets-edit` and `make secrets-check`, commits, pushes. After deploy, verify live: a real message reaches `chguzman@augusta.edu` and Reply goes to the sender; a 6th message in a minute is blocked; the heatmap matches github.com/chrisguzman77.
