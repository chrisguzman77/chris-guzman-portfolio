# Chat Feedback Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visitors rate every chat reply with `helpful? [y] [n]`. The API stores the rating on the `chat_messages` row, counts it per day and in Prometheus, and Chris reads recent thumbs-down with `make chat-feedback`.

**Architecture:**
- **API:** One Alembic migration adds the `chat_feedback` enum, two columns on `chat_messages` and two counters on `chat_usage_daily`. `ChatService.rate()` reuses the ownership check `ask` uses. A new `POST /v1/chat/sessions/{session_id}/messages/{message_id}/feedback` returns 204, behind its own in-process limiter. `MessageResponse` gains `message_id`.
- **Ops:** A `chat_feedback_total{rating,outcome}` counter, a Grafana stat panel, a `portfolio-api chat-feedback` command with a `make chat-feedback` target, and short doc updates.
- **Web:** `askQuestion` returns `messageId`, and a new `sendFeedback` posts the rating. `chat-terminal.tsx` renders an `AnswerFeedback` row under every answer line. Canned no-answer replies are answer lines too, so they get the row as well.

**Tech Stack:** FastAPI, SQLAlchemy 2 (async), Alembic, pytest (via `uv`), prometheus-client; Next.js 16.3, React 19.3, zod (`@/lib/zod-client`), vitest + Testing Library, Playwright + axe; Grafana dashboard JSON.

**Spec:** `docs/superpowers/specs/2026-10-12-chat-quality-design.md`, section "PR 1: Feedback buttons", is binding except for the resolutions below. PRs 2-4 are out of scope.

**Spec resolutions (decided while planning):**
1. **`message_id` is an integer.** The spec calls it "the UUID of the `chat_messages` row", but `chat_messages.id` is a Postgres `integer` primary key (migration `8d41f0c2b7e3`). The plan exposes that integer and doesn't add a UUID column. Probing is still pointless: every failure returns the same 404 unless the caller owns the session. The path parameter is bounded to `1..2147483647`, so an out-of-range id is a 400 validation error, not a database error.
2. **The ownership check includes the 2-hour session age.** The spec says "the same check `ask` uses", and that check also rejects sessions older than `SESSION_MAX_AGE`. The check moves into one helper, `ChatService._owns`, which both methods call.
3. **A repeated identical rating changes nothing.** "Last rating wins, idempotent": sending the same rating again is a 204 no-op. The daily counters, the metric and `feedback_at` don't change. A *different* rating overwrites the stored one and follows the spec's counting rule. So `chat_feedback_total` counts ratings that changed what is stored. A Prometheus counter can't go down, so a change from up to down adds 1 to `down` and leaves `up` alone.
4. **`error` outcomes never reach the visitor.** `ask` raises a 503 for them, so `message_id` appears in every `MessageResponse` the API returns: answered, no_match and uncited. The metric still pre-creates the `error` label, as the spec lists it.
5. **`sendFeedback(apiUrl, sessionId, messageId, rating)`.** It takes `apiUrl` first, like `createSession` and `askQuestion`.
6. **`thanks: noted` appears once the API returns 204.** Both buttons are disabled while the request is in flight, which stops double clicks. If it fails, `couldn't save feedback` shows and the buttons re-enable. The status `<span role="status">` is always rendered, so screen readers announce its text when it changes.
7. **The migration up/down test is a CI step.** The repo has no pytest migration tests. Earlier plans proved downgrades by hand. CI already runs `alembic upgrade head` and `alembic check`, and gains `alembic downgrade -1 && alembic upgrade head`, which tests every future migration too. `test_chat_tables_cascade_and_defaults` also asserts the new columns and their defaults.

## Global Constraints

- **Copy (exact strings):**
  - Row: `helpful? [y] [n]`. The buttons' visible text is `[y]` and `[n]`.
  - `aria-label`s: `Mark answer helpful` (`[y]`, rating `up`) and `Mark answer not helpful` (`[n]`, rating `down`).
  - Success: `thanks: noted` (role=status). Failure: `couldn't save feedback`.
  - API 404: code `message_not_found`, message `This answer can't be rated.`
  - API 429: code `rate_limited`, message `Too much feedback. Try later.`, with `Retry-After`.
- **Endpoint:** `POST /v1/chat/sessions/{session_id}/messages/{message_id}/feedback`, body `{"rating": "up" | "down"}`. It returns 204 with an empty body. There's no Turnstile check.
- **Limiter:** `app.state.chat_feedback_limiter = SlidingWindowLimiter([(20, 60), (200, 86_400)])`, keyed by `client_key(ip)` like the others.
- **Database:**
  - enum `chat_feedback` (`up`, `down`);
  - `chat_messages.feedback` (nullable enum) and `chat_messages.feedback_at` (nullable timestamptz);
  - `chat_usage_daily.feedback_up` and `chat_usage_daily.feedback_down` (integer, not null, server default 0).
  - The migration's `down_revision` is `b7c3e9a2d514`. Retention is unchanged: 30 days for messages, 90 days for usage.
- **Counting:**
  - A new or changed rating adds 1 to today's (UTC) column.
  - If the previous rating's `feedback_at` falls on the same UTC day, its column also gets -1.
  - An identical repeat changes nothing.
- **Metric:** `chat_feedback_total{rating="up|down", outcome="answered|no_match|uncited|error"}`. Every child exists from startup.
- **CLI:** `portfolio-api chat-feedback [--days N] [--rating down|up|all]`, with defaults `7` and `down`.
  - It lists rated messages newest first. Each shows the time rated, rating, outcome, question, the answer truncated to 300 characters plus `…`, and the source titles.
  - Control characters are stripped, as `format_chats` does.
- **Make:** `make chat-feedback`, with `DAYS` (default 7) and `RATING` (default down), runs the command in the api container via `in_service`.
- **Secrets and tooling:**
  - Never create, read or write `.env` or `.env.*` files. Never run sops or `make secrets-*`.
  - Python only via `uv` (`uv run ...`), never pip or plain `python`.
- **Style:** match the existing code style, comment density and naming. Make surgical changes only. Add no dependencies.
- **Commits:** on branch `feat/chat-feedback`. Every commit message ends with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push.
- **Command timeouts:** run every test suite, build, docker or Playwright command with an explicit timeout (10 minutes is enough for each).
- **DB tests** need a migrated Postgres. Use the dev Postgres on host port 55432 (port 5432 is taken on Chris's Mac; see `apps/api/README.md`):
  - Start it (idempotent), from the repo root: `POSTGRES_PORT=55432 docker compose -f infra/compose/compose.dev.yaml up -d postgres`
  - Every API command below that touches the database is prefixed with `API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio`. Shell state doesn't persist between commands, so always write the prefix out.
  - The fixture truncates every app table. Run the suite from one checkout at a time.
- **Before a task's final checks:**
  - API (from `apps/api`): `uv run ruff format . && uv run ruff check --fix .`, then `uv run pyright`.
  - Web (from `apps/web`): `pnpm exec prettier --write <files you changed>`, then `pnpm lint` and `pnpm exec tsc --noEmit`.
- **Checks that must pass at the end:**
  - API (from `apps/api`): `uv run ruff check .`, `uv run ruff format --check .`, `uv run pyright`, `alembic upgrade head`, `alembic check`, `alembic downgrade -1 && alembic upgrade head`, and `uv run pytest`. Each command that touches the database carries the `API_DATABASE_URL` prefix.
  - Web (from `apps/web`): `pnpm vitest run`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm exec prettier --check .`, `pnpm build`, then `pnpm exec playwright test`.
  - Before local e2e, run `pkill -f next-server; pkill -f "e2e/fake-backend.mjs"`.
- **JS budget (`e2e/budgets.json`):** the chat terminal is a lazy chunk (`chat-launcher.tsx` uses `lazy(() => import("./chat-terminal"))`), and `lib/chat.ts` is imported only by the terminal. No measured page should grow. If `budget.spec.ts` fails anyway, don't raise a budget. Rerun with `BUDGET_PRINT_ONLY=1 pnpm exec playwright test e2e/budget.spec.ts`, and report the measured numbers.
- **Next 16:** this PR uses no new Next APIs (`apps/web/AGENTS.md`). The terminal is a plain client component.
- **CI:** keep every pinned action SHA. The only workflow change is one `run:` line in the `api` job.

## File map

| File | Responsibility | Task |
|---|---|---|
| `apps/api/alembic/versions/c5d2f8a1e93b_chat_feedback.py` | Migration: enum, two message columns, two usage counters | 1 |
| `apps/api/src/portfolio_api/models/chat.py` | `ChatFeedback` enum; new columns on `ChatMessage` and `ChatUsageDaily` | 1 |
| `apps/api/src/portfolio_api/models/__init__.py` | Export `ChatFeedback` | 1 |
| `apps/api/src/portfolio_api/repositories/chat.py` | `record_message` returns the id; `message_in_session`, `count_feedback`, `rated_since` | 1 (rated_since: 3) |
| `apps/api/src/portfolio_api/metrics.py` | `CHAT_FEEDBACK` counter and its pre-created children | 1 |
| `apps/api/src/portfolio_api/services/chat.py` | `ChatAnswer.message_id`, `_owns`, `MessageNotFoundError`, `rate()` | 1 |
| `.github/workflows/ci.yml` | Migration downgrade/re-upgrade step | 1 |
| `apps/api/tests/test_chat.py`, `test_chat_foundation.py`, `test_metrics.py` | Service, schema and metric tests | 1 |
| `apps/api/src/portfolio_api/schemas/chat.py` | `MessageResponse.message_id`, `FeedbackRequest` | 2 |
| `apps/api/src/portfolio_api/routers/chat.py` | `limit_feedback`, feedback endpoint, `message_id` in `ask` | 2 |
| `apps/api/src/portfolio_api/main.py` | `chat_feedback_limiter` | 2 |
| `apps/api/tests/test_chat_api.py` | HTTP tests | 2 |
| `infra/observability/grafana/dashboards/portfolio-overview.json` | "Chat feedback by rating (range)" panel | 2 |
| `apps/api/src/portfolio_api/cli.py` | `format_feedback`, `_chat_feedback`, `chat-feedback` subcommand | 3 |
| `apps/api/tests/test_cli.py` | Format, filter and argument tests | 3 |
| `Makefile` | `chat-feedback` target | 3 |
| `docs/runbook.md`, `docs/security.md`, `docs/architecture.md` | Feedback docs | 3 |
| `apps/web/src/lib/chat.ts` (+ `chat.test.ts`) | `messageId`, `sendFeedback`, copy | 4 |
| `apps/web/src/components/chat/chat-terminal.tsx` (+ test) | `AnswerFeedback` row | 4 |
| `apps/web/e2e/fixtures/api/chat-message.json`, `e2e/fake-backend.mjs`, `e2e/journey.spec.ts` | e2e support and journey step | 4 |

---

### Task 1: Store ratings (migration, model, repository, service, metric)

**Files:**
- Create: `apps/api/alembic/versions/c5d2f8a1e93b_chat_feedback.py`
- Modify: `apps/api/src/portfolio_api/models/chat.py`
- Modify: `apps/api/src/portfolio_api/models/__init__.py`
- Modify: `apps/api/src/portfolio_api/repositories/chat.py`
- Modify: `apps/api/src/portfolio_api/metrics.py`
- Modify: `apps/api/src/portfolio_api/services/chat.py`
- Modify: `.github/workflows/ci.yml:133-135`
- Test: `apps/api/tests/test_chat.py`, `apps/api/tests/test_chat_foundation.py`, `apps/api/tests/test_metrics.py`

**Interfaces:**
- Consumes: nothing new.
- Produces (later tasks rely on these exact names):
  - `portfolio_api.models.ChatFeedback(enum.StrEnum)` with members `up = "up"` and `down = "down"`.
  - `ChatMessage.feedback: ChatFeedback | None` and `ChatMessage.feedback_at: datetime | None`.
  - `ChatUsageDaily.feedback_up: int` and `ChatUsageDaily.feedback_down: int`.
  - `repo.record_message(...) -> int` returns the new row's id.
  - `repo.message_in_session(session, session_id: uuid.UUID, message_id: int) -> ChatMessage | None`.
  - `repo.count_feedback(session, day: date, rating: ChatFeedback, step: int) -> None`.
  - `ChatAnswer.message_id: int`, the last field of the dataclass.
  - `services.chat.MessageNotFoundError(Exception)`.
  - `ChatService.rate(session_id: uuid.UUID, message_id: int, ip: str, rating: ChatFeedback) -> None`. It raises `MessageNotFoundError`.
  - `metrics.CHAT_FEEDBACK`, the Counter `chat_feedback_total` with labels `["rating", "outcome"]`.

- [ ] **Step 1: Start the dev Postgres and make sure it is at the current head**

Run (from the repo root):
```bash
POSTGRES_PORT=55432 docker compose -f infra/compose/compose.dev.yaml up -d postgres
cd apps/api && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run alembic upgrade head && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run alembic current
```
Expected: `b7c3e9a2d514 (head)`.

- [ ] **Step 2: Write the failing service tests**

In `apps/api/tests/test_chat.py`, change the imports at the top to:

```python
import asyncio
import hashlib
import hmac
import uuid
from collections.abc import AsyncGenerator, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from typing import cast

import pytest
from sqlalchemy import event, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from structlog.testing import capture_logs

from portfolio_api.clients.directus import ChatSettings, DirectusError
from portfolio_api.clients.groq import ChatTurn, ModelBusyError, ModelReply, ModelUnavailableError
from portfolio_api.models import (
    ChatFeedback,
    ChatMessage,
    ChatOutcome,
    ChatSession,
    ChatUsageDaily,
)
from portfolio_api.rag.retrieval import Retrieved
from portfolio_api.repositories import chat as chat_repo
from portfolio_api.services.chat import (
    MAX_QUESTIONS,
    BudgetExhaustedError,
    ChatService,
    ChatSwitch,
    MessageNotFoundError,
    SearchesIndex,
    SessionLimitError,
    SessionNotFoundError,
    purge_expired_chats,
)
from portfolio_api.services.grounding import CANNED_ANSWER, CONTACT_SOURCE, Source
from tests.fakes import HIT, FakeChatModel, FakeChatSettingsSource, FakeRetriever, metric
```

Append to the end of `apps/api/tests/test_chat.py`:

```python
async def rated(db: Sessions, message_id: int) -> ChatMessage:
    async with db() as session:
        row = await session.get(ChatMessage, message_id)
    assert row is not None
    return row


async def feedback_counts(db: Sessions) -> dict[date, tuple[int, int]]:
    """(feedback_up, feedback_down) for every usage day."""
    async with db() as session:
        rows = (await session.scalars(select(ChatUsageDaily))).all()
    return {r.day: (r.feedback_up, r.feedback_down) for r in rows}


@pytest.mark.parametrize(
    ("model", "retriever", "outcome"),
    [
        (FakeChatModel(), FakeRetriever(), ChatOutcome.answered),
        (FakeChatModel(), FakeRetriever(best=0.3), ChatOutcome.no_match),
        (FakeChatModel(ModelReply("He is great.", 900, 20)), FakeRetriever(), ChatOutcome.uncited),
    ],
)
async def test_every_answer_carries_its_message_id(
    db: Sessions, model: FakeChatModel, retriever: FakeRetriever, outcome: ChatOutcome
) -> None:
    chat = service(db, model, retriever)
    session_id, _ = await chat.open_session(IP)
    answer = await chat.ask(session_id, IP, "q?")
    [msg] = await messages(db)
    assert answer.outcome == outcome
    assert answer.message_id == msg.id


async def test_rating_is_stored_counted_and_measured(db: Sessions) -> None:
    now = datetime.now(UTC)
    chat = service(db, clock=now)
    session_id, _ = await chat.open_session(IP)
    answer = await chat.ask(session_id, IP, "Has he used FastAPI?")
    before = metric("chat_feedback_total", rating="down", outcome="answered")
    await chat.rate(session_id, answer.message_id, IP, ChatFeedback.down)
    msg = await rated(db, answer.message_id)
    assert (msg.feedback, msg.feedback_at) == (ChatFeedback.down, now)
    assert await feedback_counts(db) == {now.date(): (0, 1)}
    assert metric("chat_feedback_total", rating="down", outcome="answered") == before + 1
    assert await question_count(db, session_id) == 1  # rating does not use up a question


async def test_changing_a_rating_the_same_day_moves_the_count(db: Sessions) -> None:
    now = datetime.now(UTC)
    chat = service(db, clock=now)
    session_id, _ = await chat.open_session(IP)
    answer = await chat.ask(session_id, IP, "q?")
    up = metric("chat_feedback_total", rating="up", outcome="answered")
    await chat.rate(session_id, answer.message_id, IP, ChatFeedback.down)
    await chat.rate(session_id, answer.message_id, IP, ChatFeedback.up)
    assert (await rated(db, answer.message_id)).feedback == ChatFeedback.up
    assert await feedback_counts(db) == {now.date(): (1, 0)}
    assert metric("chat_feedback_total", rating="up", outcome="answered") == up + 1


async def test_repeating_a_rating_changes_nothing(db: Sessions) -> None:
    now = datetime.now(UTC)
    chat = service(db, clock=now)
    session_id, _ = await chat.open_session(IP)
    answer = await chat.ask(session_id, IP, "q?")
    down = metric("chat_feedback_total", rating="down", outcome="answered")
    await chat.rate(session_id, answer.message_id, IP, ChatFeedback.down)
    later = service(db, clock=now + timedelta(minutes=5))
    await later.rate(session_id, answer.message_id, IP, ChatFeedback.down)
    assert (await rated(db, answer.message_id)).feedback_at == now
    assert await feedback_counts(db) == {now.date(): (0, 1)}
    assert metric("chat_feedback_total", rating="down", outcome="answered") == down + 1


async def test_changing_a_rating_on_a_later_day_counts_only_today(db: Sessions) -> None:
    evening = datetime(2026, 10, 12, 23, 30, tzinfo=UTC)
    chat = service(db, clock=evening)
    session_id, _ = await chat.open_session(IP)
    async with db.begin() as session:  # opened just before the fake clock, so it is live
        await session.execute(
            update(ChatSession)
            .where(ChatSession.id == session_id)
            .values(created_at=evening - timedelta(minutes=1))
        )
    answer = await chat.ask(session_id, IP, "q?")
    await chat.rate(session_id, answer.message_id, IP, ChatFeedback.up)
    after_midnight = service(db, clock=evening + timedelta(hours=1))
    await after_midnight.rate(session_id, answer.message_id, IP, ChatFeedback.down)
    assert await feedback_counts(db) == {
        date(2026, 10, 12): (1, 0),
        date(2026, 10, 13): (0, 1),
    }


async def test_rating_needs_the_message_in_a_live_session_from_the_same_ip(db: Sessions) -> None:
    chat = service(db)
    session_id, _ = await chat.open_session(IP)
    other_session, _ = await chat.open_session(IP)
    answer = await chat.ask(session_id, IP, "q?")
    later = service(db, clock=datetime.now(UTC) + timedelta(hours=3))
    mid = answer.message_id
    for attempt in (
        lambda: chat.rate(other_session, mid, IP, ChatFeedback.down),  # another session
        lambda: chat.rate(session_id, mid, "198.51.100.1", ChatFeedback.down),  # other IP
        lambda: chat.rate(session_id, mid + 1000, IP, ChatFeedback.down),  # unknown message
        lambda: chat.rate(uuid.uuid4(), mid, IP, ChatFeedback.down),  # unknown session
        lambda: later.rate(session_id, mid, IP, ChatFeedback.down),  # expired session
    ):
        with pytest.raises(MessageNotFoundError):
            await attempt()
    assert (await rated(db, mid)).feedback is None
```

In `apps/api/tests/test_chat_foundation.py`, replace the `async with db() as session:` block in `test_chat_tables_cascade_and_defaults` (the one that reads `row` and `message`) with:

```python
    async with db() as session:
        row = await session.get(ChatSession, sid)
        assert row is not None and row.question_count == 0
        message = (await session.scalars(select(ChatMessage))).one()
        assert message.sources == [] and message.input_tokens == 0
        assert message.feedback is None and message.feedback_at is None
        usage = await session.get(ChatUsageDaily, date(2026, 10, 2))
        assert usage is not None and (usage.feedback_up, usage.feedback_down) == (0, 0)
```

In `apps/api/tests/test_metrics.py`, add `"chat_feedback_total",` to `METRIC_NAMES` right after `"chat_budget_used_ratio",`. Append:

```python
async def test_chat_feedback_series_exist_from_startup(client: AsyncClient) -> None:
    text = (await client.get("/metrics")).text
    assert 'chat_feedback_total{rating="down",outcome="no_match"}' in text
    assert 'chat_feedback_total{rating="up",outcome="error"}' in text
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/api && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run pytest tests/test_chat.py tests/test_chat_foundation.py tests/test_metrics.py -q`
Expected: a collection error, `ImportError: cannot import name 'ChatFeedback' from 'portfolio_api.models'`.

- [ ] **Step 4: Add the enum and columns to the model**

In `apps/api/src/portfolio_api/models/chat.py`, add after `_outcome_values`:

```python
class ChatFeedback(enum.StrEnum):
    up = "up"
    down = "down"


def _feedback_values(e: type[ChatFeedback]) -> list[str]:
    return [m.value for m in e]
```

In `ChatMessage`, add after the `created_at` column:

```python
    # The visitor's rating of this reply; the last one wins. Deleted with the row.
    feedback: Mapped[ChatFeedback | None] = mapped_column(
        Enum(ChatFeedback, name="chat_feedback", values_callable=_feedback_values)
    )
    feedback_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
```

Change the `ChatUsageDaily` docstring and add two columns after `requests`:

```python
class ChatUsageDaily(Base):
    """Model tokens and calls per UTC day, for the daily budget gate, plus that day's ratings."""

    __tablename__ = "chat_usage_daily"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    tokens: Mapped[int] = mapped_column(Integer, server_default="0")
    requests: Mapped[int] = mapped_column(Integer, server_default="0")
    feedback_up: Mapped[int] = mapped_column(Integer, server_default="0")
    feedback_down: Mapped[int] = mapped_column(Integer, server_default="0")
```

In `apps/api/src/portfolio_api/models/__init__.py`, change the chat import and `__all__`:

```python
from portfolio_api.models.chat import (  # noqa: E402
    ChatFeedback,
    ChatMessage,
    ChatOutcome,
    ChatSession,
    ChatUsageDaily,
)
```

and add `"ChatFeedback",` to `__all__` between `"Base",` and `"ChatMessage",`.

- [ ] **Step 5: Write the migration**

Create `apps/api/alembic/versions/c5d2f8a1e93b_chat_feedback.py`:

```python
"""chat feedback: a rating per message and daily rating counts

Revision ID: c5d2f8a1e93b
Revises: b7c3e9a2d514
Create Date: 2026-10-12 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c5d2f8a1e93b"
down_revision: str | Sequence[str] | None = "b7c3e9a2d514"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CHAT_FEEDBACK = postgresql.ENUM("up", "down", name="chat_feedback", create_type=False)


def upgrade() -> None:
    """Upgrade schema."""
    postgresql.ENUM("up", "down", name="chat_feedback").create(op.get_bind())
    op.add_column("chat_messages", sa.Column("feedback", CHAT_FEEDBACK, nullable=True))  # pyright: ignore[reportUnknownArgumentType]
    op.add_column(
        "chat_messages", sa.Column("feedback_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "chat_usage_daily",
        sa.Column("feedback_up", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "chat_usage_daily",
        sa.Column("feedback_down", sa.Integer(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("chat_usage_daily", "feedback_down")
    op.drop_column("chat_usage_daily", "feedback_up")
    op.drop_column("chat_messages", "feedback_at")
    op.drop_column("chat_messages", "feedback")
    CHAT_FEEDBACK.drop(op.get_bind())
```

- [ ] **Step 6: Apply it, check it matches the models, and round-trip it**

Run:
```bash
cd apps/api && export U=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio && API_DATABASE_URL=$U uv run alembic upgrade head && API_DATABASE_URL=$U uv run alembic check && API_DATABASE_URL=$U uv run alembic downgrade -1 && API_DATABASE_URL=$U uv run alembic upgrade head && API_DATABASE_URL=$U uv run alembic current
```
Expected:
- `check` prints `No new upgrade operations detected.`
- The downgrade and re-upgrade succeed.
- `current` prints `c5d2f8a1e93b (head)`.

If `check` reports a difference, change the migration until it matches the models (the models are the authority), and say so in the report.

- [ ] **Step 7: Add the repository functions**

In `apps/api/src/portfolio_api/repositories/chat.py`, change the models import to:

```python
from portfolio_api.models import (
    ChatFeedback,
    ChatMessage,
    ChatOutcome,
    ChatSession,
    ChatUsageDaily,
)
```

Replace `record_message` with this version (same parameters, now returns the id), and add `message_in_session` right after it:

```python
async def record_message(
    session: AsyncSession,
    *,
    session_id: uuid.UUID,
    question: str,
    answer: str | None,
    outcome: ChatOutcome,
    sources: Sequence[dict[str, Any]],
    input_tokens: int,
    output_tokens: int,
) -> int:
    row = ChatMessage(
        session_id=session_id,
        question=question,
        answer=answer,
        outcome=outcome,
        sources=list(sources),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )
    session.add(row)
    await session.flush()
    return row.id


async def message_in_session(
    session: AsyncSession, session_id: uuid.UUID, message_id: int
) -> ChatMessage | None:
    """The message if it belongs to ``session_id``, locked until the transaction ends."""
    return await session.scalar(
        select(ChatMessage)
        .where(ChatMessage.id == message_id, ChatMessage.session_id == session_id)
        .with_for_update()
    )
```

Add after `add_usage`:

```python
async def count_feedback(session: AsyncSession, day: date, rating: ChatFeedback, step: int) -> None:
    """Add ``step`` to ``day``'s count for ``rating`` (-1 takes back a same-day rating)."""
    column = (
        ChatUsageDaily.feedback_up if rating == ChatFeedback.up else ChatUsageDaily.feedback_down
    )
    stmt = insert(ChatUsageDaily).values({"day": day, column.key: step})
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=[ChatUsageDaily.day], set_={column.key: column + step}
        )
    )
```

- [ ] **Step 8: Add the metric**

In `apps/api/src/portfolio_api/metrics.py`:
- Change `from portfolio_api.models import ChatOutcome` to `from portfolio_api.models import ChatFeedback, ChatOutcome`.
- Add after `CHAT_BUDGET_USED_RATIO`:

```python
CHAT_FEEDBACK = Counter(
    "chat_feedback_total",
    "Chat ratings stored, by rating and the rated reply's outcome.",
    ["rating", "outcome"],
    registry=REGISTRY,
)
```

- Add after the `CHAT_TOKENS` children loop (`for _kind in ("input", "output"): ...`):

```python
for _rating in (r.value for r in ChatFeedback):
    for _outcome in (o.value for o in ChatOutcome):
        CHAT_FEEDBACK.labels(rating=_rating, outcome=_outcome)
```

- [ ] **Step 9: Add `message_id`, the shared ownership check and `rate()` to the service**

In `apps/api/src/portfolio_api/services/chat.py`:

Change the metrics and models imports to:

```python
from portfolio_api.metrics import (
    CHAT_BUDGET_USED_RATIO,
    CHAT_FEEDBACK,
    CHAT_QUESTIONS,
    CHAT_REJECTED,
    CHAT_TOKENS,
)
from portfolio_api.models import ChatFeedback, ChatOutcome, ChatSession
```

Add after `BudgetExhaustedError`:

```python
class MessageNotFoundError(Exception):
    """Unknown message, or not in a live session opened from this IP."""
```

Give `ChatAnswer` a last field:

```python
@dataclass(frozen=True)
class ChatAnswer:
    answer: str
    sources: list[Source]
    outcome: ChatOutcome
    questions_left: int
    message_id: int  # the chat_messages row, so the visitor can rate this reply
```

Add after `ip_hash`:

```python
    def _owns(self, row: ChatSession | None, ip: str, now: datetime) -> bool:
        """The session exists, was opened from ``ip`` and is still live (ask and rate share this)."""
        return (
            row is not None
            and hmac.compare_digest(row.ip_hash, self.ip_hash(ip))
            and now - row.created_at <= SESSION_MAX_AGE
        )
```

In `ask`, replace

```python
            row = await repo.get_session(session, session_id)
            if (
                row is None
                or not hmac.compare_digest(row.ip_hash, self.ip_hash(ip))
                or now - row.created_at > SESSION_MAX_AGE
            ):
                raise SessionNotFoundError
```

with

```python
            if not self._owns(await repo.get_session(session, session_id), ip, now):
                raise SessionNotFoundError
```

In `ask`'s success path (the `record_message` call after `counts = ...`, *not* the one in the error branch), change `await repo.record_message(` to `message_id = await repo.record_message(`. Change the last line of `ask` to:

```python
        return ChatAnswer(composed.answer, composed.sources, composed.outcome, left, message_id)
```

Add after `_release`:

```python
    async def rate(
        self, session_id: uuid.UUID, message_id: int, ip: str, rating: ChatFeedback
    ) -> None:
        """Store the visitor's rating of one reply; the last rating wins, a repeat is a no-op.

        Raises MessageNotFoundError unless the message is in a live session opened from ``ip``:
        one error for every case, so message ids cannot be probed.
        """
        now = self._clock()
        async with self._sessions.begin() as session:
            if not self._owns(await repo.get_session(session, session_id), ip, now):
                raise MessageNotFoundError
            message = await repo.message_in_session(session, session_id, message_id)
            if message is None:
                raise MessageNotFoundError
            if message.feedback == rating:
                return
            previous, previous_at = message.feedback, message.feedback_at
            # A change on the same UTC day moves that day's count; otherwise today just gains one.
            if (
                previous is not None
                and previous_at is not None
                and previous_at.astimezone(UTC).date() == now.date()
            ):
                await repo.count_feedback(session, now.date(), previous, -1)
            await repo.count_feedback(session, now.date(), rating, 1)
            message.feedback = rating
            message.feedback_at = now
            outcome = message.outcome
        CHAT_FEEDBACK.labels(rating=rating.value, outcome=outcome.value).inc()
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `cd apps/api && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run pytest tests/test_chat.py tests/test_chat_foundation.py tests/test_metrics.py tests/test_cli.py -q`
Expected: all pass. `test_cli.py` builds `ChatService` and must still pass. `tests/test_chat_api.py` must also still pass unchanged, because the router doesn't put `message_id` in the response until Task 2. Check with `cd apps/api && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run pytest tests/test_chat_api.py -q`.

- [ ] **Step 11: Add the migration round trip to CI**

In `.github/workflows/ci.yml`, in the `api` job, change

```yaml
      - run: uv run alembic upgrade head
      - run: uv run alembic check
      - run: uv run pytest
```

to

```yaml
      - run: uv run alembic upgrade head
      - run: uv run alembic check
      # The newest migration must undo cleanly and re-apply before the tests run.
      - run: uv run alembic downgrade -1 && uv run alembic upgrade head
      - run: uv run pytest
```

- [ ] **Step 12: Format, lint, type-check, full suite**

Run: `cd apps/api && uv run ruff format . && uv run ruff check --fix . && uv run pyright && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run pytest -q`
Expected: ruff clean, `0 errors, 0 warnings, 0 informations` from pyright, every test passes.

- [ ] **Step 13: Commit**

```bash
git add apps/api/alembic/versions/c5d2f8a1e93b_chat_feedback.py apps/api/src/portfolio_api/models/chat.py apps/api/src/portfolio_api/models/__init__.py apps/api/src/portfolio_api/repositories/chat.py apps/api/src/portfolio_api/metrics.py apps/api/src/portfolio_api/services/chat.py apps/api/tests/test_chat.py apps/api/tests/test_chat_foundation.py apps/api/tests/test_metrics.py .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
feat(api): store chat ratings (migration, service, chat_feedback_total)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Feedback endpoint, `message_id` in responses, limiter, Grafana panel

**Files:**
- Modify: `apps/api/src/portfolio_api/schemas/chat.py`
- Modify: `apps/api/src/portfolio_api/routers/chat.py`
- Modify: `apps/api/src/portfolio_api/main.py:126-127`
- Modify: `infra/observability/grafana/dashboards/portfolio-overview.json`
- Test: `apps/api/tests/test_chat_api.py`

**Interfaces:**
- Consumes (from Task 1):
  - `ChatFeedback` (models);
  - `ChatService.rate(session_id, message_id, ip, rating)` and `MessageNotFoundError` (services.chat);
  - `ChatAnswer.message_id: int`;
  - `ChatMessage.feedback`.
- Produces (Task 4 relies on this HTTP contract):
  - `MessageResponse` JSON gains `"message_id": <int>`.
  - `POST /v1/chat/sessions/{session_id}/messages/{message_id}/feedback` with body `{"rating": "up"|"down"}`. Responses:
    - 204 with an empty body on success;
    - 404 `message_not_found` for any session, IP or message mismatch;
    - 400 `invalid_request` for a bad body or id;
    - 429 `rate_limited` with `Retry-After`;
    - 503 `chat_disabled` while chat is off.

- [ ] **Step 1: Write the failing HTTP tests**

In `apps/api/tests/test_chat_api.py`, change the imports to:

```python
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.clients.directus import ChatSettings
from portfolio_api.clients.groq import ModelBusyError, ModelUnavailableError
from portfolio_api.clients.turnstile import TurnstileUnavailableError
from portfolio_api.config import Settings
from portfolio_api.main import create_app
from portfolio_api.models import ChatFeedback, ChatMessage, ChatUsageDaily
from portfolio_api.ratelimit import SlidingWindowLimiter
from portfolio_api.services.chat import ChatService, ChatSwitch
from tests.fakes import (
    FakeChatModel,
    FakeChatSettingsSource,
    FakeRetriever,
    FakeTurnstile,
    metric,
)
```

Replace `test_ask` with:

```python
async def test_ask(settings: Settings, db: Sessions) -> None:
    app = make_app(settings, db)
    sid = await open_session(app)
    res = await call(app, f"/v1/chat/sessions/{sid}/messages", {"question": "  FastAPI?  "})
    assert res.status_code == 200
    body = res.json()
    async with db() as session:
        stored = await session.scalar(select(ChatMessage.id))
    assert body.pop("message_id") == stored
    assert body == {
        "answer": "He built it with FastAPI [1].",
        "sources": [{"n": 1, "title": "ACM@AU platform", "url": "/projects/acm"}],
        "outcome": "answered",
        "questions_left": 9,
    }
```

Add a third case to the `test_requests_without_a_client_ip_are_rejected` parametrize list:

```python
        (
            "/v1/chat/sessions/00000000-0000-4000-8000-000000000000/messages/1/feedback",
            {"rating": "up"},
        ),
```

Append after `test_requests_without_a_client_ip_are_rejected`:

```python
async def ask_one(app: FastAPI, sid: str) -> int:
    res = await call(app, f"/v1/chat/sessions/{sid}/messages", {"question": "FastAPI?"})
    assert res.status_code == 200, res.text
    return res.json()["message_id"]


def feedback_path(sid: str, message_id: int | str) -> str:
    return f"/v1/chat/sessions/{sid}/messages/{message_id}/feedback"


async def test_feedback_is_stored_and_the_last_rating_wins(
    settings: Settings, db: Sessions
) -> None:
    app = make_app(settings, db)
    sid = await open_session(app)
    mid = await ask_one(app, sid)
    res = await call(app, feedback_path(sid, mid), {"rating": "down"})
    assert (res.status_code, res.content) == (204, b"")
    res = await call(app, feedback_path(sid, mid), {"rating": "up"})
    assert res.status_code == 204
    async with db() as session:
        msg = await session.get(ChatMessage, mid)
    assert msg is not None and msg.feedback == ChatFeedback.up


async def test_feedback_failures_are_one_indistinguishable_404(
    settings: Settings, db: Sessions
) -> None:
    app = make_app(settings, db)
    sid = await open_session(app)
    other = await open_session(app)
    mid = await ask_one(app, sid)
    unknown = "00000000-0000-4000-8000-000000000000"
    attempts = [
        (feedback_path(other, mid), IP),  # the message is in another session
        (feedback_path(sid, mid), "198.51.100.9"),  # the session was opened from another IP
        (feedback_path(sid, mid + 1000), IP),  # no such message
        (feedback_path(unknown, mid), IP),  # no such session
    ]
    bodies: list[Any] = []
    for path, ip in attempts:
        res = await call(app, path, {"rating": "down"}, ip=ip)
        assert res.status_code == 404
        bodies.append(res.json())
    expected = {"error": {"code": "message_not_found", "message": "This answer can't be rated."}}
    assert bodies == [expected] * len(attempts)


@pytest.mark.parametrize(
    ("message_id", "body"),
    [
        ("1", {"rating": "meh"}),
        ("1", {}),
        ("0", {"rating": "up"}),
        ("2147483648", {"rating": "up"}),  # past chat_messages.id's integer range
        ("abc", {"rating": "up"}),
    ],
)
async def test_feedback_validates_the_request(
    settings: Settings, db: Sessions, message_id: str, body: Any
) -> None:
    app = make_app(settings, db)
    sid = await open_session(app)
    res = await call(app, feedback_path(sid, message_id), body)
    assert (res.status_code, res.json()["error"]["code"]) == (400, "invalid_request")


async def test_feedback_rate_limit(settings: Settings, db: Sessions) -> None:
    app = make_app(settings, db)
    sid = await open_session(app)
    for _ in range(20):
        res = await call(app, feedback_path(sid, 1), {"rating": "up"})
        assert res.status_code == 404
    res = await call(app, feedback_path(sid, 1), {"rating": "up"})
    assert res.status_code == 429 and res.json()["error"]["code"] == "rate_limited"
    assert int(res.headers["Retry-After"]) > 0


async def test_feedback_when_chat_is_off(settings: Settings, db: Sessions) -> None:
    app = make_app(settings, db, enabled=False)
    res = await call(app, feedback_path("00000000-0000-4000-8000-000000000000", 1), {"rating": "up"})
    assert (res.status_code, res.json()["error"]["code"]) == (503, "chat_disabled")
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run pytest tests/test_chat_api.py -q`
Expected: failures. `test_ask` fails with `KeyError: 'message_id'`, and the feedback tests fail with 404 `not_found` (no route) or `AttributeError: 'State' object has no attribute 'chat_feedback_limiter'`.

- [ ] **Step 3: Add the schemas**

In `apps/api/src/portfolio_api/schemas/chat.py`, replace `MessageResponse` and add `FeedbackRequest` after it:

```python
class MessageResponse(BaseModel):
    message_id: int
    answer: str
    sources: list[SourceOut]
    outcome: Literal["answered", "no_match", "uncited"]
    questions_left: int


class FeedbackRequest(BaseModel):
    rating: Literal["up", "down"]
```

- [ ] **Step 4: Add the limiter**

In `apps/api/src/portfolio_api/main.py`, after `app.state.chat_message_limiter = ...`, add:

```python
    app.state.chat_feedback_limiter = SlidingWindowLimiter([(20, 60), (200, 86_400)])
```

- [ ] **Step 5: Add the endpoint and `message_id` to `ask`**

In `apps/api/src/portfolio_api/routers/chat.py`:

Change the imports to:

```python
import uuid
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, Path, Request

from portfolio_api.clients.groq import ModelBusyError, ModelUnavailableError
from portfolio_api.clients.turnstile import TurnstileUnavailableError, TurnstileVerifier
from portfolio_api.errors import ApiError
from portfolio_api.metrics import CHAT_QUESTIONS, CHAT_REJECTED
from portfolio_api.models import ChatFeedback
from portfolio_api.ratelimit import SlidingWindowLimiter, client_ip, client_key
from portfolio_api.schemas.chat import (
    FeedbackRequest,
    MessageRequest,
    MessageResponse,
    SessionCreated,
    SessionRequest,
    SourceOut,
)
from portfolio_api.services.chat import (
    BudgetExhaustedError,
    ChatService,
    ChatSwitch,
    MessageNotFoundError,
    SessionLimitError,
    SessionNotFoundError,
)

router = APIRouter(prefix="/v1/chat", tags=["chat"])

MAX_MESSAGE_ID = 2**31 - 1  # chat_messages.id is a Postgres integer
```

Add after `limit_messages`:

```python
async def limit_feedback(request: Request) -> None:
    _limit(request.app.state.chat_feedback_limiter, request, "Too much feedback. Try later.")
```

Change the `return MessageResponse(...)` at the end of `ask` to:

```python
    return MessageResponse(
        message_id=answer.message_id,
        answer=answer.answer,
        sources=[SourceOut(n=s.n, title=s.title, url=s.url) for s in answer.sources],
        outcome=outcome,
        questions_left=answer.questions_left,
    )
```

Append to the end of the file:

```python
# No Turnstile: the session was Turnstile-checked when it opened. A rating never uses a question.
@router.post(
    "/sessions/{session_id}/messages/{message_id}/feedback",
    status_code=204,
    dependencies=[Depends(limit_feedback)],
)
async def rate(
    request: Request,
    session_id: uuid.UUID,
    message_id: Annotated[int, Path(ge=1, le=MAX_MESSAGE_ID)],
    service: Annotated[ChatService, Depends(require_chat)],
    body: FeedbackRequest,
) -> None:
    try:
        await service.rate(session_id, message_id, require_ip(request), ChatFeedback(body.rating))
    except MessageNotFoundError as exc:
        raise ApiError(404, "message_not_found", "This answer can't be rated.") from exc
```

- [ ] **Step 6: Run the HTTP tests to verify they pass**

Run: `cd apps/api && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run pytest tests/test_chat_api.py -q`
Expected: all pass.

- [ ] **Step 7: Add the Grafana panel**

In `infra/observability/grafana/dashboards/portfolio-overview.json`, add a comma after the closing `}` of panel `"id": 13` ("Chat index syncs (per hour)"), then add this panel as the last element of `panels`:

```json
    {
      "id": 14,
      "type": "stat",
      "title": "Chat feedback by rating (range)",
      "gridPos": { "h": 4, "w": 12, "x": 0, "y": 42 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "sum by (rating) (increase(chat_feedback_total[$__range]))", "legendFormat": "{{rating}}", "instant": true }],
      "fieldConfig": { "defaults": { "unit": "short", "decimals": 0 }, "overrides": [] },
      "options": { "colorMode": "none", "graphMode": "none", "textMode": "value_and_name", "reduceOptions": { "calcs": ["lastNotNull"] } }
    }
```

Validate it the same way CI does (from the repo root):

```bash
jq -e '(.uid | type == "string") and (.panels | length > 0) and ([.panels[].id] | length == (unique | length)) and (.panels[-1].title == "Chat feedback by rating (range)")' infra/observability/grafana/dashboards/portfolio-overview.json
```
Expected: `true`.

- [ ] **Step 8: Format, lint, type-check, full suite**

Run: `cd apps/api && uv run ruff format . && uv run ruff check --fix . && uv run pyright && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run pytest -q`
Expected: clean, all tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/portfolio_api/schemas/chat.py apps/api/src/portfolio_api/routers/chat.py apps/api/src/portfolio_api/main.py apps/api/tests/test_chat_api.py infra/observability/grafana/dashboards/portfolio-overview.json
git commit -m "$(cat <<'EOF'
feat(api): chat feedback endpoint, message_id in answers, feedback panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `chat-feedback` command, `make chat-feedback`, docs

**Files:**
- Modify: `apps/api/src/portfolio_api/repositories/chat.py` (add `rated_since`)
- Modify: `apps/api/src/portfolio_api/cli.py`
- Modify: `Makefile`
- Modify: `docs/runbook.md` ("Ask about Chris (chat)" section), `docs/security.md` (the "Form spam and chat abuse" row), `docs/architecture.md` (Chat diagram)
- Test: `apps/api/tests/test_cli.py`

**Interfaces:**
- Consumes (from Task 1): `ChatFeedback`, `ChatMessage.feedback` and `ChatMessage.feedback_at`.
- Produces:
  - `repo.rated_since(session, since: datetime, rating: ChatFeedback | None) -> list[ChatMessage]`, newest `feedback_at` first. `None` means both ratings.
  - `cli.format_feedback(messages: Sequence[ChatMessage]) -> str`.
  - `cli.ANSWER_PREVIEW = 300`.

- [ ] **Step 1: Write the failing CLI tests**

In `apps/api/tests/test_cli.py`, change the imports to:

```python
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.cli import (
    format_chats,
    format_feedback,
    judge_answerable,
    judge_refusal,
    load_eval_cases,
    main,
    run_eval,
)
from portfolio_api.clients.groq import ModelBusyError, ModelReply
from portfolio_api.models import (
    ChatFeedback,
    ChatMessage,
    ChatOutcome,
    ChatSession,
    ChatUsageDaily,
)
from portfolio_api.repositories import chat as chat_repo
from portfolio_api.services.chat import ChatService, Composed
from portfolio_api.services.grounding import CANNED_ANSWER, Source
from tests.fakes import FakeChatModel, FakeRetriever
```

Append:

```python
def test_format_feedback() -> None:
    msgs = [
        ChatMessage(
            question="Is he on Kubernetes?",
            answer=CANNED_ANSWER,
            outcome=ChatOutcome.no_match,
            sources=[{"n": 1, "title": "Contact", "url": "/contact"}],
            feedback=ChatFeedback.down,
            feedback_at=datetime(2026, 10, 12, 14, 3, tzinfo=UTC),
        ),
        ChatMessage(
            question="Poem?",
            answer=None,
            outcome=ChatOutcome.error,
            sources=[],
            feedback=ChatFeedback.up,
            feedback_at=datetime(2026, 10, 11, 9, 0, tzinfo=UTC),
        ),
    ]
    assert format_feedback(msgs) == (
        "== 2026-10-12 14:03 UTC · down · no_match\n"
        "Q: Is he on Kubernetes?\n"
        f"A: {CANNED_ANSWER}\n"
        "sources: Contact\n"
        "\n"
        "== 2026-10-11 09:00 UTC · up · error\n"
        "Q: Poem?"
    )
    assert format_feedback([]) == "No rated answers in this period."


def test_format_feedback_truncates_answers_and_strips_control_characters() -> None:
    msg = ChatMessage(
        question="\x1b[31mred\x07\nnext",
        answer="a" * 299 + "\x1b" + "b" * 10,
        outcome=ChatOutcome.answered,
        sources=[{"n": 1, "title": "T\x9b", "url": "/x"}],
        feedback=ChatFeedback.down,
        feedback_at=datetime(2026, 10, 12, 14, 3, tzinfo=UTC),
    )
    out = format_feedback([msg])
    lines = out.split("\n")
    assert len(lines) == 4  # the injected newline did not add a line
    assert lines[2] == "A: " + "a" * 299 + "b…"  # 300 characters, then the ellipsis
    assert lines[3] == "sources: T"
    assert not any((ord(c) < 32 and c != "\n") or 0x7F <= ord(c) <= 0x9F for c in out)


async def test_rated_since_filters_by_rating_and_age_newest_first(db: Sessions) -> None:
    now = datetime.now(UTC)
    sid = uuid.uuid4()
    rows: list[tuple[str, ChatFeedback | None, timedelta | None]] = [
        ("old down", ChatFeedback.down, timedelta(days=8)),
        ("down", ChatFeedback.down, timedelta(hours=2)),
        ("newer down", ChatFeedback.down, timedelta(hours=1)),
        ("up", ChatFeedback.up, timedelta(hours=3)),
        ("unrated", None, None),
    ]
    async with db.begin() as session:
        session.add(ChatSession(id=sid, ip_hash="x"))
        await session.flush()
        for question, feedback, age in rows:
            session.add(
                ChatMessage(
                    session_id=sid,
                    question=question,
                    answer="a",
                    outcome=ChatOutcome.answered,
                    feedback=feedback,
                    feedback_at=now - age if age is not None else None,
                )
            )
    since = now - timedelta(days=7)
    async with db() as session:
        downs = await chat_repo.rated_since(session, since, ChatFeedback.down)
        ups = await chat_repo.rated_since(session, since, ChatFeedback.up)
        both = await chat_repo.rated_since(session, since, None)
    assert [m.question for m in downs] == ["newer down", "down"]
    assert [m.question for m in ups] == ["up"]
    assert [m.question for m in both] == ["newer down", "down", "up"]


def test_chat_feedback_rejects_an_unknown_rating() -> None:
    with pytest.raises(SystemExit):
        main(["chat-feedback", "--rating", "meh"])
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run pytest tests/test_cli.py -q`
Expected: a collection error, `ImportError: cannot import name 'format_feedback' from 'portfolio_api.cli'`.

- [ ] **Step 3: Add `rated_since` to the repository**

Append to `apps/api/src/portfolio_api/repositories/chat.py`:

```python
async def rated_since(
    session: AsyncSession, since: datetime, rating: ChatFeedback | None
) -> list[ChatMessage]:
    """Messages rated since ``since`` (only ``rating``, or both when None), newest rating first."""
    query = select(ChatMessage).where(ChatMessage.feedback_at >= since)
    if rating is not None:
        query = query.where(ChatMessage.feedback == rating)
    return list((await session.scalars(query.order_by(ChatMessage.feedback_at.desc()))).all())
```

- [ ] **Step 4: Add the formatter and the subcommand**

In `apps/api/src/portfolio_api/cli.py`:

Change the module docstring to:

```python
"""Operator commands: `portfolio-api reindex | chats [--days N] | chat-eval | chat-feedback`."""
```

Change the models import to:

```python
from portfolio_api.models import ChatFeedback, ChatMessage, ChatOutcome, ChatSession
```

Change `BUSY_RETRIES = 3` to:

```python
BUSY_RETRIES = 3
ANSWER_PREVIEW = 300  # characters of each answer chat-feedback shows
```

Add after `format_chats`:

```python
def _preview(text: str) -> str:
    return text if len(text) <= ANSWER_PREVIEW else text[:ANSWER_PREVIEW] + "…"


def format_feedback(messages: Sequence[ChatMessage]) -> str:
    """Rated replies, in the order given. Uncited rows show the model's raw text, as chats does."""
    if not messages:
        return "No rated answers in this period."
    lines: list[str] = []
    for m in messages:
        when = (
            m.feedback_at.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC") if m.feedback_at else "?"
        )
        rating = m.feedback.value if m.feedback else "?"
        lines.append(f"== {when} · {rating} · {m.outcome.value}")
        lines.append(f"Q: {_clean(m.question)}")
        if m.answer:
            lines.append(f"A: {_preview(_clean(m.answer))}")
        if m.sources:
            lines.append("sources: " + ", ".join(_clean(s["title"]) for s in m.sources))
        lines.append("")
    return "\n".join(lines).rstrip()
```

Add after `_chats`:

```python
async def _chat_feedback(settings: Settings, days: int, rating: str) -> int:
    engine = make_engine(settings.database_url)
    try:
        async with make_sessionmaker(engine)() as session:
            since = datetime.now(UTC) - timedelta(days=days)
            rows = await chat_repo.rated_since(
                session, since, None if rating == "all" else ChatFeedback(rating)
            )
    finally:
        await engine.dispose()
    print(format_feedback(rows))
    return 0
```

In `main`, after the `chat-eval` parser line, add:

```python
    feedback = commands.add_parser("chat-feedback", help="print recently rated chat replies")
    feedback.add_argument("--days", type=int, default=7)
    feedback.add_argument("--rating", choices=["down", "up", "all"], default="down")
```

and before the final `return asyncio.run(_chat_eval(settings))`, add:

```python
    if args.command == "chat-feedback":
        return asyncio.run(_chat_feedback(settings, args.days, args.rating))
```

- [ ] **Step 5: Run the CLI tests to verify they pass**

Run: `cd apps/api && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run pytest tests/test_cli.py -q`
Expected: all pass.

- [ ] **Step 6: Smoke-run the command against the dev database**

Run: `cd apps/api && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run portfolio-api chat-feedback --rating all`
Expected: `No rated answers in this period.`. The test fixture empties the tables after each test.

- [ ] **Step 7: Add the Make target**

In `Makefile`:
- Add `chat-feedback` to `.PHONY`, right after `chat-eval`.
- Change `DAYS ?= 7` to:

```make
DAYS ?= 7
RATING ?= down
```

- After the `chat-eval` target, add:

```make
chat-feedback: ## (VM) Print rated chat replies (RATING=up|all, DAYS=30 for more)
	$(call in_service,api,portfolio-api chat-feedback --days $(DAYS) --rating $(RATING))
```

(The recipe line starts with a tab.) Check it: `make help | grep chat-feedback` prints the target with its description, and `make -n chat-feedback` prints the `docker ps ... docker exec $c portfolio-api chat-feedback --days 7 --rating down` recipe without running it.

- [ ] **Step 8: Update the docs**

`docs/runbook.md`, section "Ask about Chris (chat)": insert this bullet right after the "**Check answer quality:**" bullet:

```markdown
- **Read feedback:** visitors rate every reply `helpful? [y] [n]`. `make chat-feedback` lists the last 7 days of thumbs-down, newest first: time, outcome, question, the first 300 characters of the answer and its sources. `RATING=all DAYS=30 make chat-feedback` shows more. For `uncited` rows the answer shown is the model's raw text; the visitor saw the fixed reply. Counts over time: Grafana → "Portfolio overview" → "Chat feedback by rating (range)". The dashboard never shows question text. Ratings are deleted with their chat after 30 days; the daily counts in `chat_usage_daily` are kept 90 days.
```

`docs/security.md`, in the "Form spam and chat abuse" row, append this sentence to the end of the Controls cell (before the closing `|`):

```markdown
 Chat feedback works only from the session's own IP hash, gives the same 404 for any message the caller does not own, and has its own limit (20 per minute, 200 per day).
```

`docs/architecture.md`, in the Chat diagram code block, add one line after `                 └─ question ─> POST /v1/chat/sessions/{id}/messages` and its two `→` continuation lines (that is, as the last line inside the block):

```
                 └─ [y]/[n] ─> POST /v1/chat/sessions/{id}/messages/{message_id}/feedback → chat_messages.feedback
```

- [ ] **Step 9: Format, lint, type-check, full suite**

Run: `cd apps/api && uv run ruff format . && uv run ruff check --fix . && uv run pyright && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio uv run pytest -q`
Expected: clean, all tests pass.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/portfolio_api/repositories/chat.py apps/api/src/portfolio_api/cli.py apps/api/tests/test_cli.py Makefile docs/runbook.md docs/security.md docs/architecture.md
git commit -m "$(cat <<'EOF'
feat(api): chat-feedback command and make target; feedback docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Web `helpful? [y] [n]` (lib, terminal, e2e)

**Files:**
- Modify: `apps/web/src/lib/chat.ts`
- Modify: `apps/web/src/lib/chat.test.ts`
- Modify: `apps/web/src/components/chat/chat-terminal.tsx`
- Modify: `apps/web/src/components/chat/chat-terminal.test.tsx`
- Modify: `apps/web/e2e/fixtures/api/chat-message.json`
- Modify: `apps/web/e2e/fake-backend.mjs`
- Modify: `apps/web/e2e/journey.spec.ts` (test "chat: ask a question, get a cited answer")

**Interfaces:**
- Consumes (from Task 2): the `message_id` field in the answer JSON, and `POST .../messages/{message_id}/feedback` → 204.
- Produces:
  - `type ChatRating = "up" | "down"`.
  - `AskResult` answer variant gains `messageId: number`.
  - `sendFeedback(apiUrl: string, sessionId: string, messageId: number, rating: ChatRating): Promise<boolean>`, true only on 204.
  - `CHAT_MESSAGES.helpful` (`"helpful?"`), `CHAT_MESSAGES.feedbackSaved` (`"thanks: noted"`) and `CHAT_MESSAGES.feedbackFailed` (`"couldn't save feedback"`).

- [ ] **Step 1: Write the failing lib tests**

In `apps/web/src/lib/chat.test.ts`:

Change the import to:

```ts
import { CHAT_MESSAGES, askQuestion, createSession, failureFor, sendFeedback } from "./chat";
```

In `describe("askQuestion")`, give the `answer` fixture a `message_id`, and expect `messageId`:

```ts
  const answer = {
    message_id: 41,
    answer: "Yes [1].",
    sources: [{ n: 1, title: "ACM", url: "/projects/acm" }],
    outcome: "answered",
    questions_left: 9,
  };

  it("posts the question to the session and returns the answer", async () => {
    const fetchMock = respond(200, answer);
    await expect(askQuestion(API, "s-1", "FastAPI?")).resolves.toEqual({
      kind: "answer",
      messageId: 41,
      answer: "Yes [1].",
      sources: [{ n: 1, title: "ACM", url: "/projects/acm" }],
      outcome: "answered",
      questionsLeft: 9,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/v1/chat/sessions/s-1/messages`);
    expect(JSON.parse(init.body as string)).toEqual({ question: "FastAPI?" });
  });
```

Add after the `askQuestion` describe block:

```ts
describe("sendFeedback", () => {
  it("posts the rating to the answer's feedback URL", async () => {
    const fetchMock = respond(204);
    await expect(sendFeedback(API, "s-1", 41, "down")).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/v1/chat/sessions/s-1/messages/41/feedback`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ rating: "down" });
  });

  it.each([
    [404, "message_not_found"],
    [429, "rate_limited"],
    [503, "chat_disabled"],
  ])("returns false for %i %s", async (status, code) => {
    respond(status, { error: { code, message: "x" } });
    await expect(sendFeedback(API, "s-1", 41, "up")).resolves.toBe(false);
  });

  it("returns false when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(sendFeedback(API, "s-1", 41, "up")).resolves.toBe(false);
  });
});
```

Replace the exact-copy test with:

```ts
it("keeps the exact terminal copy", () => {
  expect(CHAT_MESSAGES).toEqual({
    welcome:
      "Ask anything about Chris's experience, projects, or skills. Answers come only from this site and may be wrong. Conversations are stored for 30 days.",
    thinking: "thinking…",
    budget: "Chat is resting until tomorrow. Try the contact page.",
    busy: "Busy right now. Try again in a minute.",
    sessionLimit: "That's the limit for this session. Press clear to start a new one.",
    ended: "This session has ended. Press clear to start a new one.",
    unavailable: "Chat is unavailable right now. Try the contact page.",
    tooLong: "Questions can be up to 500 characters.",
    helpful: "helpful?",
    feedbackSaved: "thanks: noted",
    feedbackFailed: "couldn't save feedback",
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && pnpm vitest run src/lib/chat.test.ts`
Expected: failures. `sendFeedback` is not exported (TypeError: sendFeedback is not a function), and the copy and `messageId` assertions fail.

- [ ] **Step 3: Implement the lib changes**

In `apps/web/src/lib/chat.ts`:

Add three entries to the end of `CHAT_MESSAGES`, after `tooLong`:

```ts
  tooLong: "Questions can be up to 500 characters.",
  helpful: "helpful?",
  feedbackSaved: "thanks: noted",
  feedbackFailed: "couldn't save feedback",
} as const;
```

Replace the types block from `export type ChatSource` through `AskResult` with:

```ts
export type ChatSource = { n: number; title: string; url: string };
export type ChatRating = "up" | "down";
export type ChatFailure = "budget" | "busy" | "sessionLimit" | "ended" | "unavailable";
export type SessionResult =
  | { kind: "ok"; sessionId: string; questionsLeft: number }
  | { kind: "error"; failure: ChatFailure };
export type AskResult =
  | {
      kind: "answer";
      messageId: number;
      answer: string;
      sources: ChatSource[];
      outcome: "answered" | "no_match" | "uncited";
      questionsLeft: number;
    }
  | { kind: "error"; failure: ChatFailure };
```

Replace `AnswerBody` with:

```ts
const AnswerBody = z.object({
  message_id: z.number(),
  answer: z.string(),
  sources: z.array(z.object({ n: z.number(), title: z.string(), url: z.string() })),
  outcome: z.enum(["answered", "no_match", "uncited"]),
  questions_left: z.number(),
});
```

In `askQuestion`, add `messageId: parsed.data.message_id,` right after `kind: "answer",`.

Append to the end of the file:

```ts
// One rating per reply; the API keeps the last one. A rating never uses up a question.
export async function sendFeedback(
  apiUrl: string,
  sessionId: string,
  messageId: number,
  rating: ChatRating,
): Promise<boolean> {
  const res = await post(
    `${apiUrl}/v1/chat/sessions/${encodeURIComponent(sessionId)}/messages/${messageId}/feedback`,
    { rating },
  );
  return res?.status === 204;
}
```

- [ ] **Step 4: Run the lib tests to verify they pass**

Run: `cd apps/web && pnpm vitest run src/lib/chat.test.ts`
Expected: all pass.

- [ ] **Step 5: Write the failing terminal tests**

In `apps/web/src/components/chat/chat-terminal.test.tsx`, give `ANSWER` a message id (without it every answer fails to parse):

```ts
const ANSWER = {
  message_id: 41,
  answer: "He built the ACM@AU API with FastAPI [1].",
  sources: [{ n: 1, title: "ACM@AU platform", url: "/projects/acm" }],
  outcome: "answered",
  questions_left: 9,
};
```

Add this block between the end of `describe("ChatTerminal", ...)` and `describe("ChatTerminal analytics", ...)`:

```tsx
describe("ChatTerminal feedback", () => {
  const NO_ANSWER = {
    message_id: 42,
    answer: "I don't have information on that. You can ask Chris directly on the contact page.",
    sources: [{ n: 1, title: "Contact", url: "/contact" }],
    outcome: "no_match",
    questions_left: 10,
  };
  const saved = () => Promise.resolve(new Response(null, { status: 204 }));
  const helpful = () => screen.getByRole("button", { name: "Mark answer helpful" });
  const notHelpful = () => screen.getByRole("button", { name: "Mark answer not helpful" });

  function feedbackResponds(response: () => Promise<Response>) {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("/v1/chat/sessions")
        ? json(201, SESSION)
        : url.endsWith("/feedback")
          ? response()
          : json(200, ANSWER),
    );
  }

  it("offers helpful? [y] [n] under an answer", async () => {
    await renderTerminal();
    await ask("FastAPI?");
    expect(screen.getByText(CHAT_MESSAGES.helpful, { exact: false })).toBeTruthy();
    expect(helpful().textContent).toBe("[y]");
    expect(notHelpful().textContent).toBe("[n]");
    expect(helpful().getAttribute("type")).toBe("button");
    expect(helpful().getAttribute("aria-pressed")).toBe("false");
    expect(notHelpful().getAttribute("aria-pressed")).toBe("false");
  });

  it("offers it under a canned no-answer reply too", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("/v1/chat/sessions") ? json(201, SESSION) : json(200, NO_ANSWER),
    );
    await renderTerminal();
    await ask("Write me a poem");
    expect(screen.getByRole("link", { name: "[1] Contact" })).toBeTruthy();
    expect(notHelpful()).toBeTruthy();
  });

  it("sends the rating, thanks the visitor, and locks both buttons", async () => {
    feedbackResponds(saved);
    await renderTerminal();
    await ask("FastAPI?");
    await act(async () => {
      fireEvent.click(notHelpful());
    });
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe(`${API}/v1/chat/sessions/s-1/messages/41/feedback`);
    expect(JSON.parse(init.body as string)).toEqual({ rating: "down" });
    expect(screen.getByText(CHAT_MESSAGES.feedbackSaved).getAttribute("role")).toBe("status");
    expect((helpful() as HTMLButtonElement).disabled).toBe(true);
    expect((notHelpful() as HTMLButtonElement).disabled).toBe(true);
    expect(notHelpful().getAttribute("aria-pressed")).toBe("true");
    expect(helpful().getAttribute("aria-pressed")).toBe("false");
  });

  it("says so and re-enables the buttons when the rating can't be saved", async () => {
    feedbackResponds(() => json(503, { error: { code: "chat_disabled", message: "x" } }));
    await renderTerminal();
    await ask("FastAPI?");
    await act(async () => {
      fireEvent.click(helpful());
    });
    expect(screen.getByText(CHAT_MESSAGES.feedbackFailed)).toBeTruthy();
    expect(screen.queryByText(CHAT_MESSAGES.feedbackSaved)).toBeNull();
    expect((helpful() as HTMLButtonElement).disabled).toBe(false);
    expect((notHelpful() as HTMLButtonElement).disabled).toBe(false);
    expect(helpful().getAttribute("aria-pressed")).toBe("false");
  });

  it("rating does not use up a question or block the next one", async () => {
    feedbackResponds(saved);
    await renderTerminal();
    await ask("FastAPI?");
    await act(async () => {
      fireEvent.click(helpful());
    });
    await ask("Postgres?");
    const asks = fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/messages"));
    expect(asks).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Mark answer helpful" })).toHaveLength(2);
    expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe("type a question…");
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `cd apps/web && pnpm vitest run src/components/chat/chat-terminal.test.tsx`
Expected: the five new tests fail with `Unable to find an accessible element with the role "button" and name "Mark answer helpful"` or similar. The existing tests still pass.

- [ ] **Step 7: Implement the terminal row**

In `apps/web/src/components/chat/chat-terminal.tsx`:

Change the `@/lib/chat` import to:

```tsx
import {
  CHAT_LIMITS,
  CHAT_MESSAGES,
  askQuestion,
  createSession,
  sendFeedback,
  type ChatRating,
  type ChatSource,
} from "@/lib/chat";
```

Replace the `Line` type with:

```tsx
type Line =
  | { id: number; kind: "question"; text: string }
  | {
      id: number;
      kind: "answer";
      text: string;
      sources: ChatSource[];
      animate: boolean;
      sessionId: string; // kept per line: a session that hit its limit can still rate its replies
      messageId: number;
    }
  | { id: number; kind: "notice"; text: string };
```

Add after the `useVisibleArea` function, before `export function ChatTerminal`:

```tsx
type FeedbackState = "idle" | "sending" | "saved" | "failed";

const feedbackButton =
  "rounded px-0.5 focus-visible:outline-2 focus-visible:outline-accent-brand disabled:cursor-default";

// helpful? [y] [n] under every reply, canned ones included. Each reply keeps its own state.
function AnswerFeedback({
  apiUrl,
  sessionId,
  messageId,
}: {
  apiUrl: string;
  sessionId: string;
  messageId: number;
}) {
  const [state, setState] = useState<FeedbackState>("idle");
  const [chosen, setChosen] = useState<ChatRating | null>(null);

  async function rate(rating: ChatRating) {
    setChosen(rating);
    setState("sending"); // both buttons wait, so a double click sends one rating
    setState((await sendFeedback(apiUrl, sessionId, messageId, rating)) ? "saved" : "failed");
  }

  function button(rating: ChatRating, key: string, label: string) {
    const pressed = state === "saved" && chosen === rating;
    const color =
      state !== "saved"
        ? "text-accent-brand hover:opacity-80"
        : pressed
          ? "text-foreground"
          : "text-muted-foreground";
    return (
      <button
        type="button"
        onClick={() => void rate(rating)}
        disabled={state === "sending" || state === "saved"}
        aria-label={label}
        aria-pressed={pressed}
        className={`${feedbackButton} ${color}`}
      >
        {`[${key}]`}
      </button>
    );
  }

  return (
    <p className="text-muted-foreground">
      {CHAT_MESSAGES.helpful} {button("up", "y", "Mark answer helpful")}{" "}
      {button("down", "n", "Mark answer not helpful")}{" "}
      {/* Always rendered, so a change of text is announced. */}
      <span role="status" className="ml-2">
        {state === "saved"
          ? CHAT_MESSAGES.feedbackSaved
          : state === "failed"
            ? CHAT_MESSAGES.feedbackFailed
            : ""}
      </span>
    </p>
  );
}
```

In `ask`, change the answer `push` to:

```tsx
      push({
        kind: "answer",
        text: result.answer,
        sources: result.sources,
        animate: !reducedMotion(),
        sessionId: session.id,
        messageId: result.messageId,
      });
```

In the render, add the row as the last child of the answer `<div key={line.id}>`, right after the sources `</p>`:

```tsx
                <AnswerFeedback
                  apiUrl={apiUrl}
                  sessionId={line.sessionId}
                  messageId={line.messageId}
                />
```

- [ ] **Step 8: Run the web unit tests, types and lint**

Run: `cd apps/web && pnpm exec prettier --write src/lib/chat.ts src/lib/chat.test.ts src/components/chat/chat-terminal.tsx src/components/chat/chat-terminal.test.tsx && pnpm vitest run && pnpm exec tsc --noEmit && pnpm lint`
Expected: every vitest file passes, tsc prints nothing, and eslint reports no problems.

- [ ] **Step 9: Teach the e2e fake backend the new contract**

Replace `apps/web/e2e/fixtures/api/chat-message.json` with:

```json
{
  "message_id": 1,
  "answer": "Chris built this site with Next.js and FastAPI [1].",
  "sources": [
    {
      "n": 1,
      "title": "This portfolio",
      "url": "/projects/this-portfolio"
    }
  ],
  "outcome": "answered",
  "questions_left": 9
}
```

In `apps/web/e2e/fake-backend.mjs`, add a case right after the `POST /v1/chat/sessions/s1/messages` case:

```js
    case "POST /v1/chat/sessions/s1/messages/1/feedback":
      res.writeHead(204, { "Access-Control-Allow-Origin": ORIGIN });
      return res.end();
```

- [ ] **Step 10: Add the journey step**

In `apps/web/e2e/journey.spec.ts`, test "chat: ask a question, get a cited answer", insert after the `toHaveAttribute("href", "/projects/this-portfolio")` assertion and before `await page.keyboard.press("Escape");`:

```ts
  const notHelpful = terminal.getByRole("button", { name: "Mark answer not helpful" });
  await notHelpful.click();
  await expect(terminal.getByRole("status").filter({ hasText: "thanks: noted" })).toBeVisible();
  await expect(notHelpful).toHaveAttribute("aria-pressed", "true");
  await expect(notHelpful).toBeDisabled();
  await expectNoAxeViolations(page);
```

- [ ] **Step 11: Build and run the e2e suite**

Run:
```bash
cd apps/web && pkill -f next-server; pkill -f "e2e/fake-backend.mjs"; pnpm exec prettier --write e2e/fake-backend.mjs e2e/journey.spec.ts e2e/fixtures/api/chat-message.json && NEXT_TELEMETRY_DISABLED=1 pnpm build && NEXT_TELEMETRY_DISABLED=1 pnpm exec playwright test
```
Expected:
- The build succeeds.
- Every Playwright test passes on both projects, including the chat journey (mobile and desktop) and `budget.spec.ts`.
- There are no console errors and no axe violations. The `gates` fixture fails a test on either.

If `budget.spec.ts` fails, don't edit `e2e/budgets.json`. Run `BUDGET_PRINT_ONLY=1 pnpm exec playwright test e2e/budget.spec.ts --project=mobile`, and put the measured numbers in the report.

- [ ] **Step 12: Full final checks (both apps)**

Run (web, from `apps/web`): `pnpm vitest run && pnpm exec tsc --noEmit && pnpm lint && pnpm exec prettier --check .`
Expected: all clean.

Run (api, from `apps/api`):
```bash
uv run ruff check . && uv run ruff format --check . && uv run pyright && export U=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio && API_DATABASE_URL=$U uv run alembic upgrade head && API_DATABASE_URL=$U uv run alembic check && API_DATABASE_URL=$U uv run alembic downgrade -1 && API_DATABASE_URL=$U uv run alembic upgrade head && API_DATABASE_URL=$U uv run pytest -q
```
Expected: all clean. `alembic check` prints `No new upgrade operations detected.`, and every test passes.

Finally, from the repo root, `git status --short` shows only this task's files as modified. `git diff --stat main...HEAD` (after the commit below) lists only files named in this plan.

- [ ] **Step 13: Commit**

```bash
git add apps/web/src/lib/chat.ts apps/web/src/lib/chat.test.ts apps/web/src/components/chat/chat-terminal.tsx apps/web/src/components/chat/chat-terminal.test.tsx apps/web/e2e/fixtures/api/chat-message.json apps/web/e2e/fake-backend.mjs apps/web/e2e/journey.spec.ts
git commit -m "$(cat <<'EOF'
feat(web): helpful? [y] [n] under every chat reply

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## After merge (Chris, on the live site; from the spec's Verification)

1. Ask the chat a question, then click `[n]`. `thanks: noted` appears.
2. On the VM, `make chat-feedback` lists it.
3. Grafana → Portfolio overview → "Chat feedback by rating (range)" counts it. Prometheus scrapes every 30 s.
