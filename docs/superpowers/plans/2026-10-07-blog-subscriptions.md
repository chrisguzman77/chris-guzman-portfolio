# Blog Subscriptions (Newsletter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visitors subscribe by email with double opt-in. Chris emails a published post to confirmed subscribers from a Directus button. Counts appear in Grafana, and a private `/admin/subscribers` page lists and removes subscribers.

**Architecture:**
- **API:** FastAPI owns three new tables in the `portfolio` database. It exposes public subscribe, confirm and unsubscribe endpoints and internal send, list and delete endpoints, and sends mail with the existing Resend client (plus Resend's batch endpoint).
- **Web:** Next.js adds a lazy-Turnstile `SubscribeForm` on `/blog` and `/`, two client-posting pages (`/newsletter/confirm`, `/newsletter/unsubscribe`), and an admin page that verifies the Cloudflare Access JWT with `jose`.
- **Directus and monitoring:** Directus gets two read-only post fields and a manual Flow. Grafana gets a Newsletter dashboard, a read-only Umami data source and one alert.

**Tech Stack:** FastAPI, SQLAlchemy 2 (async), Alembic, pytest (via `uv`); Next.js 16.3, React 19.3, zod, `jose`, vitest, Playwright; Directus 12 bootstrap (`node:test`); Postgres 17, Grafana 13, bash.

**Spec:** `docs/superpowers/specs/2026-10-07-blog-subscriptions-design.md` is binding, with the three deviations listed below (approved by the controller and reported to Chris).

**Deviations from the spec (decided while planning):**
1. **Read-only Grafana role.** A fresh database has no `website_event` table until Umami starts and migrates, so a plain init-time `GRANT` would fail. One idempotent script, `infra/postgres/init/02-grafana-umami-ro.sh`, runs as an init script and again on every deploy. It grants `SELECT` only once the table exists.
2. **`emailed_at` / `emailed_count` visibility.** The web-reader and api-reader policies keep `fields: ["*"]` on `posts`. Hiding two fields would mean hand-maintaining an explicit field list for every future post field. The website never renders them, and both tokens are server-side only.
3. **Confirm is idempotent.** The confirm token hash is kept after confirmation, so clicking the link twice still shows "You're subscribed." instead of "expired".

## Global Constraints

- **Copy (exact strings):**
  - Box heading `Subscribe`, button `Subscribe`, note `No spam. Unsubscribe anytime.`
  - Subscribe success `Check your inbox to confirm.`
  - Confirm success `You're subscribed. You'll get an email when there's a new post.`
  - Confirm failure `This link has expired. Subscribe again from the blog.`, where "the blog" links to `/blog`.
  - Unsubscribe success `You're unsubscribed.`
  - Confirmation email subject `Confirm your subscription to Christopher Guzman's blog`, button `Confirm subscription`.
  - Post email footer `You're getting this because you subscribed at christopherguzman.me · Unsubscribe`. Post email button `Read the post`.
- **Sender:** setting `newsletter_from`, default `Christopher Guzman <posts@christopherguzman.me>`.
- **Links:**
  - Confirm `https://christopherguzman.me/newsletter/confirm?token=…`
  - Footer unsubscribe `https://christopherguzman.me/newsletter/unsubscribe?token=…`
  - `List-Unsubscribe: <https://api.christopherguzman.me/v1/newsletter/unsubscribe?token=…>` with `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
  - Post link `https://christopherguzman.me/blog/<slug>?utm_source=newsletter&utm_medium=email&utm_campaign=<slug>`
- **Tokens:**
  - The confirm token is `secrets.token_urlsafe(32)`. Only its sha256 hex is stored. It expires 7 days after `confirm_sent_at`.
  - The unsubscribe token is `<uuid>.<base64url(HMAC-SHA256(key, "unsub:" + uuid)) without padding>`.
  - The key is `HMAC-SHA256(INTERNAL_API_SECRET, "newsletter-unsubscribe-v1")`.
- **Limits:**
  - Subscribe is limited to 5/min and 20/day per `client_key` (IPv6 /64), with at most one confirmation email per address per hour.
  - Pending rows are purged 7 days after `confirm_sent_at`.
  - Resend batches hold at most 100 messages.
- **Enabling:** the newsletter service exists only when `resend_api_key`, `turnstile_secret` and `internal_secret` are all set. Otherwise every newsletter endpoint returns 503 `newsletter_unavailable`.
- **Responses:**
  - Public endpoints are JSON-only (unsubscribe also takes the RFC 8058 query-string form) and use the standard `{"error": {"code", "message"}}` body.
  - Subscribe always returns 202 `{"status": "check_inbox"}` once it passes the rate limit, Turnstile and validation.
- **No tracking:** no open pixels, no click rewriting, no email address sent to Umami.
- **Optional secrets:** `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` and `GRAFANA_UMAMI_DB_PASSWORD` are optional (`${VAR:-}` in compose, listed under "Optional in prod.enc.env"). While they are unset, the admin page is 404 and the visits panel shows a data source error. Nothing else is affected.
- **Phase 3 web rules still bind:**
  - no emojis
  - Lucide icons
  - semantic Tailwind tokens only (no raw hex in components)
  - inputs `text-base md:text-sm` (no iOS zoom)
  - `pnpm build` passes with no env vars set
  - client code imports zod from `@/lib/zod-client`, server code from `zod`
- **CSP:** unchanged. Turnstile is already allowed, and server actions post to `'self'`.
- **Before the final checks of a task:**
  - API: `uv run ruff format . && uv run ruff check --fix .`, then `uv run pyright`.
  - Web: `pnpm --dir apps/web lint`, `typecheck` and `format` (`format:write` on your files if needed).
- **Secrets and tooling:**
  - Never read or write `.env*`.
  - Never run sops or `make secrets-*`.
  - Python only via `uv` (`uv run`, `uv add`).
- **Commits:** on branch `feat/newsletter`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Command timeouts:** every long command (test suites, builds, docker) runs with an explicit timeout.
- **DB tests:** need `API_DATABASE_URL` pointing at the migrated dev Postgres (`make up`, then `make migrate`; see `apps/api/README.md`).

## File map

| File | Responsibility | Task |
|---|---|---|
| `apps/api/src/portfolio_api/models/newsletter.py` | ORM: subscribers, sends, deliveries | 1 |
| `apps/api/alembic/versions/b7c3e9a2d514_newsletter.py` | Migration | 1 |
| `apps/api/src/portfolio_api/newsletter_tokens.py` | Confirm-token hashing, unsubscribe HMAC tokens | 1 |
| `apps/api/src/portfolio_api/repositories/newsletter.py` | All newsletter SQL | 1 |
| `apps/api/src/portfolio_api/clients/email.py` | `OutgoingEmail` gains html/headers; `send_batch` | 2 |
| `apps/api/src/portfolio_api/services/newsletter_email.py` | Confirmation and post email builders | 2 |
| `apps/api/src/portfolio_api/json_body.py` | Shared JSON-only body parser (moved from contact) | 3 |
| `apps/api/src/portfolio_api/schemas/newsletter.py` | Request/response models | 3, 4 |
| `apps/api/src/portfolio_api/services/newsletter.py` | `NewsletterService` | 3, 4 |
| `apps/api/src/portfolio_api/routers/newsletter.py` | Public endpoints | 3 |
| `apps/api/src/portfolio_api/routers/internal.py` | Internal send/list/delete | 4 |
| `apps/api/src/portfolio_api/clients/directus.py` | `fetch_post` | 4 |
| `apps/web/src/lib/newsletter.ts` | Client calls + copy | 5 |
| `apps/web/src/components/newsletter/subscribe-form.tsx` | The box | 5 |
| `apps/web/src/components/newsletter/newsletter-action.tsx` | Confirm/unsubscribe client logic | 6 |
| `apps/web/src/app/newsletter/{confirm,unsubscribe}/page.tsx` | Pages | 6 |
| `apps/web/src/lib/cf-access.ts`, `src/lib/subscribers.ts` | Access JWT check, internal API calls | 7 |
| `apps/web/src/app/admin/subscribers/{page.tsx,actions.ts}` | Admin page | 7 |
| `infra/directus/{schema.mjs,lib.mjs,bootstrap.mjs,lib.test.mjs}` | Post fields + manual Flow | 8 |
| `infra/postgres/init/02-grafana-umami-ro.sh`, `scripts/deploy.sh` | Read-only role | 9 |
| `infra/observability/grafana/...` | Data source, dashboard, alert | 9 |
| `infra/compose/{compose.yaml,prod.env.example}`, `.github/workflows/ci.yml` | Wiring + CI guard | 9 |
| `docs/{runbook,setup,security}.md` | Docs | 9 |

Tasks run sequentially on `feat/newsletter`. Task 10 is the controller's dev-stack verification.

---

### Task 1: API data layer (tables, tokens, repository)

**Files:**
- Create: `apps/api/src/portfolio_api/models/newsletter.py`, `apps/api/alembic/versions/b7c3e9a2d514_newsletter.py`, `apps/api/src/portfolio_api/newsletter_tokens.py`, `apps/api/src/portfolio_api/repositories/newsletter.py`
- Modify: `apps/api/src/portfolio_api/models/__init__.py`, `apps/api/tests/conftest.py` (truncate list)
- Test: `apps/api/tests/test_newsletter_tokens.py`, `apps/api/tests/test_newsletter_repo.py`

**Interfaces:**
- Produces:
  - `SubscriberStatus` (StrEnum `pending`/`confirmed`), plus the models `NewsletterSubscriber`, `NewsletterSend` and `NewsletterDelivery`.
  - `newsletter_tokens`: `new_confirm_token() -> tuple[str, str]` (token, hash), `hash_token(str) -> str`, `unsubscribe_key(secret: str) -> bytes`, `unsubscribe_token(key, uuid) -> str` and `read_unsubscribe_token(key, token) -> uuid.UUID | None`.
  - `repositories.newsletter`: `ConfirmResult` and the functions `claim_confirmation`, `confirm`, `delete`, `purge_pending`, `counts`, `list_all`, `get_send`, `start_send`, `undelivered`, `count_undelivered`, `record_deliveries` and `complete_send`, with the exact signatures below.

- [ ] **Step 1: Write the token tests** (`apps/api/tests/test_newsletter_tokens.py`)

```python
import hashlib
import uuid

from portfolio_api.newsletter_tokens import (
    hash_token,
    new_confirm_token,
    read_unsubscribe_token,
    unsubscribe_key,
    unsubscribe_token,
)

KEY = unsubscribe_key("s3cret")
SUB = uuid.UUID("0b6f1c1e-0000-4000-8000-000000000001")


def test_confirm_token_is_random_and_only_its_sha256_is_kept() -> None:
    token, digest = new_confirm_token()
    assert len(token) >= 43 and token != new_confirm_token()[0]
    assert digest == hashlib.sha256(token.encode()).hexdigest() == hash_token(token)


def test_unsubscribe_token_round_trips() -> None:
    token = unsubscribe_token(KEY, SUB)
    assert token.startswith(f"{SUB}.") and "=" not in token
    assert read_unsubscribe_token(KEY, token) == SUB


def test_key_is_derived_with_a_label() -> None:
    assert len(KEY) == 32 and KEY != unsubscribe_key("other")
    assert KEY != hashlib.sha256(b"s3cret").digest()


def test_forged_malformed_and_other_key_tokens_are_rejected() -> None:
    good = unsubscribe_token(KEY, SUB)
    other = uuid.UUID(int=7)
    forged = f"{other}.{good.split('.', 1)[1]}"
    for token in (
        "",
        "nope",
        forged,
        good + "x",
        good.upper(),
        unsubscribe_token(unsubscribe_key("other"), SUB),
        f"{SUB.hex}.{good.split('.', 1)[1]}",  # non-canonical uuid form
        "é." + good.split(".", 1)[1],
    ):
        assert read_unsubscribe_token(KEY, token) is None, token
```

- [ ] **Step 2: Run, expect ImportError.** `cd apps/api && uv run pytest tests/test_newsletter_tokens.py -q` → fails (module missing).

- [ ] **Step 3: Implement `apps/api/src/portfolio_api/newsletter_tokens.py`**

```python
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
```

- [ ] **Step 4: Run the token tests**. Expected: 4 passed.

- [ ] **Step 5: Models** (`apps/api/src/portfolio_api/models/newsletter.py`)

```python
import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from portfolio_api.models import Base


class SubscriberStatus(enum.StrEnum):
    pending = "pending"
    confirmed = "confirmed"


def _enum_values(e: type[SubscriberStatus]) -> list[str]:
    return [m.value for m in e]


class NewsletterSubscriber(Base):
    """An email address that asked for new-post emails; deleted on unsubscribe."""

    __tablename__ = "newsletter_subscribers"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(254), unique=True)  # lowercased and trimmed
    status: Mapped[SubscriberStatus] = mapped_column(
        Enum(SubscriberStatus, name="subscriber_status", values_callable=_enum_values),
        server_default=SubscriberStatus.pending.value,
    )
    confirm_token_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    confirm_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NewsletterSend(Base):
    """One post's send. completed_at is set once every confirmed subscriber has it."""

    __tablename__ = "newsletter_sends"

    post_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    recipients: Mapped[int | None] = mapped_column(Integer)


class NewsletterDelivery(Base):
    """A post accepted by Resend for one subscriber; the key makes a resumed send skip them."""

    __tablename__ = "newsletter_deliveries"

    post_id: Mapped[int] = mapped_column(
        ForeignKey("newsletter_sends.post_id", ondelete="CASCADE"), primary_key=True
    )
    subscriber_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("newsletter_subscribers.id", ondelete="CASCADE"), primary_key=True
    )
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

In `models/__init__.py`, add `from portfolio_api.models.newsletter import (NewsletterDelivery, NewsletterSend, NewsletterSubscriber, SubscriberStatus)  # noqa: E402` (sorted between `github` and `rag`), and add the four names to `__all__` (kept sorted).

- [ ] **Step 6: Migration** (`apps/api/alembic/versions/b7c3e9a2d514_newsletter.py`)

```python
"""newsletter subscribers, sends and deliveries

Revision ID: b7c3e9a2d514
Revises: 8d41f0c2b7e3
Create Date: 2026-10-07 20:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7c3e9a2d514"
down_revision: str | Sequence[str] | None = "8d41f0c2b7e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SUBSCRIBER_STATUS = postgresql.ENUM(
    "pending", "confirmed", name="subscriber_status", create_type=False
)


def upgrade() -> None:
    """Upgrade schema."""
    postgresql.ENUM("pending", "confirmed", name="subscriber_status").create(op.get_bind())
    op.create_table(
        "newsletter_subscribers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("status", SUBSCRIBER_STATUS, server_default="pending", nullable=False),
        sa.Column("confirm_token_hash", sa.String(length=64), nullable=True),
        sa.Column("confirm_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("confirm_token_hash"),
        sa.UniqueConstraint("email"),
    )
    op.create_table(
        "newsletter_sends",
        sa.Column("post_id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column(
            "started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recipients", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("post_id"),
    )
    op.create_table(
        "newsletter_deliveries",
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("subscriber_id", sa.Uuid(), nullable=False),
        sa.Column(
            "sent_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["post_id"], ["newsletter_sends.post_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["subscriber_id"], ["newsletter_subscribers.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("post_id", "subscriber_id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("newsletter_deliveries")
    op.drop_table("newsletter_sends")
    op.drop_table("newsletter_subscribers")
    SUBSCRIBER_STATUS.drop(op.get_bind())
```

Run `cd apps/api && uv run alembic upgrade head && uv run alembic check` against the dev DB (`API_DATABASE_URL` set). Expected: `No new upgrade operations detected.` If `alembic check` reports a difference, change the migration to match the models (the models are the authority) and re-run. Also run `uv run alembic downgrade -1 && uv run alembic upgrade head` once to prove the downgrade works.

In `tests/conftest.py`, append `newsletter_deliveries, newsletter_sends, newsletter_subscribers` to the `TRUNCATE` list (the string becomes `"... chat_usage_daily, newsletter_deliveries, newsletter_sends, newsletter_subscribers"`).

- [ ] **Step 7: Write the repository tests** (`apps/api/tests/test_newsletter_repo.py`)

```python
from datetime import timedelta

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.models import NewsletterSend, NewsletterSubscriber, SubscriberStatus
from portfolio_api.repositories import newsletter as repo
from portfolio_api.repositories.newsletter import ConfirmResult

Sessions = async_sessionmaker[AsyncSession]


async def subscriber(db: Sessions, email: str) -> NewsletterSubscriber:
    async with db() as s:
        return (
            await s.scalars(select(NewsletterSubscriber).where(NewsletterSubscriber.email == email))
        ).one()


async def age(db: Sessions, email: str, hours: float) -> None:
    async with db.begin() as s:
        await s.execute(
            update(NewsletterSubscriber)
            .where(NewsletterSubscriber.email == email)
            .values(confirm_sent_at=func.now() - timedelta(hours=hours))
        )


async def add_confirmed(db: Sessions, *emails: str) -> None:
    for i, email in enumerate(emails):
        async with db.begin() as s:
            assert await repo.claim_confirmation(s, email, f"h{i}{email}")
            assert await repo.confirm(s, f"h{i}{email}") == ConfirmResult.confirmed


async def test_claim_new_pending_recent_pending_old_and_confirmed(db: Sessions) -> None:
    async with db.begin() as s:
        assert await repo.claim_confirmation(s, "a@example.com", "h1") is True
    async with db.begin() as s:  # within the hour: no second email
        assert await repo.claim_confirmation(s, "a@example.com", "h2") is False
    assert (await subscriber(db, "a@example.com")).confirm_token_hash == "h1"
    await age(db, "a@example.com", 2)
    async with db.begin() as s:  # over an hour: a fresh token replaces the old one
        assert await repo.claim_confirmation(s, "a@example.com", "h3") is True
    assert (await subscriber(db, "a@example.com")).confirm_token_hash == "h3"
    async with db.begin() as s:
        assert await repo.confirm(s, "h3") == ConfirmResult.confirmed
    await age(db, "a@example.com", 2)
    async with db.begin() as s:  # confirmed: never emailed again
        assert await repo.claim_confirmation(s, "a@example.com", "h4") is False


async def test_confirm_is_idempotent_and_expires_after_seven_days(db: Sessions) -> None:
    async with db.begin() as s:
        await repo.claim_confirmation(s, "b@example.com", "hb")
    async with db.begin() as s:
        assert await repo.confirm(s, "unknown") == ConfirmResult.invalid
    async with db.begin() as s:
        assert await repo.confirm(s, "hb") == ConfirmResult.confirmed
    row = await subscriber(db, "b@example.com")
    assert row.status == SubscriberStatus.confirmed and row.confirmed_at is not None
    async with db.begin() as s:
        assert await repo.confirm(s, "hb") == ConfirmResult.already_confirmed
    async with db.begin() as s:
        await repo.claim_confirmation(s, "c@example.com", "hc")
    await age(db, "c@example.com", 24 * 7 + 1)
    async with db.begin() as s:
        assert await repo.confirm(s, "hc") == ConfirmResult.invalid


async def test_purge_deletes_only_stale_pending_rows(db: Sessions) -> None:
    await add_confirmed(db, "keep@example.com")
    async with db.begin() as s:
        await repo.claim_confirmation(s, "fresh@example.com", "hf")
        await repo.claim_confirmation(s, "stale@example.com", "hs")
    await age(db, "stale@example.com", 24 * 7 + 1)
    await age(db, "keep@example.com", 24 * 30)
    async with db.begin() as s:
        assert await repo.purge_pending(s) == 1
    async with db() as s:
        assert await repo.counts(s) == {
            SubscriberStatus.pending: 1,
            SubscriberStatus.confirmed: 1,
        }
        assert [r.email for r in await repo.list_all(s)] == ["fresh@example.com", "keep@example.com"]


async def test_delete_reports_whether_a_row_went(db: Sessions) -> None:
    await add_confirmed(db, "d@example.com")
    row = await subscriber(db, "d@example.com")
    async with db.begin() as s:
        assert await repo.delete(s, row.id) is True
    async with db.begin() as s:
        assert await repo.delete(s, row.id) is False


async def test_send_bookkeeping(db: Sessions) -> None:
    await add_confirmed(db, "1@example.com", "2@example.com", "3@example.com")
    async with db.begin() as s:
        await repo.claim_confirmation(s, "pending@example.com", "hp")
    async with db.begin() as s:
        await repo.start_send(s, 42)
        await repo.start_send(s, 42)  # idempotent
    async with db() as s:
        assert (await repo.get_send(s, 42)) is not None and await repo.get_send(s, 7) is None
        first = await repo.undelivered(s, 42, limit=2)
        assert len(first) == 2 and await repo.count_undelivered(s, 42) == 3
    async with db.begin() as s:
        await repo.record_deliveries(s, 42, [r.id for r in first])
        await repo.record_deliveries(s, 42, [first[0].id])  # duplicate is ignored
    async with db() as s:
        rest = await repo.undelivered(s, 42, limit=100)
        assert len(rest) == 1 and rest[0].id not in {r.id for r in first}
        assert await repo.count_undelivered(s, 42) == 1
    async with db.begin() as s:
        await repo.record_deliveries(s, 42, [rest[0].id])
        done = await repo.complete_send(s, 42)
    assert isinstance(done, NewsletterSend)
    assert done.completed_at is not None and done.recipients == 3
```

The ordering `["fresh@example.com", "keep@example.com"]` relies on `list_all` ordering by `created_at DESC`. `fresh` was created after `keep` in this test.

- [ ] **Step 8: Run, expect ImportError** for `repositories.newsletter`.

- [ ] **Step 9: Implement `apps/api/src/portfolio_api/repositories/newsletter.py`**

```python
import enum
import uuid
from collections.abc import Sequence
from datetime import timedelta

from sqlalchemy import delete as sql_delete
from sqlalchemy import func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from portfolio_api.models import (
    NewsletterDelivery,
    NewsletterSend,
    NewsletterSubscriber,
    SubscriberStatus,
)

CONFIRM_TTL = timedelta(days=7)
RESEND_AFTER = timedelta(hours=1)

Sub = NewsletterSubscriber


class ConfirmResult(enum.Enum):
    invalid = "invalid"
    confirmed = "confirmed"
    already_confirmed = "already_confirmed"


async def claim_confirmation(session: AsyncSession, email: str, token_hash: str) -> bool:
    """True when a confirmation email should go out to ``email`` with this token.

    A new address becomes pending. A pending address whose last email is over an hour old
    gets this new token. A confirmed address, or one emailed within the hour, is untouched.
    One statement, so two concurrent requests cannot both send.
    """
    stmt = (
        insert(Sub)
        .values(email=email, confirm_token_hash=token_hash, confirm_sent_at=func.now())
        .on_conflict_do_update(
            index_elements=[Sub.email],
            set_={"confirm_token_hash": token_hash, "confirm_sent_at": func.now()},
            where=(Sub.status == SubscriberStatus.pending)
            & (Sub.confirm_sent_at <= func.now() - RESEND_AFTER),
        )
        .returning(Sub.id)
    )
    return (await session.execute(stmt)).first() is not None


async def confirm(session: AsyncSession, token_hash: str) -> ConfirmResult:
    """Confirm the subscriber holding this token. The hash is kept, so a second click is fine."""
    row = await session.scalar(
        select(Sub)
        .where(
            Sub.confirm_token_hash == token_hash,
            or_(
                Sub.status == SubscriberStatus.confirmed,
                Sub.confirm_sent_at > func.now() - CONFIRM_TTL,
            ),
        )
        .with_for_update()
    )
    if row is None:
        return ConfirmResult.invalid
    if row.status == SubscriberStatus.confirmed:
        return ConfirmResult.already_confirmed
    await session.execute(
        update(Sub)
        .where(Sub.id == row.id)
        .values(status=SubscriberStatus.confirmed, confirmed_at=func.now())
    )
    return ConfirmResult.confirmed


async def delete(session: AsyncSession, subscriber_id: uuid.UUID) -> bool:
    result = await session.execute(sql_delete(Sub).where(Sub.id == subscriber_id).returning(Sub.id))
    return result.first() is not None


async def purge_pending(session: AsyncSession) -> int:
    """Delete pending sign-ups whose confirmation email is over 7 days old."""
    result = await session.execute(
        sql_delete(Sub)
        .where(
            Sub.status == SubscriberStatus.pending,
            Sub.confirm_sent_at <= func.now() - CONFIRM_TTL,
        )
        .returning(Sub.id)
    )
    return len(result.all())


async def counts(session: AsyncSession) -> dict[SubscriberStatus, int]:
    rows = await session.execute(select(Sub.status, func.count()).group_by(Sub.status))
    found: dict[SubscriberStatus, int] = {status: n for status, n in rows.tuples()}
    return {status: found.get(status, 0) for status in SubscriberStatus}


async def list_all(session: AsyncSession) -> list[NewsletterSubscriber]:
    return list((await session.scalars(select(Sub).order_by(Sub.created_at.desc()))).all())


async def get_send(session: AsyncSession, post_id: int) -> NewsletterSend | None:
    return await session.get(NewsletterSend, post_id)


async def start_send(session: AsyncSession, post_id: int) -> None:
    await session.execute(insert(NewsletterSend).values(post_id=post_id).on_conflict_do_nothing())


def _undelivered(post_id: int):  # noqa: ANN202 - a SQLAlchemy where-clause
    delivered = select(NewsletterDelivery.subscriber_id).where(
        NewsletterDelivery.post_id == post_id
    )
    return (Sub.status == SubscriberStatus.confirmed) & Sub.id.not_in(delivered)


async def undelivered(session: AsyncSession, post_id: int, *, limit: int) -> list[Sub]:
    """Confirmed subscribers this post has not reached yet, in a stable order."""
    stmt = select(Sub).where(_undelivered(post_id)).order_by(Sub.id).limit(limit)
    return list((await session.scalars(stmt)).all())


async def count_undelivered(session: AsyncSession, post_id: int) -> int:
    return (await session.scalar(select(func.count()).where(_undelivered(post_id)))) or 0


async def record_deliveries(
    session: AsyncSession, post_id: int, subscriber_ids: Sequence[uuid.UUID]
) -> None:
    if not subscriber_ids:
        return
    await session.execute(
        insert(NewsletterDelivery)
        .values([{"post_id": post_id, "subscriber_id": sid} for sid in subscriber_ids])
        .on_conflict_do_nothing()
    )


async def complete_send(session: AsyncSession, post_id: int) -> NewsletterSend:
    delivered = (
        select(func.count())
        .where(NewsletterDelivery.post_id == post_id)
        .scalar_subquery()
    )
    result = await session.execute(
        update(NewsletterSend)
        .where(NewsletterSend.post_id == post_id)
        .values(completed_at=func.now(), recipients=delivered)
        .returning(NewsletterSend)
    )
    return result.scalar_one()
```

If pyright flags the `_undelivered` return type, annotate it as `ColumnElement[bool]` (`from sqlalchemy import ColumnElement`) and drop the `noqa`.

- [ ] **Step 10: Run** `cd apps/api && uv run pytest tests/test_newsletter_tokens.py tests/test_newsletter_repo.py -q` (timeout 120 s). Expected: all pass. Then run the whole suite `uv run pytest -q` (timeout 600 s) to confirm the truncate change broke nothing. Then ruff and pyright.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/portfolio_api/models apps/api/alembic/versions/b7c3e9a2d514_newsletter.py apps/api/src/portfolio_api/newsletter_tokens.py apps/api/src/portfolio_api/repositories/newsletter.py apps/api/tests/conftest.py apps/api/tests/test_newsletter_tokens.py apps/api/tests/test_newsletter_repo.py
git commit -m "feat(api): newsletter tables, link tokens and repository"
```

---

### Task 2: Email client batch support and newsletter email builders

**Files:**
- Modify: `apps/api/src/portfolio_api/clients/email.py`, `apps/api/tests/fakes.py`
- Create: `apps/api/src/portfolio_api/services/newsletter_email.py`
- Test: `apps/api/tests/test_contact_clients.py` (add tests), `apps/api/tests/test_newsletter_email.py`

**Interfaces:**
- Produces:
  - `OutgoingEmail(sender, to, subject, text, idempotency_key, reply_to=None, html=None, headers=None)`. Existing callers use keywords, so they are unaffected.
  - `BatchEmailSender` Protocol (`send`, `send_batch(emails, idempotency_key)`), and `ResendSender.send_batch`.
  - `newsletter_email`: `post_url(site_url, slug) -> str`, `confirm_email(*, sender, to, confirm_url, idempotency_key) -> OutgoingEmail` and `post_email(*, sender, to, title, excerpt, post_url, unsubscribe_page_url, unsubscribe_api_url, idempotency_key) -> OutgoingEmail`.
  - In `tests/fakes.py`: `FakeBatchSender` (with `batches`, `sent` and `fail_batches: set[int]`).

- [ ] **Step 1: Client tests.** Append to `apps/api/tests/test_contact_clients.py`:

```python
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
        OutgoingEmail(sender="S <s@x.me>", to=f"{n}@example.com", subject="T", text="t", idempotency_key="")
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
```

(`pytest`, `json`, `EmailSendError` and `client` are already imported or defined in that file. Add any import that is missing.)

- [ ] **Step 2: Run, expect failures** (`send_batch` and the `html` field are missing).

- [ ] **Step 3: Implement in `apps/api/src/portfolio_api/clients/email.py`**

```python
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

RESEND_URL = "https://api.resend.com/emails"
RESEND_BATCH_URL = "https://api.resend.com/emails/batch"


@dataclass(frozen=True)
class OutgoingEmail:
    sender: str
    to: str
    subject: str
    text: str
    # Resend drops a repeat with the same key, so a retry after a lost DB write is not resent.
    idempotency_key: str
    reply_to: str | None = None
    html: str | None = None
    headers: dict[str, str] | None = None


class EmailSendError(Exception):
    """The email was not accepted. The message never contains the API key."""


class EmailSender(Protocol):
    async def send(self, email: OutgoingEmail) -> None: ...


class BatchEmailSender(EmailSender, Protocol):
    async def send_batch(self, emails: Sequence[OutgoingEmail], idempotency_key: str) -> None: ...


def _payload(email: OutgoingEmail) -> dict[str, Any]:
    body: dict[str, Any] = {
        "from": email.sender,
        "to": [email.to],
        "subject": email.subject,
        "text": email.text,
    }
    if email.reply_to is not None:
        body["reply_to"] = email.reply_to
    if email.html is not None:
        body["html"] = email.html
    if email.headers:
        body["headers"] = email.headers
    return body


class ResendSender:
    def __init__(self, http: httpx.AsyncClient, api_key: str) -> None:
        self._http = http
        self._api_key = api_key

    async def _post(self, url: str, key: str, body: object, timeout: float) -> None:
        try:
            res = await self._http.post(
                url,
                headers={"Authorization": f"Bearer {self._api_key}", "Idempotency-Key": key},
                json=body,
                timeout=timeout,
            )
        except httpx.HTTPError as exc:
            raise EmailSendError(f"resend request failed: {type(exc).__name__}") from exc
        if not res.is_success:
            raise EmailSendError(f"resend {res.status_code}: {res.text[:200]}")

    async def send(self, email: OutgoingEmail) -> None:
        await self._post(RESEND_URL, email.idempotency_key, _payload(email), 10.0)

    async def send_batch(self, emails: Sequence[OutgoingEmail], idempotency_key: str) -> None:
        """Up to 100 emails in one request; Resend accepts all or none of them."""
        await self._post(RESEND_BATCH_URL, idempotency_key, [_payload(e) for e in emails], 30.0)
```

The existing test `test_resend_sends_plain_text_with_reply_to` must still pass unchanged (its key order is `from, to, reply_to, subject, text`, and dict equality ignores order).

- [ ] **Step 4: Add `FakeBatchSender` to `apps/api/tests/fakes.py`** (below `FakeSender`):

```python
class FakeBatchSender(FakeSender):
    """FakeSender plus send_batch; batch numbers in ``fail_batches`` (0-based) raise."""

    def __init__(self, fail_times: int = 0, fail_batches: set[int] | None = None) -> None:
        super().__init__(fail_times)
        self.fail_batches = fail_batches or set()
        self.batches: list[tuple[str, list[OutgoingEmail]]] = []
        self.batch_attempts = 0

    async def send_batch(self, emails: Sequence[OutgoingEmail], idempotency_key: str) -> None:
        attempt = self.batch_attempts
        self.batch_attempts += 1
        if attempt in self.fail_batches:
            raise EmailSendError("resend 429: daily_quota_exceeded")
        self.batches.append((idempotency_key, list(emails)))
        self.sent.extend(emails)
```

- [ ] **Step 5: Builder tests** (`apps/api/tests/test_newsletter_email.py`)

```python
from portfolio_api.services.newsletter_email import confirm_email, post_email, post_url

SENDER = "Christopher Guzman <posts@christopherguzman.me>"


def test_post_url_carries_utm_tags() -> None:
    assert post_url("https://christopherguzman.me", "how-i-built-this") == (
        "https://christopherguzman.me/blog/how-i-built-this"
        "?utm_source=newsletter&utm_medium=email&utm_campaign=how-i-built-this"
    )


def test_confirm_email() -> None:
    url = "https://christopherguzman.me/newsletter/confirm?token=abc"
    email = confirm_email(sender=SENDER, to="ada@example.com", confirm_url=url, idempotency_key="k")
    assert email.subject == "Confirm your subscription to Christopher Guzman's blog"
    assert email.sender == SENDER and email.to == "ada@example.com"
    assert url in email.text and email.html is not None
    assert f'href="{url}"' in email.html and "Confirm subscription" in email.html
    assert email.headers is None and email.reply_to is None


def test_post_email_escapes_and_links() -> None:
    email = post_email(
        sender=SENDER,
        to="ada@example.com",
        title="Tips & <tricks>",
        excerpt="Why \"x\" < y",
        post_url="https://christopherguzman.me/blog/t?utm_source=newsletter&utm_medium=email&utm_campaign=t",
        unsubscribe_page_url="https://christopherguzman.me/newsletter/unsubscribe?token=u.1",
        unsubscribe_api_url="https://api.christopherguzman.me/v1/newsletter/unsubscribe?token=u.1",
        idempotency_key="k",
    )
    assert email.subject == "Tips & <tricks>"
    assert email.html is not None
    assert "Tips &amp; &lt;tricks&gt;" in email.html and "<tricks>" not in email.html
    assert "utm_campaign=t" in email.html and "Read the post" in email.html
    assert "&amp;utm_medium=email" in email.html  # attribute-escaped
    assert "You're getting this because you subscribed at christopherguzman.me" in email.html
    assert "/newsletter/unsubscribe?token=u.1" in email.html
    assert email.headers == {
        "List-Unsubscribe": "<https://api.christopherguzman.me/v1/newsletter/unsubscribe?token=u.1>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }
    assert "Read the post: https://christopherguzman.me/blog/t?" in email.text
    assert "Unsubscribe: https://christopherguzman.me/newsletter/unsubscribe?token=u.1" in email.text
```

- [ ] **Step 6: Run, expect ImportError.**

- [ ] **Step 7: Implement `apps/api/src/portfolio_api/services/newsletter_email.py`**

```python
"""The two newsletter emails, as plain inline-styled HTML plus a text part.

Light palette from the site (accent #0d7a57). No images, no tracking pixels, and links
are not rewritten: post links carry UTM tags only.
"""

from html import escape
from urllib.parse import quote

from portfolio_api.clients.email import OutgoingEmail

ACCENT = "#0d7a57"
CONFIRM_SUBJECT = "Confirm your subscription to Christopher Guzman's blog"
FOOTER = "You're getting this because you subscribed at christopherguzman.me"


def post_url(site_url: str, slug: str) -> str:
    s = quote(slug, safe="")
    return (
        f"{site_url.rstrip('/')}/blog/{s}"
        f"?utm_source=newsletter&utm_medium=email&utm_campaign={s}"
    )


def _button(href: str, label: str) -> str:
    return (
        f'<a href="{escape(href)}" style="display:inline-block;background:{ACCENT};color:#ffffff;'
        'text-decoration:none;font-weight:600;padding:10px 16px;border-radius:6px">'
        f"{escape(label)}</a>"
    )


def _page(inner: str) -> str:
    return (
        '<!doctype html><html><body style="margin:0;background:#f4f5f7;padding:24px">'
        '<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e6ea;'
        "border-radius:10px;padding:24px;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;"
        f'color:#16191d;line-height:1.55">{inner}</div></body></html>'
    )


def confirm_email(*, sender: str, to: str, confirm_url: str, idempotency_key: str) -> OutgoingEmail:
    text = (
        f"{CONFIRM_SUBJECT}:\n\n{confirm_url}\n\n"
        "If you didn't ask for this, ignore this email. You won't be subscribed.\n"
    )
    html = _page(
        f'<p style="margin:0 0 16px">{escape(CONFIRM_SUBJECT)}.</p>'
        f'<p style="margin:0 0 16px">{_button(confirm_url, "Confirm subscription")}</p>'
        '<p style="margin:0;color:#5b6470;font-size:13px">If you didn\'t ask for this, ignore '
        "this email. You won't be subscribed.</p>"
    )
    return OutgoingEmail(
        sender=sender,
        to=to,
        subject=CONFIRM_SUBJECT,
        text=text,
        html=html,
        idempotency_key=idempotency_key,
    )


def post_email(
    *,
    sender: str,
    to: str,
    title: str,
    excerpt: str,
    post_url: str,
    unsubscribe_page_url: str,
    unsubscribe_api_url: str,
    idempotency_key: str,
) -> OutgoingEmail:
    text = (
        f"{title}\n\n{excerpt}\n\nRead the post: {post_url}\n\n--\n"
        f"{FOOTER}.\nUnsubscribe: {unsubscribe_page_url}\n"
    )
    html = _page(
        f'<h1 style="margin:0 0 12px;font-size:20px">{escape(title)}</h1>'
        f'<p style="margin:0 0 20px">{escape(excerpt)}</p>'
        f'<p style="margin:0 0 24px">{_button(post_url, "Read the post")}</p>'
        '<p style="margin:0;color:#5b6470;font-size:12px;border-top:1px solid #e3e6ea;'
        f'padding-top:12px">{escape(FOOTER)} · '
        f'<a href="{escape(unsubscribe_page_url)}" style="color:#5b6470">Unsubscribe</a></p>'
    )
    return OutgoingEmail(
        sender=sender,
        to=to,
        subject=" ".join(title.split()),
        text=text,
        html=html,
        headers={
            "List-Unsubscribe": f"<{unsubscribe_api_url}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        idempotency_key=idempotency_key,
    )
```

`subject=" ".join(title.split())` collapses CR/LF (header safety, like contact). The test title has no newlines, so the subject equals it.

- [ ] **Step 8: Run** `uv run pytest tests/test_contact_clients.py tests/test_newsletter_email.py tests/test_contact.py -q` (timeout 180 s). Expected: all pass. Then ruff and pyright.

- [ ] **Step 9: Commit** `feat(api): Resend batch sends and newsletter email builders`.

---
### Task 3: Subscribe, confirm and unsubscribe endpoints

**Files:**
- Create: `apps/api/src/portfolio_api/json_body.py`, `apps/api/src/portfolio_api/schemas/newsletter.py`, `apps/api/src/portfolio_api/services/newsletter.py`, `apps/api/src/portfolio_api/routers/newsletter.py`
- Modify: `apps/api/src/portfolio_api/config.py`, `metrics.py`, `main.py`, `routers/contact.py` (use `parse_json_body`)
- Test: `apps/api/tests/test_newsletter.py`, `apps/api/tests/test_metrics.py` (`METRIC_NAMES`)

**Interfaces:**
- Consumes:
  - Task 1: the `repositories.newsletter` functions, `ConfirmResult`, and the token functions.
  - Task 2: `BatchEmailSender`, `confirm_email`, and `FakeBatchSender` (for tests).
- Produces:
  - `parse_json_body(request, model) -> model`.
  - `NewsletterService(sessions, sender, *, mail_from, site_url, api_url, unsubscribe_key)` with the methods `subscribe(email) -> str | None`, `send_confirmation(email, token)`, `confirm(token) -> bool`, `unsubscribe(token) -> bool`, `purge_pending()` and `refresh_gauge()`.
  - `normalize_email(str) -> str`.
  - `app.state.newsletter_service: NewsletterService | None` and `app.state.newsletter_limiter`.
  - The metrics `NEWSLETTER_SUBSCRIBERS`, `NEWSLETTER_SUBSCRIBE_REQUESTS`, `NEWSLETTER_CONFIRMATIONS`, `NEWSLETTER_UNSUBSCRIBES` and `NEWSLETTER_EMAILS`.
  - Settings `newsletter_from`, `site_url` and `public_api_url`.

- [ ] **Step 1: Shared JSON body parser.** Create `apps/api/src/portfolio_api/json_body.py` with the logic now in `routers/contact.py::contact_body`, generalized:

```python
from fastapi import Request
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ValidationError

from portfolio_api.errors import ApiError


async def parse_json_body[T: BaseModel](request: Request, model: type[T]) -> T:
    """Parse the body ourselves, as a dependency: FastAPI decodes a body parameter's JSON
    before any dependency, so malformed JSON would skip the rate limit and config checks."""
    # JSON only: a text/plain or form POST is a CORS "simple request" that skips the preflight.
    media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if media_type != "application/json":
        raise ApiError(
            400,
            "invalid_request",
            "Some fields are invalid.",
            fields={"body": "Content-Type must be application/json."},
        )
    try:
        return model.model_validate_json(await request.body())
    except ValidationError as exc:
        raise RequestValidationError(
            [{**err, "loc": ("body", *err["loc"])} for err in exc.errors(include_url=False)]
        ) from exc
```

In `routers/contact.py`, replace the body of `contact_body` with `return await parse_json_body(request, ContactRequest)`. Keep its docstring as one line, `"""JSON-only body, parsed after the rate limit and configuration checks."""`, and delete the now-unused imports (`RequestValidationError`, `ValidationError`). Run `uv run pytest tests/test_contact.py -q`. Expected: all pass, unchanged.

- [ ] **Step 2: Settings and metrics.** In `config.py`, after `prometheus_url`, add:

```python
    # Blog subscriptions: on when the Resend key, Turnstile secret and internal secret are set.
    newsletter_from: str = "Christopher Guzman <posts@christopherguzman.me>"
    site_url: str = "https://christopherguzman.me"
    public_api_url: str = "https://api.christopherguzman.me"
```

In `metrics.py`, after `RAG_SYNC_RUNS`:

```python
NEWSLETTER_SUBSCRIBERS = Gauge(
    "newsletter_subscribers", "Newsletter subscribers by status.", ["status"], registry=REGISTRY
)
NEWSLETTER_SUBSCRIBE_REQUESTS = Counter(
    "newsletter_subscribe_requests_total",
    "Newsletter subscribe requests by result.",
    ["result"],
    registry=REGISTRY,
)
NEWSLETTER_CONFIRMATIONS = Counter(
    "newsletter_confirmations_total", "Newsletter subscriptions confirmed.", registry=REGISTRY
)
NEWSLETTER_UNSUBSCRIBES = Counter(
    "newsletter_unsubscribes_total", "Newsletter unsubscribes.", registry=REGISTRY
)
NEWSLETTER_EMAILS = Counter(
    "newsletter_emails_total",
    "Newsletter emails by kind (confirm, post, test) and result.",
    ["kind", "result"],
    registry=REGISTRY,
)
```

In the "Children for every known label value" block add:

```python
for _result in ("accepted", "rejected"):
    NEWSLETTER_SUBSCRIBE_REQUESTS.labels(result=_result)
for _kind in ("confirm", "post", "test"):
    for _result in ("sent", "failed"):
        NEWSLETTER_EMAILS.labels(kind=_kind, result=_result)
```

In `tests/test_metrics.py`, add `"newsletter_subscribers"`, `"newsletter_subscribe_requests_total"`, `"newsletter_confirmations_total"`, `"newsletter_unsubscribes_total"` and `"newsletter_emails_total"` to `METRIC_NAMES`.

- [ ] **Step 3: Schemas** (`apps/api/src/portfolio_api/schemas/newsletter.py`)

```python
from typing import Annotated, Literal

from pydantic import BaseModel, EmailStr, StringConstraints

from portfolio_api.schemas.contact import Token

LinkToken = Annotated[str, StringConstraints(min_length=1, max_length=200)]


class SubscribeRequest(BaseModel):
    email: EmailStr
    turnstile_token: Token
    website: str = ""  # honeypot: humans never see it, so any value means a bot


class SubscribeAccepted(BaseModel):
    status: Literal["check_inbox"] = "check_inbox"


class TokenRequest(BaseModel):
    token: LinkToken


class Confirmed(BaseModel):
    status: Literal["confirmed"] = "confirmed"


class Unsubscribed(BaseModel):
    status: Literal["unsubscribed"] = "unsubscribed"
```

- [ ] **Step 4: Write the endpoint tests** (`apps/api/tests/test_newsletter.py`)

```python
import re
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
from portfolio_api.models import NewsletterSubscriber, SubscriberStatus
from portfolio_api.newsletter_tokens import unsubscribe_key, unsubscribe_token
from portfolio_api.services.newsletter import NewsletterService
from tests.fakes import FakeBatchSender, FakeTurnstile, metric

Sessions = async_sessionmaker[AsyncSession]
KEY = unsubscribe_key("s3cret")
BASE = "/v1/newsletter"


@pytest.fixture
def nl_settings(settings: Settings) -> Settings:
    return settings.model_copy(
        update={
            "turnstile_secret": "sec",
            "resend_api_key": "re_test",
            "internal_secret": "s3cret",
            "contact_to": "chris@example.com",
        }
    )


def service(db: Sessions, sender: FakeBatchSender) -> NewsletterService:
    return NewsletterService(
        db,
        sender,
        mail_from="Christopher Guzman <posts@christopherguzman.me>",
        site_url="https://christopherguzman.me",
        api_url="https://api.christopherguzman.me",
        unsubscribe_key=KEY,
    )


def make_app(
    settings: Settings,
    db: Sessions | None,
    turnstile: FakeTurnstile | None = None,
    sender: FakeBatchSender | None = None,
) -> FastAPI:
    app = create_app(settings)
    app.state.turnstile = turnstile or FakeTurnstile()
    app.state.newsletter_service = (
        service(db, sender or FakeBatchSender()) if db is not None else None
    )
    return app


async def call(
    app: FastAPI, path: str, body: Any = None, *, ip: str = "203.0.113.7", **kw: Any
) -> Response:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        if body is not None:
            kw["json"] = body
        return await c.post(f"{BASE}{path}", headers={"CF-Connecting-IP": ip}, **kw)


def sub(email: str = "ada@example.com", **extra: Any) -> dict[str, Any]:
    return {"email": email, "turnstile_token": "tok", "website": "", **extra}


def token_in(text: str) -> str:
    found = re.search(r"token=([A-Za-z0-9_\-]+)", text)
    assert found
    return found.group(1)


async def rows(db: Sessions) -> list[NewsletterSubscriber]:
    async with db() as s:
        return list((await s.scalars(select(NewsletterSubscriber))).all())


async def age_all(db: Sessions, hours: float) -> None:
    async with db.begin() as s:
        await s.execute(
            update(NewsletterSubscriber).values(
                confirm_sent_at=func.now() - timedelta(hours=hours)
            )
        )


async def test_new_address_gets_one_confirmation_email(nl_settings: Settings, db: Sessions) -> None:
    sender, turnstile = FakeBatchSender(), FakeTurnstile()
    before = metric("newsletter_subscribe_requests_total", result="accepted")
    sent_before = metric("newsletter_emails_total", kind="confirm", result="sent")
    res = await call(make_app(nl_settings, db, turnstile, sender), "/subscribe", sub("Ada@Example.COM"))
    assert (res.status_code, res.json()) == (202, {"status": "check_inbox"})
    assert turnstile.calls == [("tok", "203.0.113.7")]
    [row] = await rows(db)
    assert (row.email, row.status) == ("ada@example.com", SubscriberStatus.pending)
    [email] = sender.sent
    assert email.to == "ada@example.com"
    assert email.subject == "Confirm your subscription to Christopher Guzman's blog"
    assert "https://christopherguzman.me/newsletter/confirm?token=" in email.text
    assert metric("newsletter_subscribe_requests_total", result="accepted") == before + 1
    assert metric("newsletter_emails_total", kind="confirm", result="sent") == sent_before + 1


async def test_pending_and_confirmed_addresses_get_the_same_answer(
    nl_settings: Settings, db: Sessions
) -> None:
    sender = FakeBatchSender()
    app = make_app(nl_settings, db, sender=sender)
    first = await call(app, "/subscribe", sub())
    again = await call(app, "/subscribe", sub())  # pending, within the hour
    await call(app, "/confirm", {"token": token_in(sender.sent[0].text)})
    await age_all(db, 2)
    confirmed = await call(app, "/subscribe", sub())  # confirmed: never re-sent
    assert {r.status_code for r in (first, again, confirmed)} == {202}
    assert first.json() == again.json() == confirmed.json() == {"status": "check_inbox"}
    assert len(sender.sent) == 1


async def test_pending_address_is_re_sent_after_an_hour(nl_settings: Settings, db: Sessions) -> None:
    sender = FakeBatchSender()
    app = make_app(nl_settings, db, sender=sender)
    await call(app, "/subscribe", sub())
    await age_all(db, 2)
    await call(app, "/subscribe", sub())
    assert len(sender.sent) == 2
    assert token_in(sender.sent[0].text) != token_in(sender.sent[1].text)


async def test_honeypot_is_accepted_silently(nl_settings: Settings, db: Sessions) -> None:
    turnstile = FakeTurnstile()
    before = metric("newsletter_subscribe_requests_total", result="rejected")
    res = await call(make_app(nl_settings, db, turnstile), "/subscribe", sub(website="x"))
    assert (res.status_code, res.json()) == (202, {"status": "check_inbox"})
    assert await rows(db) == [] and turnstile.calls == []
    assert metric("newsletter_subscribe_requests_total", result="rejected") == before + 1


async def test_turnstile_failure_and_outage(nl_settings: Settings, db: Sessions) -> None:
    res = await call(make_app(nl_settings, db, FakeTurnstile(False)), "/subscribe", sub())
    assert (res.status_code, res.json()["error"]["code"]) == (400, "turnstile_failed")
    down = FakeTurnstile(TurnstileUnavailableError("timeout"))
    res = await call(make_app(nl_settings, db, down), "/subscribe", sub())
    assert (res.status_code, res.json()["error"]["code"]) == (503, "turnstile_unavailable")
    assert await rows(db) == []


async def test_subscribe_is_rate_limited_per_client(nl_settings: Settings, db: Sessions) -> None:
    app = make_app(nl_settings, db)
    for n in range(5):
        assert (await call(app, "/subscribe", sub(f"u{n}@example.com"))).status_code == 202
    res = await call(app, "/subscribe", sub("u9@example.com"))
    assert (res.status_code, res.json()["error"]["code"]) == (429, "rate_limited")
    assert int(res.headers["retry-after"]) >= 1
    other = await call(app, "/subscribe", sub("v@example.com"), ip="198.51.100.9")
    assert other.status_code == 202


async def test_subscribe_requires_json_and_a_valid_email(nl_settings: Settings, db: Sessions) -> None:
    app = make_app(nl_settings, db)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        res = await c.post(
            f"{BASE}/subscribe",
            content=b"email=a@b.co",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    assert (res.status_code, res.json()["error"]["code"]) == (400, "invalid_request")
    res = await call(app, "/subscribe", sub("not-an-email"))
    assert res.status_code == 400 and "email" in res.json()["error"]["fields"]


async def test_unconfigured_newsletter_is_503(nl_settings: Settings) -> None:
    app = make_app(nl_settings, None)
    for path, body in (("/subscribe", sub()), ("/confirm", {"token": "t"}), ("/unsubscribe", {"token": "t"})):
        res = await call(app, path, body)
        assert (res.status_code, res.json()["error"]["code"]) == (503, "newsletter_unavailable")


async def test_failed_confirmation_email_still_answers_202(nl_settings: Settings, db: Sessions) -> None:
    before = metric("newsletter_emails_total", kind="confirm", result="failed")
    res = await call(make_app(nl_settings, db, sender=FakeBatchSender(fail_times=1)), "/subscribe", sub())
    assert res.status_code == 202
    assert metric("newsletter_emails_total", kind="confirm", result="failed") == before + 1


async def test_confirm_is_idempotent_and_counts_once(nl_settings: Settings, db: Sessions) -> None:
    sender = FakeBatchSender()
    app = make_app(nl_settings, db, sender=sender)
    await call(app, "/subscribe", sub())
    token = token_in(sender.sent[0].text)
    before = metric("newsletter_confirmations_total")
    for _ in range(2):
        res = await call(app, "/confirm", {"token": token})
        assert (res.status_code, res.json()) == (200, {"status": "confirmed"})
    assert metric("newsletter_confirmations_total") == before + 1
    [row] = await rows(db)
    assert row.status == SubscriberStatus.confirmed
    bad = await call(app, "/confirm", {"token": "wrong"})
    assert (bad.status_code, bad.json()["error"]["code"]) == (400, "invalid_token")


async def test_expired_confirm_link_is_invalid(nl_settings: Settings, db: Sessions) -> None:
    sender = FakeBatchSender()
    app = make_app(nl_settings, db, sender=sender)
    await call(app, "/subscribe", sub())
    await age_all(db, 24 * 7 + 1)
    res = await call(app, "/confirm", {"token": token_in(sender.sent[0].text)})
    assert (res.status_code, res.json()["error"]["code"]) == (400, "invalid_token")


async def test_unsubscribe_deletes_and_is_idempotent(nl_settings: Settings, db: Sessions) -> None:
    sender = FakeBatchSender()
    app = make_app(nl_settings, db, sender=sender)
    await call(app, "/subscribe", sub())
    [row] = await rows(db)
    token = unsubscribe_token(KEY, row.id)
    before = metric("newsletter_unsubscribes_total")
    for _ in range(2):
        res = await call(app, "/unsubscribe", {"token": token})
        assert (res.status_code, res.json()) == (200, {"status": "unsubscribed"})
    assert await rows(db) == []
    assert metric("newsletter_unsubscribes_total") == before + 1
    forged = await call(app, "/unsubscribe", {"token": f"{row.id}.AAAA"})
    assert (forged.status_code, forged.json()["error"]["code"]) == (400, "invalid_token")


async def test_one_click_unsubscribe_from_the_query_string(nl_settings: Settings, db: Sessions) -> None:
    """RFC 8058: the mail provider POSTs List-Unsubscribe=One-Click as a form to the header URL."""
    app = make_app(nl_settings, db)
    await call(app, "/subscribe", sub())
    [row] = await rows(db)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        res = await c.post(
            f"{BASE}/unsubscribe",
            params={"token": unsubscribe_token(KEY, row.id)},
            content=b"List-Unsubscribe=One-Click",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    assert (res.status_code, res.json()) == (200, {"status": "unsubscribed"})
    assert await rows(db) == []


async def test_purge_and_gauge(db: Sessions) -> None:
    svc = service(db, FakeBatchSender())
    assert await svc.subscribe("old@example.com") is not None
    await age_all(db, 24 * 7 + 1)
    assert await svc.subscribe("new@example.com") is not None
    await svc.purge_pending()
    await svc.refresh_gauge()
    assert [r.email for r in await rows(db)] == ["new@example.com"]
    assert metric("newsletter_subscribers", status="pending") == 1
    assert metric("newsletter_subscribers", status="confirmed") == 0
```

- [ ] **Step 5: Run, expect ImportError** for `services.newsletter`.

- [ ] **Step 6: Service** (`apps/api/src/portfolio_api/services/newsletter.py`)

```python
"""Blog subscriptions: double opt-in sign-up, confirm, unsubscribe and post sends."""

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.clients.email import BatchEmailSender, EmailSendError
from portfolio_api.metrics import (
    NEWSLETTER_CONFIRMATIONS,
    NEWSLETTER_EMAILS,
    NEWSLETTER_SUBSCRIBERS,
    NEWSLETTER_UNSUBSCRIBES,
)
from portfolio_api.newsletter_tokens import hash_token, new_confirm_token, read_unsubscribe_token
from portfolio_api.repositories import newsletter as repo
from portfolio_api.repositories.newsletter import ConfirmResult
from portfolio_api.services.newsletter_email import confirm_email

log = structlog.get_logger()


def normalize_email(email: str) -> str:
    return email.strip().lower()


class NewsletterService:
    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        sender: BatchEmailSender,
        *,
        mail_from: str,
        site_url: str,
        api_url: str,
        unsubscribe_key: bytes,
    ) -> None:
        self._sessions = sessions
        self._sender = sender
        self._mail_from = mail_from
        self._site_url = site_url.rstrip("/")
        self._api_url = api_url.rstrip("/")
        self._key = unsubscribe_key

    async def subscribe(self, email: str) -> str | None:
        """Record a sign-up. Returns the confirm token to email, or None when none is due."""
        token, token_hash = new_confirm_token()
        async with self._sessions.begin() as session:
            due = await repo.claim_confirmation(session, normalize_email(email), token_hash)
        return token if due else None

    async def send_confirmation(self, email: str, token: str) -> None:
        """Runs after the response, so every subscribe answers in the same time."""
        message = confirm_email(
            sender=self._mail_from,
            to=normalize_email(email),
            confirm_url=f"{self._site_url}/newsletter/confirm?token={token}",
            idempotency_key=hash_token(token),
        )
        try:
            await self._sender.send(message)
        except EmailSendError as exc:
            NEWSLETTER_EMAILS.labels(kind="confirm", result="failed").inc()
            log.warning("newsletter confirmation email failed", error=str(exc))
            return
        NEWSLETTER_EMAILS.labels(kind="confirm", result="sent").inc()

    async def confirm(self, token: str) -> bool:
        async with self._sessions.begin() as session:
            result = await repo.confirm(session, hash_token(token))
        if result is ConfirmResult.confirmed:
            NEWSLETTER_CONFIRMATIONS.inc()
        return result is not ConfirmResult.invalid

    async def unsubscribe(self, token: str) -> bool:
        """False only for a forged or malformed token; an unknown subscriber is already out."""
        subscriber_id = read_unsubscribe_token(self._key, token)
        if subscriber_id is None:
            return False
        async with self._sessions.begin() as session:
            deleted = await repo.delete(session, subscriber_id)
        if deleted:
            NEWSLETTER_UNSUBSCRIBES.inc()
        return True

    async def purge_pending(self) -> None:
        async with self._sessions.begin() as session:
            purged = await repo.purge_pending(session)
        if purged:
            log.info("newsletter pending sign-ups purged", count=purged)

    async def refresh_gauge(self) -> None:
        async with self._sessions() as session:
            found = await repo.counts(session)
        for status, count in found.items():
            NEWSLETTER_SUBSCRIBERS.labels(status=status.value).set(count)
```

Logs never include an email address.

- [ ] **Step 7: Router** (`apps/api/src/portfolio_api/routers/newsletter.py`)

```python
from typing import Annotated

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, Request

from portfolio_api.clients.turnstile import TurnstileUnavailableError, TurnstileVerifier
from portfolio_api.errors import ApiError
from portfolio_api.json_body import parse_json_body
from portfolio_api.metrics import NEWSLETTER_SUBSCRIBE_REQUESTS
from portfolio_api.ratelimit import client_ip, client_key
from portfolio_api.schemas.newsletter import (
    Confirmed,
    SubscribeAccepted,
    SubscribeRequest,
    TokenRequest,
    Unsubscribed,
)
from portfolio_api.services.newsletter import NewsletterService

log = structlog.get_logger()
router = APIRouter(prefix="/v1/newsletter", tags=["newsletter"])


def _json_schema(model: type[SubscribeRequest] | type[TokenRequest]) -> dict[str, object]:
    return {
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": model.model_json_schema()}},
        }
    }


async def enforce_rate_limit(request: Request) -> None:
    wait = request.app.state.newsletter_limiter.hit(client_key(client_ip(request) or "unknown"))
    if wait is not None:
        NEWSLETTER_SUBSCRIBE_REQUESTS.labels(result="rejected").inc()
        raise ApiError(
            429,
            "rate_limited",
            "Too many tries. Try again later.",
            headers={"Retry-After": str(wait)},
        )


async def require_service(request: Request) -> NewsletterService:
    service: NewsletterService | None = request.app.state.newsletter_service
    if service is None:
        raise ApiError(503, "newsletter_unavailable", "Subscriptions are not configured.")
    return service


async def subscribe_body(request: Request) -> SubscribeRequest:
    return await parse_json_body(request, SubscribeRequest)


async def token_body(request: Request) -> TokenRequest:
    return await parse_json_body(request, TokenRequest)


def _invalid_token() -> ApiError:
    return ApiError(400, "invalid_token", "This link has expired or is not valid.")


# Dependencies resolve in order: rate limit, then configuration, then the body.
@router.post(
    "/subscribe",
    status_code=202,
    response_model=SubscribeAccepted,
    dependencies=[Depends(enforce_rate_limit)],
    openapi_extra=_json_schema(SubscribeRequest),
)
async def subscribe(
    request: Request,
    background: BackgroundTasks,
    service: Annotated[NewsletterService, Depends(require_service)],
    body: Annotated[SubscribeRequest, Depends(subscribe_body)],
) -> SubscribeAccepted:
    if body.website:
        NEWSLETTER_SUBSCRIBE_REQUESTS.labels(result="rejected").inc()
        log.info("newsletter honeypot tripped")
        return SubscribeAccepted()
    # The service exists only when the Turnstile secret is set (main.py).
    turnstile: TurnstileVerifier = request.app.state.turnstile
    try:
        ok = await turnstile.verify(body.turnstile_token, client_ip(request))
    except TurnstileUnavailableError as exc:
        log.warning("turnstile unavailable", error=str(exc))
        raise ApiError(
            503, "turnstile_unavailable", "Spam check is unavailable. Try again later."
        ) from exc
    if not ok:
        NEWSLETTER_SUBSCRIBE_REQUESTS.labels(result="rejected").inc()
        raise ApiError(400, "turnstile_failed", "Spam check failed. Try again.")
    email = str(body.email)
    token = await service.subscribe(email)
    NEWSLETTER_SUBSCRIBE_REQUESTS.labels(result="accepted").inc()
    if token is not None:
        background.add_task(service.send_confirmation, email, token)
    return SubscribeAccepted()


@router.post("/confirm", response_model=Confirmed, openapi_extra=_json_schema(TokenRequest))
async def confirm(
    service: Annotated[NewsletterService, Depends(require_service)],
    body: Annotated[TokenRequest, Depends(token_body)],
) -> Confirmed:
    if not await service.confirm(body.token):
        raise _invalid_token()
    return Confirmed()


@router.post("/unsubscribe", response_model=Unsubscribed)
async def unsubscribe(
    request: Request, service: Annotated[NewsletterService, Depends(require_service)]
) -> Unsubscribed:
    """Token from the JSON body (the site's page), or from the query string for the
    RFC 8058 one-click POST, whose form body (List-Unsubscribe=One-Click) is ignored."""
    token = request.query_params.get("token")
    if token is None:
        token = (await parse_json_body(request, TokenRequest)).token
    if not await service.unsubscribe(token[:200]):
        raise _invalid_token()
    return Unsubscribed()
```

- [ ] **Step 8: Wire into `main.py`.**
  - Imports: `from portfolio_api.newsletter_tokens import unsubscribe_key`, `from portfolio_api.services.newsletter import NewsletterService`, and add `newsletter` to the routers import.
  - Insert this block directly after the `app.state.chat_switch = ...` line, so `directus` is already defined for Task 4:

```python
    # Blog subscriptions: double opt-in mail needs Resend, Turnstile and the unsubscribe key.
    app.state.newsletter_limiter = SlidingWindowLimiter([(5, 60), (20, 86_400)])
    newsletter_service: NewsletterService | None = None
    if sender is not None and settings.turnstile_secret and settings.internal_secret:
        newsletter_service = NewsletterService(
            sessions,
            sender,
            mail_from=settings.newsletter_from,
            site_url=settings.site_url,
            api_url=settings.public_api_url,
            unsubscribe_key=unsubscribe_key(settings.internal_secret),
        )
        jobs.append(Job("newsletter-purge", 86_400, newsletter_service.purge_pending))
        jobs.append(Job("newsletter-gauge", 300, newsletter_service.refresh_gauge))
    app.state.newsletter_service = newsletter_service
```

  - Add `app.include_router(newsletter.router)` after `app.include_router(contact.router)`.

  `ResendSender` satisfies `BatchEmailSender` structurally, so the `sender` variable needs no cast. If pyright infers it as `ResendSender | None`, that is fine.

- [ ] **Step 9: Run** `uv run pytest tests/test_newsletter.py tests/test_contact.py tests/test_metrics.py tests/test_foundation.py -q` (timeout 300 s). Expected: all pass. Then run the full suite (timeout 600 s), ruff and pyright.

- [ ] **Step 10: Commit** `feat(api): newsletter subscribe, confirm and unsubscribe endpoints`.

---

### Task 4: Post sends and internal endpoints

**Files:**
- Modify: `apps/api/src/portfolio_api/clients/directus.py` (`NewsletterPost`, `fetch_post`), `services/newsletter.py` (send, list, remove), `schemas/newsletter.py` (send/list models), `routers/internal.py`, `main.py` (pass `posts` and `test_to`)
- Test: `apps/api/tests/test_newsletter_send.py`, `apps/api/tests/test_directus_client.py` (add `fetch_post` tests)

**Interfaces:**
- Consumes: Task 1 repository and tokens; Task 2 `post_email` and `post_url`; Task 3 `NewsletterService`.
- Produces:
  - `NewsletterPost(id: int, slug: str, title: str, excerpt: str, published: bool)` and `DirectusContent.fetch_post(post_id) -> NewsletterPost | None`.
  - `NewsletterService(..., posts: PostSource | None = None, test_to: str | None = None, sleep=asyncio.sleep)`, with the methods `send(post_id, *, test) -> SendResult`, `subscribers() -> tuple[list[NewsletterSubscriber], dict[SubscriberStatus, int]]` and `remove(subscriber_id)`. It also defines `SendResult`, `SendRefusedError` and `BATCH_SIZE = 100`.
  - The HTTP contract Tasks 7 and 8 depend on:
    - `POST /internal/newsletter/send` takes `{"post_id": int|str, "test": bool|str}`.
      - 200 `{"status": "complete"|"test", "sent", "remaining", "sent_at", "recipients"}`
      - 207 `{"status": "partial", ...}`
      - 409 `not_published` | `already_sent` | `send_in_progress`
      - 502 `directus_unavailable` | `send_failed`
      - 503 `newsletter_unavailable` | `test_unavailable` | `posts_unavailable`
    - `GET /internal/newsletter/subscribers` returns `{"subscribers": [{"id", "email", "status", "created_at", "confirmed_at"}], "totals": {"confirmed", "pending"}}`.
    - `DELETE /internal/newsletter/subscribers/{uuid}` returns 204.

- [ ] **Step 1: Directus client tests.** Append to `tests/test_directus_client.py` (it already has the `client(routes)` helper and `Recorder`):

```python
async def test_fetch_post_reads_one_post_by_id() -> None:
    content, recorder = client(
        {"/items/posts/7": {"id": 7, "slug": "hello", "title": "Hello", "excerpt": "Hi.", "status": "draft"}}
    )
    post = await content.fetch_post(7)
    assert post is not None and (post.id, post.slug, post.published) == (7, "hello", False)
    assert recorder.requests[0].url.params["fields"] == "id,slug,title,excerpt,status"


@pytest.mark.parametrize("status", [403, 404])
async def test_fetch_post_missing_is_none(status: int) -> None:
    content, _ = client({"/items/posts/7": httpx.Response(status, json={"errors": []})})
    assert await content.fetch_post(7) is None


@pytest.mark.parametrize(
    "reply",
    [httpx.Response(500), {"id": 7, "slug": "x"}, ["not", "a", "dict"]],
)
async def test_fetch_post_errors_raise(reply: Any) -> None:
    content, _ = client({"/items/posts/7": reply})
    with pytest.raises(DirectusError):
        await content.fetch_post(7)
```

- [ ] **Step 2: Implement in `clients/directus.py`.** Add after `ChatSettings`:

```python
@dataclass(frozen=True)
class NewsletterPost:
    id: int
    slug: str
    title: str
    excerpt: str
    published: bool
```

and as a method of `DirectusContent`:

```python
    async def fetch_post(self, post_id: int) -> NewsletterPost | None:
        """One post by id, drafts included. None when Directus has no such item: it answers
        403 for a missing id to tokens without admin rights, and 404 otherwise."""
        path = f"/items/posts/{post_id}"
        try:
            res = await self._http.get(
                f"{self._base}{path}",
                params={"fields": "id,slug,title,excerpt,status"},
                headers=self._headers,
                timeout=10.0,
            )
        except httpx.HTTPError as exc:
            raise DirectusError(f"{path}: {type(exc).__name__}") from exc
        if res.status_code in (403, 404):
            return None
        if res.status_code != 200:
            raise DirectusError(f"{path}: directus {res.status_code}")
        try:
            data: Any = res.json()["data"]
            return NewsletterPost(
                id=int(data["id"]),
                slug=str(data["slug"]),
                title=str(data["title"]),
                excerpt=str(data["excerpt"]),
                published=data["status"] == "published",
            )
        except (ValueError, KeyError, TypeError) as exc:
            raise DirectusError(f"{path}: unexpected body") from exc
```

Run `uv run pytest tests/test_directus_client.py -q`. Expected: pass.

- [ ] **Step 3: Schemas.** Append to `schemas/newsletter.py`:

```python
import uuid
from datetime import datetime

from pydantic import Field, field_validator


class SendRequest(BaseModel):
    # Directus renders Flow templates as strings ("12", "true", "false", or "" when the
    # checkbox was left alone), so both fields accept their string forms.
    post_id: int = Field(gt=0)
    test: bool = False

    @field_validator("test", mode="before")
    @classmethod
    def _lenient_bool(cls, value: object) -> bool:
        return value is True or value == "true"


class SendResponse(BaseModel):
    status: Literal["complete", "partial", "test"]
    sent: int
    remaining: int
    sent_at: datetime | None
    recipients: int | None


class SubscriberOut(BaseModel):
    id: uuid.UUID
    email: str
    status: Literal["pending", "confirmed"]
    created_at: datetime
    confirmed_at: datetime | None


class SubscriberTotals(BaseModel):
    confirmed: int
    pending: int


class SubscriberList(BaseModel):
    subscribers: list[SubscriberOut]
    totals: SubscriberTotals
```

(Merge the imports into the file's import block; ruff will sort them.)

- [ ] **Step 4: Write the send tests** (`apps/api/tests/test_newsletter_send.py`)

```python
import asyncio
import uuid
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.clients.directus import DirectusError, NewsletterPost
from portfolio_api.clients.email import OutgoingEmail
from portfolio_api.config import Settings
from portfolio_api.main import create_app
from portfolio_api.models import NewsletterSend, NewsletterSubscriber
from portfolio_api.newsletter_tokens import read_unsubscribe_token, unsubscribe_key
from portfolio_api.services import newsletter as newsletter_module
from portfolio_api.services.newsletter import NewsletterService
from tests.fakes import FakeBatchSender, metric

Sessions = async_sessionmaker[AsyncSession]
KEY = unsubscribe_key("s3cret")
SECRET = {"X-Internal-Secret": "s3cret"}
POST = NewsletterPost(id=3, slug="hello-world", title="Hello world", excerpt="First post.", published=True)
DRAFT = NewsletterPost(id=4, slug="draft", title="Draft", excerpt="Soon.", published=False)


class FakePosts:
    def __init__(self, *posts: NewsletterPost, error: Exception | None = None) -> None:
        self.posts = {p.id: p for p in posts}
        self.error = error

    async def fetch_post(self, post_id: int) -> NewsletterPost | None:
        if self.error:
            raise self.error
        return self.posts.get(post_id)


class Sleeps:
    def __init__(self) -> None:
        self.calls: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)


def make_service(
    db: Sessions, sender: FakeBatchSender, posts: FakePosts | None = None, sleep: Sleeps | None = None
) -> NewsletterService:
    return NewsletterService(
        db,
        sender,
        mail_from="Christopher Guzman <posts@christopherguzman.me>",
        site_url="https://christopherguzman.me",
        api_url="https://api.christopherguzman.me",
        unsubscribe_key=KEY,
        posts=posts or FakePosts(POST, DRAFT),
        test_to="chris@example.com",
        sleep=sleep or Sleeps(),
    )


def make_app(settings: Settings, svc: NewsletterService | None) -> FastAPI:
    app = create_app(settings.model_copy(update={"internal_secret": "s3cret"}))
    app.state.newsletter_service = svc
    return app


async def send(app: FastAPI, body: dict[str, Any], headers: dict[str, str] = SECRET) -> Response:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.post("/internal/newsletter/send", json=body, headers=headers)


async def confirmed(db: Sessions, svc: NewsletterService, n: int) -> list[str]:
    emails = [f"reader{i}@example.com" for i in range(n)]
    for email in emails:
        token = await svc.subscribe(email)
        assert token is not None and await svc.confirm(token)
    return emails


def recipients(sender: FakeBatchSender) -> list[str]:
    return [e.to for e in sender.sent]


async def test_drafts_and_unknown_posts_are_refused(settings: Settings, db: Sessions) -> None:
    sender = FakeBatchSender()
    app = make_app(settings, make_service(db, sender))
    for post_id in (DRAFT.id, 99):
        res = await send(app, {"post_id": post_id, "test": False})
        assert (res.status_code, res.json()["error"]["code"]) == (409, "not_published")
    assert sender.sent == []


async def test_full_send_reaches_every_confirmed_subscriber_once(
    settings: Settings, db: Sessions
) -> None:
    sender = FakeBatchSender()
    svc = make_service(db, sender)
    emails = await confirmed(db, svc, 3)
    await svc.subscribe("pending@example.com")  # never confirmed: not emailed
    sender.sent.clear()
    app = make_app(settings, svc)
    before = metric("newsletter_emails_total", kind="post", result="sent")

    res = await send(app, {"post_id": POST.id, "test": False})
    body = res.json()
    assert res.status_code == 200
    assert (body["status"], body["sent"], body["remaining"], body["recipients"]) == ("complete", 3, 0, 3)
    assert body["sent_at"] is not None
    assert sorted(recipients(sender)) == sorted(emails)
    assert metric("newsletter_emails_total", kind="post", result="sent") == before + 3

    async with db() as s:
        ids = {r.email: r.id for r in (await s.scalars(select(NewsletterSubscriber))).all()}
    for email in sender.sent:
        assert email.subject == "Hello world"
        assert "utm_source=newsletter&utm_medium=email&utm_campaign=hello-world" in email.text
        assert email.headers is not None
        header = email.headers["List-Unsubscribe"]
        assert header.startswith("<https://api.christopherguzman.me/v1/newsletter/unsubscribe?token=")
        token = header.split("token=", 1)[1].rstrip(">")
        assert read_unsubscribe_token(KEY, token) == ids[email.to]
        assert email.headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"

    again = await send(app, {"post_id": POST.id, "test": False})
    assert (again.status_code, again.json()["error"]["code"]) == (409, "already_sent")
    assert len(sender.sent) == 3


async def test_test_send_goes_only_to_chris_and_records_nothing(
    settings: Settings, db: Sessions
) -> None:
    sender = FakeBatchSender()
    svc = make_service(db, sender)
    await confirmed(db, svc, 2)
    sender.sent.clear()
    app = make_app(settings, svc)
    before = metric("newsletter_emails_total", kind="test", result="sent")
    for _ in range(2):  # repeatable, and never "already_sent"
        res = await send(app, {"post_id": str(POST.id), "test": "true"})
        assert (res.status_code, res.json()["status"], res.json()["sent"]) == (200, "test", 1)
    assert recipients(sender) == ["chris@example.com", "chris@example.com"]
    assert metric("newsletter_emails_total", kind="test", result="sent") == before + 2
    async with db() as s:
        assert await s.scalar(select(func.count()).select_from(NewsletterSend)) == 0


@pytest.mark.parametrize("flag", [False, "false", "", "undefined"])
async def test_non_true_test_flags_mean_a_real_send(
    settings: Settings, db: Sessions, flag: Any
) -> None:
    sender = FakeBatchSender()
    svc = make_service(db, sender)
    await confirmed(db, svc, 1)
    sender.sent.clear()
    res = await send(make_app(settings, svc), {"post_id": "3", "test": flag})
    assert res.json()["status"] == "complete"


async def test_partial_send_resumes_without_duplicates(
    settings: Settings, db: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(newsletter_module, "BATCH_SIZE", 2)
    sender = FakeBatchSender(fail_batches={1})  # the second batch hits the daily quota
    sleeps = Sleeps()
    svc = make_service(db, sender, sleep=sleeps)
    emails = await confirmed(db, svc, 5)
    sender.sent.clear()
    app = make_app(settings, svc)
    failed_before = metric("newsletter_emails_total", kind="post", result="failed")

    first = await send(app, {"post_id": POST.id, "test": False})
    assert first.status_code == 207
    assert (first.json()["status"], first.json()["sent"], first.json()["remaining"]) == ("partial", 2, 3)
    assert metric("newsletter_emails_total", kind="post", result="failed") == failed_before + 2

    second = await send(app, {"post_id": POST.id, "test": False})
    assert second.status_code == 200
    assert (second.json()["sent"], second.json()["recipients"]) == (3, 5)
    assert sorted(recipients(sender)) == sorted(emails)  # each exactly once
    assert len({key for key, _ in sender.batches}) == len(sender.batches)
    assert sleeps.calls and all(s > 0 for s in sleeps.calls)


async def test_no_subscribers_completes_with_zero(settings: Settings, db: Sessions) -> None:
    res = await send(make_app(settings, make_service(db, FakeBatchSender())), {"post_id": POST.id})
    assert (res.json()["status"], res.json()["recipients"]) == ("complete", 0)


async def test_a_second_click_during_a_send_is_refused(settings: Settings, db: Sessions) -> None:
    release = asyncio.Event()

    class SlowSender(FakeBatchSender):
        async def send_batch(self, emails: Any, idempotency_key: str) -> None:
            await release.wait()
            await super().send_batch(emails, idempotency_key)

    svc = make_service(db, SlowSender())
    await confirmed(db, svc, 1)
    first = asyncio.create_task(svc.send(POST.id, test=False))
    await asyncio.sleep(0.05)
    res = await send(make_app(settings, svc), {"post_id": POST.id})
    assert (res.status_code, res.json()["error"]["code"]) == (409, "send_in_progress")
    release.set()
    assert (await first).status == "complete"


async def test_directus_outage_is_502(settings: Settings, db: Sessions) -> None:
    svc = make_service(db, FakeBatchSender(), posts=FakePosts(error=DirectusError("down")))
    res = await send(make_app(settings, svc), {"post_id": POST.id})
    assert (res.status_code, res.json()["error"]["code"]) == (502, "directus_unavailable")


async def test_internal_routes_refuse_tunnel_traffic_and_wrong_secrets(
    settings: Settings, db: Sessions
) -> None:
    app = make_app(settings, make_service(db, FakeBatchSender()))
    for headers in ({}, {"X-Internal-Secret": "nope"}, {**SECRET, "CF-Connecting-IP": "203.0.113.7"}):
        assert (await send(app, {"post_id": 3}, headers)).status_code == 404
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.get("/internal/newsletter/subscribers", headers=headers)).status_code == 404
            res = await c.delete(f"/internal/newsletter/subscribers/{uuid.uuid4()}", headers=headers)
            assert res.status_code == 404


async def test_unconfigured_newsletter_is_503_behind_the_secret(settings: Settings) -> None:
    res = await send(make_app(settings, None), {"post_id": 3})
    assert (res.status_code, res.json()["error"]["code"]) == (503, "newsletter_unavailable")


async def test_list_and_remove_subscribers(settings: Settings, db: Sessions) -> None:
    svc = make_service(db, FakeBatchSender())
    await confirmed(db, svc, 2)
    await svc.subscribe("pending@example.com")
    app = make_app(settings, svc)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        listed = (await c.get("/internal/newsletter/subscribers", headers=SECRET)).json()
        assert listed["totals"] == {"confirmed": 2, "pending": 1}
        assert {s["email"] for s in listed["subscribers"]} == {
            "reader0@example.com",
            "reader1@example.com",
            "pending@example.com",
        }
        target = listed["subscribers"][0]["id"]
        for _ in range(2):  # idempotent
            res = await c.delete(f"/internal/newsletter/subscribers/{target}", headers=SECRET)
            assert res.status_code == 204
        bad = await c.delete("/internal/newsletter/subscribers/not-a-uuid", headers=SECRET)
        assert bad.status_code == 400
        after = (await c.get("/internal/newsletter/subscribers", headers=SECRET)).json()
    assert target not in {s["id"] for s in after["subscribers"]}


async def test_post_emails_are_plain(db: Sessions) -> None:
    """No tracking: no images, and the only links are the post and the unsubscribe page."""
    svc = make_service(db, FakeBatchSender())
    email: OutgoingEmail = svc._post_email(POST, "a@example.com", uuid.UUID(int=1))  # noqa: SLF001
    assert email.html is not None and "<img" not in email.html
    hrefs = [part.split('"', 1)[0] for part in email.html.split('href="')[1:]]
    assert len(hrefs) == 2
    assert hrefs[0].startswith("https://christopherguzman.me/blog/hello-world?")
    assert hrefs[1].startswith("https://christopherguzman.me/newsletter/unsubscribe?token=")
```

`test_list_and_remove_subscribers` asserts 400 for a malformed UUID. The validation handler maps FastAPI's path-param error to `400 invalid_request`. If the handler yields 422, fix the test to match the handler's actual code; the handler is the authority.

- [ ] **Step 5: Run, expect failures** (no `send`, no routes).

- [ ] **Step 6: Extend the service.** In `services/newsletter.py`, add imports (`asyncio`, `hashlib`, `uuid`, `Awaitable`, `Callable`, `Sequence`, `dataclass` and `replace` from `dataclasses`, `datetime`, `Literal`, `Protocol`, `NewsletterPost`, `NewsletterSubscriber`, `SubscriberStatus`, `OutgoingEmail`, `unsubscribe_token`, `post_email`, `post_url`) and:

```python
BATCH_SIZE = 100  # Resend's batch limit
BATCH_PAUSE = 0.6  # Resend allows 2 requests a second


class PostSource(Protocol):
    async def fetch_post(self, post_id: int) -> NewsletterPost | None: ...


@dataclass(frozen=True)
class SendResult:
    status: Literal["complete", "partial", "test"]
    sent: int
    remaining: int
    sent_at: datetime | None = None
    recipients: int | None = None


class SendRefusedError(Exception):
    """A send that must not happen; the router turns it into an error response."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def batch_key(post_id: int, subscriber_ids: Sequence[uuid.UUID]) -> str:
    """Same post and recipients, same key: Resend drops a repeat within 24 hours."""
    digest = hashlib.sha256(",".join(str(i) for i in subscriber_ids).encode()).hexdigest()
    return f"newsletter-{post_id}-{digest[:32]}"
```

Extend `__init__` with keyword-only `posts: PostSource | None = None`, `test_to: str | None = None` and `sleep: Callable[[float], Awaitable[None]] = asyncio.sleep`. Store them as `self._posts`, `self._test_to` and `self._sleep`, and add `self._lock = asyncio.Lock()`. Then add these methods:

```python
    def _post_email(
        self, post: NewsletterPost, to: str, subscriber_id: uuid.UUID
    ) -> OutgoingEmail:
        token = unsubscribe_token(self._key, subscriber_id)
        return post_email(
            sender=self._mail_from,
            to=to,
            title=post.title,
            excerpt=post.excerpt,
            post_url=post_url(self._site_url, post.slug),
            unsubscribe_page_url=f"{self._site_url}/newsletter/unsubscribe?token={token}",
            unsubscribe_api_url=f"{self._api_url}/v1/newsletter/unsubscribe?token={token}",
            idempotency_key=f"newsletter-{post.id}-{subscriber_id}",
        )

    async def send(self, post_id: int, *, test: bool) -> SendResult:
        """Email a published post. A test goes only to CONTACT_TO and records nothing."""
        if self._posts is None:
            raise SendRefusedError(503, "posts_unavailable", "Directus is not configured.")
        post = await self._posts.fetch_post(post_id)  # DirectusError propagates to the router
        if post is None or not post.published:
            raise SendRefusedError(409, "not_published", "The post is not published.")
        if test:
            return await self._send_test(post)
        if self._lock.locked():
            raise SendRefusedError(409, "send_in_progress", "This post is already being sent.")
        async with self._lock:
            return await self._send_all(post)

    async def _send_test(self, post: NewsletterPost) -> SendResult:
        if not self._test_to:
            raise SendRefusedError(503, "test_unavailable", "CONTACT_TO is not set.")
        # The all-zero id is never a subscriber: its unsubscribe link answers 200, harmlessly.
        email = self._post_email(post, self._test_to, uuid.UUID(int=0))
        try:
            # A fresh key per click: every test send really goes out.
            await self._sender.send(
                replace(email, idempotency_key=f"newsletter-test-{uuid.uuid4()}")
            )
        except EmailSendError as exc:
            NEWSLETTER_EMAILS.labels(kind="test", result="failed").inc()
            log.warning("newsletter test email failed", post_id=post.id, error=str(exc))
            raise SendRefusedError(502, "send_failed", "The test email was not sent.") from exc
        NEWSLETTER_EMAILS.labels(kind="test", result="sent").inc()
        return SendResult("test", sent=1, remaining=0)

    async def _send_all(self, post: NewsletterPost) -> SendResult:
        async with self._sessions.begin() as session:
            existing = await repo.get_send(session, post.id)
            if existing is not None and existing.completed_at is not None:
                raise SendRefusedError(
                    409,
                    "already_sent",
                    f"Already emailed on {existing.completed_at.isoformat()}.",
                )
            await repo.start_send(session, post.id)
        sent = 0
        while True:
            async with self._sessions() as session:
                batch = await repo.undelivered(session, post.id, limit=BATCH_SIZE)
            if not batch:
                break
            if sent:
                await self._sleep(BATCH_PAUSE)
            ids = [row.id for row in batch]
            emails = [self._post_email(post, row.email, row.id) for row in batch]
            try:
                await self._sender.send_batch(emails, batch_key(post.id, ids))
            except EmailSendError as exc:
                NEWSLETTER_EMAILS.labels(kind="post", result="failed").inc(len(batch))
                log.warning("newsletter batch failed", post_id=post.id, error=str(exc))
                async with self._sessions() as session:
                    remaining = await repo.count_undelivered(session, post.id)
                return SendResult("partial", sent=sent, remaining=remaining)
            async with self._sessions.begin() as session:
                await repo.record_deliveries(session, post.id, ids)
            NEWSLETTER_EMAILS.labels(kind="post", result="sent").inc(len(batch))
            sent += len(batch)
        async with self._sessions.begin() as session:
            done = await repo.complete_send(session, post.id)
        log.info("newsletter sent", post_id=post.id, recipients=done.recipients)
        return SendResult(
            "complete", sent=sent, remaining=0, sent_at=done.completed_at, recipients=done.recipients
        )

    async def subscribers(
        self,
    ) -> tuple[list[NewsletterSubscriber], dict[SubscriberStatus, int]]:
        async with self._sessions() as session:
            return await repo.list_all(session), await repo.counts(session)

    async def remove(self, subscriber_id: uuid.UUID) -> None:
        async with self._sessions.begin() as session:
            await repo.delete(session, subscriber_id)
```

`test_post_emails_are_plain` calls the private `_post_email` builder directly. The `noqa: SLF001` covers that.

- [ ] **Step 7: Internal routes.** In `routers/internal.py` add:

```python
import uuid
from dataclasses import asdict
from typing import Annotated

from fastapi.responses import JSONResponse

from portfolio_api.clients.directus import DirectusError
from portfolio_api.json_body import parse_json_body
from portfolio_api.schemas.newsletter import (
    SendRequest,
    SendResponse,
    SubscriberList,
    SubscriberOut,
    SubscriberTotals,
)
from portfolio_api.models import SubscriberStatus
from portfolio_api.services.newsletter import NewsletterService, SendRefusedError


def newsletter_service(request: Request) -> NewsletterService:
    service: NewsletterService | None = request.app.state.newsletter_service
    if service is None:
        raise ApiError(503, "newsletter_unavailable", "Subscriptions are not configured.")
    return service


async def send_body(request: Request) -> SendRequest:
    return await parse_json_body(request, SendRequest)


Newsletter = Annotated[NewsletterService, Depends(newsletter_service)]


# require_internal runs first (decorator dependencies), so callers without the secret
# learn nothing about the configuration.
@router.post("/newsletter/send", dependencies=[Depends(require_internal)])
async def newsletter_send(
    service: Newsletter, body: Annotated[SendRequest, Depends(send_body)]
) -> JSONResponse:
    try:
        result = await service.send(body.post_id, test=body.test)
    except SendRefusedError as exc:
        raise ApiError(exc.status, exc.code, exc.message) from exc
    except DirectusError as exc:
        raise ApiError(502, "directus_unavailable", "Couldn't read the post from Directus.") from exc
    payload = SendResponse(**asdict(result)).model_dump(mode="json")
    return JSONResponse(payload, status_code=207 if result.status == "partial" else 200)


@router.get(
    "/newsletter/subscribers",
    response_model=SubscriberList,
    dependencies=[Depends(require_internal)],
)
async def newsletter_subscribers(service: Newsletter) -> SubscriberList:
    rows, totals = await service.subscribers()
    return SubscriberList(
        subscribers=[SubscriberOut.model_validate(row, from_attributes=True) for row in rows],
        totals=SubscriberTotals(
            confirmed=totals[SubscriberStatus.confirmed], pending=totals[SubscriberStatus.pending]
        ),
    )


@router.delete(
    "/newsletter/subscribers/{subscriber_id}",
    status_code=204,
    dependencies=[Depends(require_internal)],
)
async def newsletter_remove(subscriber_id: uuid.UUID, service: Newsletter) -> None:
    await service.remove(subscriber_id)
```

Wrapping DirectusError as `ApiError` keeps the 500 handler out of it.

In `main.py`, pass `posts=directus, test_to=settings.contact_to` to the `NewsletterService(...)` call from Task 3.

- [ ] **Step 8: Run** `uv run pytest tests/test_newsletter_send.py tests/test_newsletter.py tests/test_internal.py tests/test_directus_client.py -q` (timeout 300 s). Expected: all pass. Then run the full suite (timeout 600 s), ruff and pyright.

- [ ] **Step 9: Commit** `feat(api): send posts to subscribers and internal subscriber endpoints`.

---
### Task 5: Web `SubscribeForm` on `/blog` and `/`

**Files:**
- Create: `apps/web/src/lib/newsletter.ts`, `apps/web/src/components/newsletter/subscribe-form.tsx`
- Modify: `apps/web/src/lib/contact.ts` (export `EMAIL_PATTERN`), `apps/web/src/lib/analytics.ts` (event), `apps/web/src/app/blog/page.tsx`, `apps/web/src/app/page.tsx`, `apps/web/e2e/fake-backend.mjs`, `apps/web/e2e/journey.spec.ts`
- Test: `apps/web/src/lib/newsletter.test.ts`, `apps/web/src/components/newsletter/subscribe-form.test.tsx`, `apps/web/src/app/blog/page.test.tsx`, `apps/web/src/app/page.test.tsx`

**Interfaces:**
- Consumes: `POST {PUBLIC_API_URL}/v1/newsletter/subscribe` (Task 3), the `Turnstile` component (`@/components/contact/turnstile`) and `serverEnv()`.
- Produces:
  - `NEWSLETTER_MESSAGES`, `isValidEmail`, `subscribe(apiUrl, payload) -> Promise<SubscribeResult>` and `submitLinkToken(apiUrl, action, token) -> Promise<LinkResult>` (Task 6 uses the last one).
  - `<SubscribeForm apiUrl siteKey />`.
  - The Umami event `newsletter-subscribe` (no data).

- [ ] **Step 1: Lib tests** (`apps/web/src/lib/newsletter.test.ts`)

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { isValidEmail, submitLinkToken, subscribe } from "./newsletter";

const API = "https://api.example.com";

function reply(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

afterEach(() => vi.unstubAllGlobals());

describe("isValidEmail", () => {
  it("accepts a trimmed address and rejects junk", () => {
    expect(isValidEmail(" ada@example.com ")).toBe(true);
    expect(isValidEmail("ada@example")).toBe(false);
    expect(isValidEmail(`${"a".repeat(250)}@example.com`)).toBe(false);
  });
});

describe("subscribe", () => {
  const payload = { email: " ada@example.com ", turnstile_token: "tok", website: "" };

  it("posts trimmed JSON and maps 202 to ok", async () => {
    const fetchMock = reply(202, { status: "check_inbox" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await subscribe(API, payload)).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API}/v1/newsletter/subscribe`);
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ email: "ada@example.com", turnstile_token: "tok", website: "" });
  });

  it.each([
    [429, {}, "rate_limited"],
    [400, { error: { code: "turnstile_failed", message: "x" } }, "turnstile"],
    [400, { error: { code: "invalid_request", message: "x" } }, "invalid"],
    [503, { error: { code: "newsletter_unavailable", message: "x" } }, "unavailable"],
  ] as const)("maps %s %j to %s", async (status, body, kind) => {
    vi.stubGlobal("fetch", reply(status, body));
    expect(await subscribe(API, payload)).toBe(kind);
  });

  it("maps a network error to unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await subscribe(API, payload)).toBe("unavailable");
  });
});

describe("submitLinkToken", () => {
  it("posts the token to the action", async () => {
    const fetchMock = reply(200, { status: "confirmed" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await submitLinkToken(API, "confirm", "t1")).toBe("ok");
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/v1/newsletter/confirm`);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: "t1" });
  });

  it("maps invalid_token, other errors and network failures", async () => {
    vi.stubGlobal("fetch", reply(400, { error: { code: "invalid_token", message: "x" } }));
    expect(await submitLinkToken(API, "unsubscribe", "t")).toBe("invalid");
    vi.stubGlobal("fetch", reply(500));
    expect(await submitLinkToken(API, "unsubscribe", "t")).toBe("unavailable");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await submitLinkToken(API, "confirm", "t")).toBe("unavailable");
  });
});
```

- [ ] **Step 2: Run** `pnpm --dir apps/web exec vitest run src/lib/newsletter.test.ts`. Expected: FAIL, module missing.

- [ ] **Step 3: Implement.**
  - In `apps/web/src/lib/contact.ts`, change `const EMAIL_PATTERN` to `export const EMAIL_PATTERN`.
  - In `apps/web/src/lib/analytics.ts`, add `"newsletter-subscribe": undefined;` to `EventData`, after `"contact-sent"`.
  - Then create `apps/web/src/lib/newsletter.ts`:

```ts
import { EMAIL_PATTERN } from "@/lib/contact";
import { z } from "@/lib/zod-client";

export const NEWSLETTER_MESSAGES = {
  checkInbox: "Check your inbox to confirm.",
  invalidEmail: "Enter a valid email address.",
  rateLimited: "Too many tries. Try again later.",
  turnstile: "Spam check failed. Try again.",
  pendingToken: "Spam check is still running. Try again in a moment.",
  unavailable: "Couldn't subscribe right now. Try again later.",
} as const;

export type SubscribeResult = "ok" | "invalid" | "turnstile" | "rate_limited" | "unavailable";
export type LinkResult = "ok" | "invalid" | "unavailable";
export type LinkAction = "confirm" | "unsubscribe";

// Same rule as the contact form; the API's email validation stays the authority.
export function isValidEmail(value: string): boolean {
  const email = value.trim();
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

const ErrorBody = z.object({ error: z.object({ code: z.string() }) });

async function errorCode(res: Response): Promise<string | null> {
  const parsed = ErrorBody.safeParse(await res.json().catch(() => null));
  return parsed.success ? parsed.data.error.code : null;
}

async function postJson(url: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return null;
  }
}

export async function subscribe(
  apiUrl: string,
  payload: { email: string; turnstile_token: string; website: string },
): Promise<SubscribeResult> {
  const res = await postJson(`${apiUrl}/v1/newsletter/subscribe`, {
    ...payload,
    email: payload.email.trim(),
  });
  if (!res) return "unavailable";
  if (res.status === 202) return "ok";
  if (res.status === 429) return "rate_limited";
  if (res.status === 400) {
    const code = await errorCode(res);
    if (code === "turnstile_failed") return "turnstile";
    if (code === "invalid_request") return "invalid";
  }
  return "unavailable";
}

export async function submitLinkToken(
  apiUrl: string,
  action: LinkAction,
  token: string,
): Promise<LinkResult> {
  const res = await postJson(`${apiUrl}/v1/newsletter/${action}`, { token });
  if (!res) return "unavailable";
  if (res.ok) return "ok";
  if (res.status === 400 && (await errorCode(res)) === "invalid_token") return "invalid";
  return "unavailable";
}
```

Run the lib tests. Expected: PASS.

- [ ] **Step 4: Component tests** (`apps/web/src/components/newsletter/subscribe-form.test.tsx`)

```tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SubscribeForm } from "./subscribe-form";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));

// The real widget loads Cloudflare's script; this one issues a token on mount unless told not to.
let issueToken = true;
vi.mock("@/components/contact/turnstile", () => ({
  Turnstile: ({ onToken }: { onToken: (t: string | null) => void }) => {
    useEffect(() => {
      if (issueToken) onToken("tok");
    }, [onToken]);
    return <div data-testid="turnstile" />;
  },
}));

const API = "https://api.example.com";

function renderForm() {
  render(<SubscribeForm apiUrl={API} siteKey="site-key" />);
  return {
    email: screen.getByRole("textbox", { name: "Email" }),
    button: screen.getByRole("button", { name: "Subscribe" }),
  };
}

beforeEach(() => {
  issueToken = true;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.umami;
});

describe("SubscribeForm", () => {
  it("shows the heading and note, and loads Turnstile only after the email field is focused", () => {
    const { email } = renderForm();
    expect(screen.getByRole("heading", { name: "Subscribe" })).toBeTruthy();
    expect(screen.getByText("No spam. Unsubscribe anytime.")).toBeTruthy();
    expect(screen.queryByTestId("turnstile")).toBeNull();
    act(() => email.focus());
    expect(screen.getByTestId("turnstile")).toBeTruthy();
  });

  it("rejects a bad address without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { email, button } = renderForm();
    act(() => email.focus());
    fireEvent.change(email, { target: { value: "nope" } });
    fireEvent.click(button);
    expect(await screen.findByText("Enter a valid email address.")).toBeTruthy();
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("subscribes, tracks the event without the address, and confirms", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const trackMock = vi.fn();
    window.umami = { track: trackMock };
    const { email, button } = renderForm();
    act(() => email.focus());
    fireEvent.change(email, { target: { value: "ada@example.com" } });
    fireEvent.click(button);
    expect(await screen.findByText("Check your inbox to confirm.")).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      email: "ada@example.com",
      turnstile_token: "tok",
      website: "",
    });
    expect(trackMock).toHaveBeenCalledWith("newsletter-subscribe");
  });

  it.each([
    [429, {}, "Too many tries. Try again later."],
    [400, { error: { code: "turnstile_failed", message: "x" } }, "Spam check failed. Try again."],
    [503, {}, "Couldn't subscribe right now. Try again later."],
  ])("shows the %s message", async (status, body, text) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
    const { email, button } = renderForm();
    act(() => email.focus());
    fireEvent.change(email, { target: { value: "ada@example.com" } });
    fireEvent.click(button);
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it("asks the visitor to wait while the spam check has no token", async () => {
    issueToken = false;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { email, button } = renderForm();
    act(() => email.focus());
    fireEvent.change(email, { target: { value: "ada@example.com" } });
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByText("Spam check is still running. Try again in a moment.")).toBeTruthy(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run, expect FAIL** (component missing).

- [ ] **Step 6: Implement `apps/web/src/components/newsletter/subscribe-form.tsx`**

```tsx
"use client";

import { useTheme } from "next-themes";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Turnstile } from "@/components/contact/turnstile";
import { track } from "@/lib/analytics";
import { NEWSLETTER_MESSAGES, isValidEmail, subscribe } from "@/lib/newsletter";

type Problem = Exclude<keyof typeof NEWSLETTER_MESSAGES, "checkInbox">;

const inputClass =
  "min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-base text-foreground md:text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand aria-[invalid=true]:border-destructive";
const buttonClass =
  "inline-flex shrink-0 items-center justify-center rounded-md bg-accent-brand px-3.5 py-2 text-[13px] font-semibold text-accent-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand";

// Turnstile's script loads on the first focus of the email field, so pages showing this box
// pay no script cost until someone starts typing.
export function SubscribeForm({ apiUrl, siteKey }: { apiUrl: string; siteKey: string }) {
  const id = useId();
  const { resolvedTheme } = useTheme();
  const doneRef = useRef<HTMLParagraphElement>(null);
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [armed, setArmed] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [turnstileFailed, setTurnstileFailed] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  function onToken(next: string | null) {
    setToken(next);
    if (next) setTurnstileFailed(false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setArmed(true);
    if (!isValidEmail(email)) {
      setProblem("invalidEmail");
      return;
    }
    if (!token) {
      setProblem(turnstileFailed ? "unavailable" : "pendingToken");
      return;
    }
    setProblem(null);
    setSending(true);
    const result = await subscribe(apiUrl, { email, turnstile_token: token, website });
    setSending(false);
    if (result === "ok") {
      track("newsletter-subscribe");
      setDone(true);
      return;
    }
    // Turnstile tokens are single-use: get a fresh one for the next attempt.
    setResetSignal((n) => n + 1);
    setProblem(
      result === "invalid"
        ? "invalidEmail"
        : result === "rate_limited"
          ? "rateLimited"
          : result === "turnstile"
            ? "turnstile"
            : "unavailable",
    );
  }

  const emailId = `${id}-email`;
  const problemId = `${id}-problem`;
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="rounded-[10px] border border-border bg-card p-5"
    >
      <h2 id={`${id}-heading`} className="text-[15px] font-semibold">
        Subscribe
      </h2>
      {done ? (
        <p
          ref={doneRef}
          role="status"
          tabIndex={-1}
          className="mt-3 text-sm text-foreground outline-none"
        >
          {NEWSLETTER_MESSAGES.checkInbox}
        </p>
      ) : (
        <form noValidate onSubmit={onSubmit} aria-label="Subscribe" className="relative mt-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor={emailId} className="sr-only">
              Email
            </label>
            <input
              id={emailId}
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onFocus={() => setArmed(true)}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={problem === "invalidEmail" ? true : undefined}
              aria-describedby={problem ? problemId : undefined}
              className={inputClass}
            />
            <button type="submit" disabled={sending} className={buttonClass}>
              Subscribe
            </button>
          </div>
          <div aria-hidden="true" className="absolute -left-[9999px] size-px overflow-hidden">
            <label htmlFor={`${id}-hp`}>Leave this field empty</label>
            <input
              id={`${id}-hp`}
              name="newsletter_hp"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />
          </div>
          {armed ? (
            <Turnstile
              siteKey={siteKey}
              theme={resolvedTheme === "light" ? "light" : "dark"}
              resetSignal={resetSignal}
              onToken={onToken}
              onError={() => setTurnstileFailed(true)}
            />
          ) : null}
          {problem ? (
            <p id={problemId} role="alert" className="mt-2 text-sm text-destructive">
              {NEWSLETTER_MESSAGES[problem]}
            </p>
          ) : null}
        </form>
      )}
      <p className="mt-2 text-xs text-muted-foreground">No spam. Unsubscribe anytime.</p>
    </section>
  );
}
```

The button reads `Subscribe` even while sending (it is `disabled`). That keeps the copy exact and the accessible name stable.

React's `onFocus` listens to `focusin`, so the tests focus the field for real (`email.focus()` inside `act`) rather than with `fireEvent.focus`. Run the component tests. Expected: PASS. In the 503 case the body `{}` has no error code, so it maps to `unavailable`.

- [ ] **Step 7: Place it.**
  - `apps/web/src/app/blog/page.tsx`: import `SubscribeForm` and `serverEnv`. In the component, read `const { turnstileSiteKey, publicApiUrl } = serverEnv();`. Right after `<PageHeader … />`, render:

```tsx
      {turnstileSiteKey ? (
        <div className="mt-4">
          <SubscribeForm apiUrl={publicApiUrl} siteKey={turnstileSiteKey} />
        </div>
      ) : null}
```

  - `apps/web/src/app/page.tsx`: read the same two values from `serverEnv()` (already imported? if not, import it). Inside the Blog `<section>`, after the `</ol>`, add:

```tsx
          {turnstileSiteKey ? (
            <div className="mt-6">
              <SubscribeForm apiUrl={publicApiUrl} siteKey={turnstileSiteKey} />
            </div>
          ) : null}
```

  - Tests:
    - In `apps/web/src/app/blog/page.test.tsx`, mock the form like the contact page test does: `vi.mock("@/components/newsletter/subscribe-form", () => ({ SubscribeForm: (p: { apiUrl: string; siteKey: string }) => <div data-testid="subscribe">{JSON.stringify(p)}</div> }))`. Add two tests. With `vi.stubEnv("TURNSTILE_SITE_KEY", "k")` and `vi.stubEnv("PUBLIC_API_URL", "https://api.x")`, the box renders with `{"apiUrl":"https://api.x","siteKey":"k"}` above the post list (assert `compareDocumentPosition` puts it before the `<ol>`, or before the empty state). Without the key, `queryByTestId("subscribe")` is null. Add `vi.unstubAllEnvs()` to `afterEach`.
    - In `apps/web/src/app/page.test.tsx`, use the same mock. With the key set and posts present, the box renders after the Blog section's list. With no posts, the Blog section and the box are both absent.

- [ ] **Step 8: E2E.**
  - In `apps/web/e2e/fake-backend.mjs`, add to the `switch`, before `default`:

```js
    case "POST /v1/newsletter/subscribe":
      return send(res, 202, { status: "check_inbox" });
```

  - In `apps/web/e2e/journey.spec.ts`, add:

```ts
test("blog: subscribe", async ({ page }) => {
  await page.goto("/blog");
  const box = page.getByRole("region", { name: "Subscribe" });
  await box.getByRole("textbox", { name: "Email" }).fill("ada@example.com");
  await box.getByRole("button", { name: "Subscribe" }).click();
  await expect(box.getByText("Check your inbox to confirm.")).toBeVisible();
  await expectNoAxeViolations(page);
});
```

  `fill` focuses the field first, so Turnstile loads (the hermetic stub issues `e2e-token`). Run `pnpm --dir apps/web build` (timeout 600 s), then `pnpm --dir apps/web test:e2e` (timeout 600 s; first kill any stale server: `lsof -ti tcp:3100 -ti tcp:3101 | xargs -r kill`). Expected: every journey test passes on both projects.

- [ ] **Step 9: Checks.** `pnpm --dir apps/web lint`, `typecheck`, `test` and `format`. All green.

- [ ] **Step 10: Commit** `feat(web): subscribe box on the blog and homepage`.

---

### Task 6: Confirm and unsubscribe pages

**Files:**
- Create: `apps/web/src/components/newsletter/newsletter-action.tsx`, `apps/web/src/app/newsletter/confirm/page.tsx`, `apps/web/src/app/newsletter/unsubscribe/page.tsx`
- Modify: `apps/web/e2e/fake-backend.mjs`, `apps/web/e2e/journey.spec.ts`
- Test: `apps/web/src/components/newsletter/newsletter-action.test.tsx`, `apps/web/src/app/newsletter/pages.test.tsx`

**Interfaces:**
- Consumes: `submitLinkToken` and `LinkAction` (Task 5), `PageHeader` and `serverEnv()`.
- Produces: `<NewsletterAction action apiUrl token />`.

- [ ] **Step 1: Component tests** (`apps/web/src/components/newsletter/newsletter-action.test.tsx`)

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewsletterAction } from "./newsletter-action";

const API = "https://api.example.com";

function reply(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NewsletterAction", () => {
  it("confirms once on load, even under StrictMode", async () => {
    const fetchMock = reply(200, { status: "confirmed" });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <StrictMode>
        <NewsletterAction action="confirm" apiUrl={API} token="t1" />
      </StrictMode>,
    );
    expect(screen.getByText("Confirming…")).toBeTruthy();
    expect(
      await screen.findByText("You're subscribed. You'll get an email when there's a new post."),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/v1/newsletter/confirm`);
  });

  it("explains an expired confirm link and links to the blog", async () => {
    vi.stubGlobal("fetch", reply(400, { error: { code: "invalid_token", message: "x" } }));
    render(<NewsletterAction action="confirm" apiUrl={API} token="old" />);
    const text = await screen.findByText(/This link has expired\. Subscribe again from/);
    expect(text.textContent).toBe("This link has expired. Subscribe again from the blog.");
    expect(screen.getByRole("link", { name: "the blog" }).getAttribute("href")).toBe("/blog");
  });

  it("treats a missing token as expired without calling the API", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<NewsletterAction action="confirm" apiUrl={API} token="" />);
    expect(screen.getByText(/This link has expired/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unsubscribes on load", async () => {
    vi.stubGlobal("fetch", reply(200, { status: "unsubscribed" }));
    render(<NewsletterAction action="unsubscribe" apiUrl={API} token="u.1" />);
    expect(await screen.findByText("You're unsubscribed.")).toBeTruthy();
  });

  it.each(["confirm", "unsubscribe"] as const)("%s: API down asks to retry", async (action) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    render(<NewsletterAction action={action} apiUrl={API} token="t" />);
    expect(
      await screen.findByText("Something went wrong. Open the link again in a minute."),
    ).toBeTruthy();
  });

  it("explains an invalid unsubscribe link", async () => {
    vi.stubGlobal("fetch", reply(400, { error: { code: "invalid_token", message: "x" } }));
    render(<NewsletterAction action="unsubscribe" apiUrl={API} token="bad" />);
    expect(await screen.findByText("This unsubscribe link is not valid.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `apps/web/src/components/newsletter/newsletter-action.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { submitLinkToken, type LinkAction, type LinkResult } from "@/lib/newsletter";

type State = "working" | LinkResult;

const WORKING: Record<LinkAction, string> = {
  confirm: "Confirming…",
  unsubscribe: "Unsubscribing…",
};
const DONE: Record<LinkAction, string> = {
  confirm: "You're subscribed. You'll get an email when there's a new post.",
  unsubscribe: "You're unsubscribed.",
};
const UNAVAILABLE = "Something went wrong. Open the link again in a minute.";

// The token is POSTed from the browser after load, so mail scanners that prefetch the
// link (a GET) never confirm or unsubscribe anyone.
export function NewsletterAction({
  action,
  apiUrl,
  token,
}: {
  action: LinkAction;
  apiUrl: string;
  token: string;
}) {
  const [state, setState] = useState<State>(token ? "working" : "invalid");
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true; // StrictMode runs effects twice in development
    void submitLinkToken(apiUrl, action, token).then(setState);
  }, [action, apiUrl, token]);

  let message: React.ReactNode;
  if (state === "working") message = WORKING[action];
  else if (state === "ok") message = DONE[action];
  else if (state === "unavailable") message = UNAVAILABLE;
  else if (action === "confirm")
    message = (
      <>
        This link has expired. Subscribe again from{" "}
        <Link href="/blog" className="underline underline-offset-4">
          the blog
        </Link>
        .
      </>
    );
  else message = "This unsubscribe link is not valid.";

  return (
    <p role="status" className="mt-4 text-sm text-foreground">
      {message}
    </p>
  );
}
```

Import `type ReactNode` from `react` instead of using `React.ReactNode` if the project's lint rules require it.

- [ ] **Step 4: Pages.** `apps/web/src/app/newsletter/confirm/page.tsx`:

```tsx
import type { Metadata } from "next";

import { PageHeader } from "@/components/content/page-header";
import { NewsletterAction } from "@/components/newsletter/newsletter-action";
import { serverEnv } from "@/lib/env";

export const metadata: Metadata = {
  title: "Confirm subscription",
  robots: { index: false, follow: false },
};

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const { publicApiUrl } = serverEnv();
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <PageHeader prompt="$ newsletter confirm" title="Confirm subscription" />
      <NewsletterAction
        action="confirm"
        apiUrl={publicApiUrl}
        token={typeof token === "string" ? token : ""}
      />
    </div>
  );
}
```

`apps/web/src/app/newsletter/unsubscribe/page.tsx` is the same with `title: "Unsubscribe"`, prompt `$ newsletter unsubscribe`, page title `Unsubscribe`, `action="unsubscribe"`, and the function name `UnsubscribePage`.

Pages test `apps/web/src/app/newsletter/pages.test.tsx` (jsdom). Mock `@/components/newsletter/newsletter-action` to render its props as JSON, then cover:
- (a) each page's `metadata.robots` is `{ index: false, follow: false }`;
- (b) `render(await ConfirmPage({ searchParams: Promise.resolve({ token: "t1" }) }))` passes `{"action":"confirm","apiUrl":"https://api.christopherguzman.me","token":"t1"}` (PUBLIC_API_URL unset, so the default applies);
- (c) an array token (`["a","b"]`) becomes `""`;
- (d) the same checks for the unsubscribe page, including its h1 `Unsubscribe`.

The sitemap needs no change: it lists explicit routes only. Confirm that `sitemap.test.ts` still passes.

- [ ] **Step 5: E2E.** In `fake-backend.mjs`, add before `default`:

```js
    case "POST /v1/newsletter/confirm":
    case "POST /v1/newsletter/unsubscribe":
      return linkToken(req, res, route.endsWith("confirm") ? "confirmed" : "unsubscribed");
```

and above `const server = …`:

```js
// The newsletter link pages POST {token}; "good" succeeds, anything else is an expired link.
function linkToken(req, res, status) {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const token = JSON.parse(raw || "{}").token;
    if (token === "good") return send(res, 200, { status });
    send(res, 400, { error: { code: "invalid_token", message: "expired" } });
  });
}
```

In `journey.spec.ts` add:

```ts
test("newsletter: confirm and unsubscribe links", async ({ page }) => {
  await page.goto("/newsletter/confirm?token=good");
  await expect(
    page.getByText("You're subscribed. You'll get an email when there's a new post."),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  await page.goto("/newsletter/confirm?token=old");
  await expect(page.getByText(/This link has expired/)).toBeVisible();
  await expect(page.getByRole("link", { name: "the blog" })).toHaveAttribute("href", "/blog");

  await page.goto("/newsletter/unsubscribe?token=good");
  await expect(page.getByText("You're unsubscribed.")).toBeVisible();
  await expectNoAxeViolations(page);
});
```

Rebuild and run e2e as in Task 5 Step 8. Expected: all pass. The CSP, console and axe gates stay green.

- [ ] **Step 6: Checks** (lint, typecheck, test, format). **Commit** `feat(web): newsletter confirm and unsubscribe pages`.

---

### Task 7: Private `/admin/subscribers` page

**Files:**
- Create: `apps/web/src/lib/cf-access.ts`, `apps/web/src/lib/subscribers.ts`, `apps/web/src/app/admin/subscribers/page.tsx`, `apps/web/src/app/admin/subscribers/actions.ts`
- Modify: `apps/web/package.json` (+ `jose`), `apps/web/src/lib/env.ts`, `apps/web/src/app/robots.ts`
- Test: `apps/web/src/lib/cf-access.test.ts`, `apps/web/src/lib/subscribers.test.ts`, `apps/web/src/app/admin/subscribers/page.test.tsx`, `apps/web/src/app/admin/subscribers/actions.test.ts`, `apps/web/src/lib/env.test.ts`, `apps/web/src/app/robots.test.ts`

**Interfaces:**
- Consumes: Task 4's `GET /internal/newsletter/subscribers` and `DELETE /internal/newsletter/subscribers/{id}`, each called with `X-Internal-Secret`.
- Produces:
  - `serverEnv()` gains `internalApiSecret` (`INTERNAL_API_SECRET`), `cfAccessTeamDomain` (`CF_ACCESS_TEAM_DOMAIN`) and `cfAccessAud` (`CF_ACCESS_AUD`).
  - `verifyAccessJwt(token, keys?) -> Promise<boolean>` and `requireAccess() -> Promise<void>` (404 otherwise).
  - `listSubscribers() -> Promise<SubscriberList | null>` and `removeSubscriber(id) -> Promise<boolean>`.

- [ ] **Step 1: Dependency.** Run `pnpm --dir apps/web add jose`. Then check its publish date with `npm view jose time --json | tail -5`. If the resolved version is less than 14 days old, install the newest version that is older (`pnpm --dir apps/web add jose@<that version>`). Commit `package.json` and `pnpm-lock.yaml` with this task.

- [ ] **Step 2: Env.** In `apps/web/src/lib/env.ts`, add to `ServerEnv` and `serverEnv()`:

```ts
  internalApiSecret: string | undefined;
  cfAccessTeamDomain: string | undefined;
  cfAccessAud: string | undefined;
```

```ts
    internalApiSecret: read("INTERNAL_API_SECRET"),
    cfAccessTeamDomain: read("CF_ACCESS_TEAM_DOMAIN"),
    cfAccessAud: read("CF_ACCESS_AUD"),
```

Update `env.test.ts`: the full-object expectations gain the three keys (undefined when unset, values when stubbed).

- [ ] **Step 3: Access tests** (`apps/web/src/lib/cf-access.test.ts`)

```ts
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { verifyAccessJwt } from "./cf-access";

const TEAM = "chris.cloudflareaccess.com";
const AUD = "aud-123";
let keys: ReturnType<typeof createLocalJWKSet>;
let sign: (claims?: { iss?: string; aud?: string; exp?: string }) => Promise<string>;
let foreign: string;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  keys = createLocalJWKSet({ keys: [jwk] });
  sign = ({ iss = `https://${TEAM}`, aud = AUD, exp = "5m" } = {}) =>
    new SignJWT({ email: "chris@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(pair.privateKey);
  const other = await generateKeyPair("RS256");
  foreign = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(`https://${TEAM}`)
    .setAudience(AUD)
    .setExpirationTime("5m")
    .sign(other.privateKey);
});

function configure(team = TEAM, aud = AUD) {
  vi.stubEnv("CF_ACCESS_TEAM_DOMAIN", team);
  vi.stubEnv("CF_ACCESS_AUD", aud);
}

afterEach(() => vi.unstubAllEnvs());

describe("verifyAccessJwt", () => {
  it("accepts a token signed for this team and application", async () => {
    configure();
    expect(await verifyAccessJwt(await sign(), keys)).toBe(true);
  });

  it("rejects a missing token, wrong audience, issuer, expiry or key", async () => {
    configure();
    expect(await verifyAccessJwt(null, keys)).toBe(false);
    expect(await verifyAccessJwt(await sign({ aud: "other" }), keys)).toBe(false);
    expect(await verifyAccessJwt(await sign({ iss: "https://evil.cloudflareaccess.com" }), keys)).toBe(false);
    expect(await verifyAccessJwt(await sign({ exp: "-1m" }), keys)).toBe(false);
    expect(await verifyAccessJwt(foreign, keys)).toBe(false);
    expect(await verifyAccessJwt("not.a.jwt", keys)).toBe(false);
  });

  it("fails closed when unconfigured or misconfigured", async () => {
    const token = await sign();
    expect(await verifyAccessJwt(token, keys)).toBe(false); // no env at all
    configure("chris.example.com");
    expect(await verifyAccessJwt(token, keys)).toBe(false); // not a cloudflareaccess.com team
    configure(TEAM, "");
    expect(await verifyAccessJwt(token, keys)).toBe(false);
  });
});
```

If `setExpirationTime("-1m")` is rejected by this jose version, use a numeric epoch in the past (`Math.floor(Date.now() / 1000) - 60`).

- [ ] **Step 4: Implement `apps/web/src/lib/cf-access.ts`**

```ts
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { serverEnv } from "@/lib/env";

const TEAM_DOMAIN = /^[a-z0-9-]+\.cloudflareaccess\.com$/;

// One cached key set per team; jose refetches Cloudflare's rotating keys as needed.
let remote: { team: string; keys: JWTVerifyGetKey } | undefined;

function remoteKeys(team: string): JWTVerifyGetKey {
  if (remote?.team !== team) {
    remote = { team, keys: createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`)) };
  }
  return remote.keys;
}

/** True only for a Cloudflare Access JWT issued by our team for the admin application. */
export async function verifyAccessJwt(
  token: string | null,
  keys?: JWTVerifyGetKey,
): Promise<boolean> {
  const { cfAccessTeamDomain: team, cfAccessAud: aud } = serverEnv();
  if (!token || !team || !aud || !TEAM_DOMAIN.test(team)) return false;
  try {
    await jwtVerify(token, keys ?? remoteKeys(team), {
      issuer: `https://${team}`,
      audience: aud,
      algorithms: ["RS256"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * The admin page sits behind a Cloudflare Access path application; this re-checks the JWT
 * that Access adds, so a request that reached the origin any other way gets a 404.
 */
export async function requireAccess(): Promise<void> {
  const token = (await headers()).get("cf-access-jwt-assertion");
  if (!(await verifyAccessJwt(token))) notFound();
}
```

Run the access tests. Expected: PASS.

- [ ] **Step 5: Subscribers client tests and implementation.** `apps/web/src/lib/subscribers.test.ts` stubs `fetch` and env and covers these cases:
- (a) with `API_INTERNAL_URL=http://api:8000` and `INTERNAL_API_SECRET=s`, `listSubscribers()` GETs `http://api:8000/internal/newsletter/subscribers` with header `X-Internal-Secret: s` and `cache: "no-store"`, and returns the parsed body;
- (b) it returns null when either env var is missing (and fetch is not called), on non-200, on a body that fails the schema, and on a network error;
- (c) `removeSubscriber("0b6f1c1e-0000-4000-8000-000000000001")` sends DELETE to `.../subscribers/0b6f1c1e-…` and is true on 204, false on 500;
- (d) `removeSubscriber("../x")` is false without calling fetch.

```ts
import { z } from "zod";

import { serverEnv } from "@/lib/env";

const SubscriberSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  status: z.enum(["pending", "confirmed"]),
  created_at: z.string(),
  confirmed_at: z.string().nullable(),
});

const SubscriberListSchema = z.object({
  subscribers: z.array(SubscriberSchema),
  totals: z.object({ confirmed: z.number().int(), pending: z.number().int() }),
});

export type Subscriber = z.infer<typeof SubscriberSchema>;
export type SubscriberList = z.infer<typeof SubscriberListSchema>;

const TIMEOUT_MS = 5_000;

function internalApi(): { base: string; headers: Record<string, string> } | null {
  const { apiInternalUrl, internalApiSecret } = serverEnv();
  if (!apiInternalUrl || !internalApiSecret) return null;
  return { base: apiInternalUrl, headers: { "X-Internal-Secret": internalApiSecret } };
}

/** Every subscriber, newest first, from the API over the compose network. Null on any failure. */
export async function listSubscribers(): Promise<SubscriberList | null> {
  const api = internalApi();
  if (!api) return null;
  try {
    const res = await fetch(`${api.base}/internal/newsletter/subscribers`, {
      headers: api.headers,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const parsed = SubscriberListSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function removeSubscriber(id: string): Promise<boolean> {
  const api = internalApi();
  if (!api || !z.uuid().safeParse(id).success) return false;
  try {
    const res = await fetch(`${api.base}/internal/newsletter/subscribers/${id}`, {
      method: "DELETE",
      headers: api.headers,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.status === 204;
  } catch {
    return false;
  }
}
```

The test UUID `0b6f1c1e-0000-4000-8000-000000000001` has version nibble 4 and variant 8, so zod v4's strict `z.uuid()` accepts it.

- [ ] **Step 6: Server action** (`apps/web/src/app/admin/subscribers/actions.ts`)

```ts
"use server";

import { revalidatePath } from "next/cache";

import { requireAccess } from "@/lib/cf-access";
import { removeSubscriber } from "@/lib/subscribers";

// Server actions are public POST endpoints: the Access check runs here too, not only on the page.
export async function removeSubscriberAction(formData: FormData): Promise<void> {
  await requireAccess();
  const id = formData.get("id");
  if (typeof id === "string") await removeSubscriber(id);
  revalidatePath("/admin/subscribers");
}
```

`actions.test.ts` mocks `@/lib/cf-access`, `@/lib/subscribers` and `next/cache`, and covers two cases:
- (a) the access check runs before removal, and removal gets the form's id, then `revalidatePath("/admin/subscribers")`;
- (b) when `requireAccess` rejects (mock it to throw `new Error("NEXT_HTTP_ERROR_FALLBACK;404")`), the action rejects and `removeSubscriber` is never called.

- [ ] **Step 7: Page** (`apps/web/src/app/admin/subscribers/page.tsx`)

```tsx
import type { Metadata } from "next";

import { PageHeader } from "@/components/content/page-header";
import { requireAccess } from "@/lib/cf-access";
import { listSubscribers } from "@/lib/subscribers";

import { removeSubscriberAction } from "./actions";

export const metadata: Metadata = {
  title: "Subscribers",
  robots: { index: false, follow: false },
};

const cell = "px-4 py-2";
const day = (iso: string) => iso.slice(0, 10);

export default async function SubscribersPage() {
  await requireAccess();
  const list = await listSubscribers();
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <PageHeader prompt="$ newsletter ls" title="Subscribers" />
      {list === null ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Couldn&apos;t load subscribers. Check that the API is up and INTERNAL_API_SECRET is set.
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm text-foreground">
            {list.totals.confirmed} confirmed · {list.totals.pending} pending
          </p>
          {list.subscribers.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No subscribers yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-[10px] border border-border bg-card">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className={`${cell} font-medium`}>Email</th>
                    <th scope="col" className={`${cell} font-medium`}>Status</th>
                    <th scope="col" className={`${cell} font-medium`}>Signed up</th>
                    <th scope="col" className={`${cell} font-medium`}>Confirmed</th>
                    <th scope="col" className={cell}>
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.subscribers.map((s) => (
                    <tr key={s.id} className="border-t border-border">
                      <td className={`${cell} break-all font-mono text-xs`}>{s.email}</td>
                      <td className={cell}>{s.status}</td>
                      <td className={cell}>{day(s.created_at)}</td>
                      <td className={cell}>{s.confirmed_at ? day(s.confirmed_at) : "–"}</td>
                      <td className={`${cell} text-right`}>
                        <form action={removeSubscriberAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <button
                            type="submit"
                            aria-label={`Remove ${s.email}`}
                            className="rounded-md border border-input px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand"
                          >
                            Remove
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

`page.test.tsx` (jsdom) mocks `@/lib/cf-access`, `@/lib/subscribers` and `./actions`. It covers four cases:
- (a) when `requireAccess` rejects, the page rejects and `listSubscribers` is never called (the 404 happens before any data is read);
- (b) with two subscribers, the page renders `1 confirmed · 1 pending`, both emails, a dash for the unconfirmed date, and buttons named `Remove ada@example.com` / `Remove bo@example.com`, each inside a form with a hidden `id` input;
- (c) a null list shows the "Couldn't load subscribers" message;
- (d) `metadata.robots` is noindex.

- [ ] **Step 8: Robots.** In `apps/web/src/app/robots.ts`, set `disallow: ["/api/", "/admin"]`, and update `robots.test.ts` to expect that array.

- [ ] **Step 9: Checks.** Run lint, typecheck, test and format, then `pnpm --dir apps/web build` (timeout 600 s, no env vars) to confirm the build still passes with nothing configured. Run e2e once (as in Task 5) to confirm nothing regressed. **Commit** `feat(web): private subscriber admin page behind Cloudflare Access`.

---
### Task 8: Directus post fields and the "Email to subscribers" Flow

**Files:**
- Modify: `infra/directus/schema.mjs`, `infra/directus/lib.mjs`, `infra/directus/bootstrap.mjs`
- Test: `infra/directus/lib.test.mjs`

**Interfaces:**
- Consumes: Task 4's `POST http://api:8000/internal/newsletter/send` contract (string-tolerant `post_id`/`test`; a 200 body with `status`, `sent_at` and `recipients`).
- Produces:
  - The fields `posts.emailed_at` (timestamp, read-only) and `posts.emailed_count` (integer, read-only).
  - `newsletterFlow(internalSecret)` in `lib.mjs`.
  - The Directus Flow "Email to subscribers".

- [ ] **Step 1: Tests.** Append to `infra/directus/lib.test.mjs` (add `newsletterFlow` to the `./lib.mjs` import):

```js
test("posts declares read-only emailed_at and emailed_count", () => {
  const posts = collections.find((c) => c.collection === "posts");
  for (const [field, type] of [
    ["emailed_at", "timestamp"],
    ["emailed_count", "integer"],
  ]) {
    const f = posts.fields.find((x) => x.field === field);
    assert.ok(f, field);
    assert.equal(f.type, type);
    assert.equal(f.meta.readonly, true);
    assert.equal(f.schema.is_nullable, true);
  }
});

test("planSchema adds only the two newsletter fields to an existing instance", () => {
  const before = collections.map((c) =>
    c.collection === "posts"
      ? { ...c, fields: c.fields.filter((f) => !f.field.startsWith("emailed_")) }
      : c,
  );
  const existing = apply(EMPTY, planSchema(EMPTY, before));
  const ops = planSchema(existing, collections);
  assert.deepEqual(
    ops.map((o) => [o.type, o.collection, o.field]),
    [
      ["field", "posts", "emailed_at"],
      ["field", "posts", "emailed_count"],
    ],
  );
});

test("newsletterFlow: manual Flow on posts, send -> check -> record", () => {
  const spec = newsletterFlow("sek");
  assert.equal(spec.flow.name, "Email to subscribers");
  assert.equal(spec.flow.trigger, "manual");
  assert.deepEqual(spec.flow.options.collections, ["posts"]);
  assert.equal(spec.flow.options.location, "item");
  assert.equal(spec.flow.options.requireConfirmation, true);
  assert.deepEqual(
    spec.flow.options.fields.map((f) => [f.field, f.type, f.name]),
    [["test_only", "boolean", "Send a test to me only"]],
  );
  assert.deepEqual(
    spec.operations.map((o) => [o.key, o.type]),
    [
      ["send", "request"],
      ["check", "condition"],
      ["record", "item-update"],
    ],
  );
  const [send, check, record] = spec.operations;
  assert.equal(send.options.method, "POST");
  assert.equal(send.options.url, "http://api:8000/internal/newsletter/send");
  assert.deepEqual(send.options.headers, [
    { header: "X-Internal-Secret", value: "sek" },
    { header: "Content-Type", value: "application/json" },
  ]);
  // Valid JSON whatever Directus fills in, including an untouched checkbox ("").
  for (const testOnly of ["true", "false", ""]) {
    const body = send.options.body
      .replace("{{$trigger.body.keys[0]}}", "12")
      .replace("{{$trigger.body.test_only}}", testOnly);
    assert.deepEqual(JSON.parse(body), { post_id: "12", test: testOnly });
  }
  assert.deepEqual(check.options.filter, { send: { data: { status: { _eq: "complete" } } } });
  assert.equal(record.options.collection, "posts");
  assert.deepEqual(record.options.key, ["{{$trigger.body.keys[0]}}"]);
  assert.deepEqual(record.options.payload, {
    emailed_at: "{{send.data.sent_at}}",
    emailed_count: "{{send.data.recipients}}",
  });
  assert.equal(record.options.permissions, "$full");
  assert.equal(record.options.emitEvents, false);
  assert.deepEqual(spec.chain, { send: "check", check: "record" });
});
```

`apply` and `EMPTY` already exist in that test file.

- [ ] **Step 2: Run** `node --test infra/directus/lib.test.mjs`. Expected: FAIL.

- [ ] **Step 3: Schema.** In `infra/directus/schema.mjs`, add after `function file(...)`:

```js
/** Set only by the "Email to subscribers" Flow; shown on the post, never editable. */
function emailed(field, type, iface) {
  return {
    field,
    type,
    meta: { interface: iface, readonly: true, width: "half", note: "Set by Email to subscribers." },
    schema: { is_nullable: true },
  };
}
```

and append to the `posts` fields (after `file("cover", "file-image")`):

```js
      emailed("emailed_at", "timestamp", "datetime"),
      emailed("emailed_count", "integer", "input"),
```

- [ ] **Step 4: Flow spec in `lib.mjs`** (before `export class DirectusClient`):

```js
const NEWSLETTER_SEND_URL = "http://api:8000/internal/newsletter/send";

/**
 * The manual "Email to subscribers" Flow on posts. "send" POSTs the post id and the
 * checkbox to the API; "check" passes only a completed real send (not a test or a
 * partial send); "record" copies the API's sent_at and recipients onto the post.
 * Directus fills {{...}} in a body as text, so both values are quoted strings and the
 * API accepts "12" and "true". chain maps each operation key to the one it resolves to.
 */
export function newsletterFlow(internalSecret) {
  return {
    flow: {
      name: "Email to subscribers",
      icon: "mail",
      status: "active",
      trigger: "manual",
      accountability: "all",
      options: {
        collections: ["posts"],
        location: "item",
        requireConfirmation: true,
        confirmationDescription:
          "Email this post to every confirmed subscriber. Tick the box to send only a test to yourself.",
        fields: [
          {
            field: "test_only",
            type: "boolean",
            name: "Send a test to me only",
            meta: { interface: "boolean", width: "full" },
          },
        ],
      },
    },
    operations: [
      {
        key: "send",
        name: "Send",
        type: "request",
        position_x: 19,
        position_y: 1,
        options: {
          method: "POST",
          url: NEWSLETTER_SEND_URL,
          headers: [
            { header: "X-Internal-Secret", value: internalSecret },
            { header: "Content-Type", value: "application/json" },
          ],
          body: '{"post_id":"{{$trigger.body.keys[0]}}","test":"{{$trigger.body.test_only}}"}',
        },
      },
      {
        key: "check",
        name: "Completed?",
        type: "condition",
        position_x: 37,
        position_y: 1,
        options: { filter: { send: { data: { status: { _eq: "complete" } } } } },
      },
      {
        key: "record",
        name: "Record on post",
        type: "item-update",
        position_x: 55,
        position_y: 1,
        options: {
          collection: "posts",
          key: ["{{$trigger.body.keys[0]}}"],
          payload: {
            emailed_at: "{{send.data.sent_at}}",
            emailed_count: "{{send.data.recipients}}",
          },
          permissions: "$full",
          emitEvents: false,
        },
      },
    ],
    chain: { send: "check", check: "record" },
  };
}
```

- [ ] **Step 5: Bootstrap.**
  - In `bootstrap.mjs`, import `newsletterFlow` from `./lib.mjs` and add the function below after `ensureReindex`.
  - In `main()`, call `await ensureNewsletterFlow(api, internalSecret);` inside the existing `if (internalSecret) { … }` block, after `ensureReindex`.
  - Change that block's `else` log to `"flow: reindex step and newsletter flow skipped (INTERNAL_API_SECRET not set)"`.
  - Update the header comment's list to mention "the newsletter Flow".

```js
async function ensureNewsletterFlow(api, internalSecret) {
  const spec = newsletterFlow(internalSecret);
  const changes = [];
  let flow = await findOne(api, "/flows", { name: { _eq: spec.flow.name } });
  if (!flow) {
    flow = await api.post("/flows", spec.flow);
    changes.push("created");
  } else if (!sameJson(flow.options, spec.flow.options)) {
    await api.patch(`/flows/${flow.id}`, { options: spec.flow.options });
    changes.push("trigger synced");
  }
  const ops = {};
  for (const op of spec.operations) {
    let row = await findOne(api, "/operations", { flow: { _eq: flow.id }, key: { _eq: op.key } });
    if (!row) {
      row = await api.post("/operations", { ...op, flow: flow.id });
      changes.push(`${op.key} created`);
    } else if (!sameJson(row.options, op.options)) {
      row = await api.patch(`/operations/${row.id}`, { options: op.options });
      changes.push(`${op.key} synced`);
    }
    ops[op.key] = row;
  }
  for (const [from, to] of Object.entries(spec.chain)) {
    if (ops[from].resolve !== ops[to].id) {
      await api.patch(`/operations/${ops[from].id}`, { resolve: ops[to].id });
      changes.push(`${from} -> ${to}`);
    }
  }
  if (flow.operation !== ops.send.id) {
    await api.patch(`/flows/${flow.id}`, { operation: ops.send.id });
    changes.push("entry set");
  }
  console.log(`newsletter flow: ${changes.length ? changes.join(", ") : "exists"}`);
}
```

- [ ] **Step 6: Run** `node --test infra/directus/lib.test.mjs`. Expected: all pass, including the existing test "planSchema on its own result plans nothing (real schema)". Run `pnpm --dir apps/web exec prettier --check ../../infra/directus` if the repo's prettier covers `infra/directus` (check `.prettierignore`). Otherwise match the file's existing formatting by hand.

- [ ] **Step 7: Dev-stack idempotency.** Run `make up` (timeout 600 s), then `make cms-bootstrap` twice (timeout 180 s each).
  - First run: `schema: 2 created` (on a stack that already had posts) and `newsletter flow: created, send created, check created, record created, send -> check, check -> record, entry set`.
  - Second run: `schema: 0 created` and `newsletter flow: exists`.
  - If the second run reports `synced`, Directus normalized an options object differently. Log both objects locally (do not commit the logging) and make the spec match what Directus stores, so the second run is clean.
  - Record both outputs in the report.

- [ ] **Step 8: Commit** `feat(cms): emailed fields on posts and the Email to subscribers Flow`.

---

### Task 9: Infra wiring, Grafana and docs

**Files:**
- Create: `infra/postgres/init/02-grafana-umami-ro.sh` (executable), `infra/observability/grafana/provisioning/datasources/umami.yml`, `infra/observability/grafana/dashboards/newsletter.json`
- Modify: `infra/compose/compose.yaml`, `infra/compose/prod.env.example`, `scripts/deploy.sh`, `infra/observability/grafana/provisioning/alerting/rules.yml`, `.github/workflows/ci.yml`, `docs/runbook.md`, `docs/setup.md`, `docs/security.md`

**Interfaces:**
- Consumes: the metric names from Task 3, the Umami `website_event` table, and Task 7's web env names.
- Produces:
  - The optional secrets `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` and `GRAFANA_UMAMI_DB_PASSWORD`.
  - The `grafana_umami_ro` role, the `umami-readonly` data source, the `newsletter` dashboard, and the alert `newsletter-send-failed`.

- [ ] **Step 1: Compose.** In `infra/compose/compose.yaml`:
  - `postgres.environment` add `GRAFANA_UMAMI_DB_PASSWORD: ${GRAFANA_UMAMI_DB_PASSWORD:-}`.
  - `web.environment` add:

```yaml
      # Blog subscriptions admin page: internal API calls and the Cloudflare Access check.
      INTERNAL_API_SECRET: ${INTERNAL_API_SECRET:-}
      CF_ACCESS_TEAM_DOMAIN: ${CF_ACCESS_TEAM_DOMAIN:-}
      CF_ACCESS_AUD: ${CF_ACCESS_AUD:-}
```

  - `grafana.environment` add, under the `CONTACT_TO` lines:

```yaml
      # Read by provisioning/datasources/umami.yml (Newsletter visits per post).
      GRAFANA_UMAMI_DB_PASSWORD: ${GRAFANA_UMAMI_DB_PASSWORD:-}
```

  Confirm `grafana` can reach `postgres` (same compose network; check the `networks:` keys of both services). If grafana is on a separate network, add it to postgres's network and note why in a comment.

  In `infra/compose/prod.env.example`, append to the "Optional in prod.enc.env" block:

```
# Blog subscriptions admin page (docs/setup.md, Newsletter): the Cloudflare Access team
# domain (<team>.cloudflareaccess.com) and the /admin application's AUD tag. Not secret.
CF_ACCESS_TEAM_DOMAIN=
CF_ACCESS_AUD=
# Password for the read-only grafana_umami_ro role behind the Newsletter visits panel
# (openssl rand -hex 24). Empty: the role is not created and that panel shows an error.
GRAFANA_UMAMI_DB_PASSWORD=
```

  Run `make prod-config` (timeout 120 s). Expected: it validates.

- [ ] **Step 2: Role script** `infra/postgres/init/02-grafana-umami-ro.sh`:

```bash
#!/usr/bin/env bash
# Read-only login for Grafana's "Newsletter visits per post" panel: SELECT on Umami's
# website_event table and nothing else. Idempotent. It runs as an init script on a fresh
# data directory and again on every deploy (scripts/deploy.sh), which covers the existing
# database, a changed password, and the grant once Umami has created its tables.
# Skipped while GRAFANA_UMAMI_DB_PASSWORD is unset. Must stay executable: the postgres
# entrypoint sources non-executable init scripts, and the exit below would end it.
set -euo pipefail

if [[ -z "${GRAFANA_UMAMI_DB_PASSWORD:-}" ]]; then
  echo "grafana_umami_ro: skipped (GRAFANA_UMAMI_DB_PASSWORD not set)"
  exit 0
fi

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname umami \
  --set=pw="${GRAFANA_UMAMI_DB_PASSWORD}" <<'SQL'
SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grafana_umami_ro') AS missing \gset
\if :missing
CREATE ROLE grafana_umami_ro;
\endif
ALTER ROLE grafana_umami_ro WITH LOGIN CONNECTION LIMIT 3 PASSWORD :'pw';
GRANT CONNECT ON DATABASE umami TO grafana_umami_ro;
SELECT to_regclass('public.website_event') IS NOT NULL AS has_events \gset
\if :has_events
GRANT SELECT ON public.website_event TO grafana_umami_ro;
\else
\echo 'grafana_umami_ro: website_event does not exist yet; the next deploy grants it'
\endif
SQL
echo "grafana_umami_ro: ok"
```

Make it executable in git: `chmod +x infra/postgres/init/02-grafana-umami-ro.sh && git add --chmod=+x infra/postgres/init/02-grafana-umami-ro.sh`. Run `shellcheck infra/postgres/init/02-grafana-umami-ro.sh` (or the CI shellcheck invocation). Expected: clean.

- [ ] **Step 3: Deploy step.** In `scripts/deploy.sh`, after the `compose up -d --wait --wait-timeout 180 --remove-orphans ${SERVICES}` line and before `echo "==> CMS bootstrap"`:

```bash
echo "==> Grafana read-only Umami role"
compose exec -T postgres /docker-entrypoint-initdb.d/02-grafana-umami-ro.sh
```

The password lives only in the postgres container's environment. The deploy shell never sees it.

Dev-stack check (timeout 120 s each). The dev postgres has no `GRAFANA_UMAMI_DB_PASSWORD`, so pass it for the check only:
- `docker compose -f infra/compose/compose.dev.yaml exec -T -e GRAFANA_UMAMI_DB_PASSWORD=devpass postgres /docker-entrypoint-initdb.d/02-grafana-umami-ro.sh`. Run it twice. Expected: both print `grafana_umami_ro: ok`, plus the "does not exist yet" notice, because dev has no Umami tables.
- Run it once without `-e`. Expected: `skipped`.
- Then confirm the role's reach: `docker compose -f infra/compose/compose.dev.yaml exec -T postgres psql -U postgres -d umami -c "SELECT has_database_privilege('grafana_umami_ro','umami','CONNECT'), has_database_privilege('grafana_umami_ro','umami','CREATE');"`. Expected: `t | f`.
- Record the outputs in the report. Leave the role in place; Task 10 uses it.

- [ ] **Step 4: Grafana data source** `infra/observability/grafana/provisioning/datasources/umami.yml` (no dollar sign anywhere except the one password line):

```yaml
apiVersion: 1

# Read-only view of Umami's events for the Newsletter dashboard's visits panel. Logs in
# as grafana_umami_ro (SELECT on website_event only; infra/postgres/init/02-grafana-umami-ro.sh).
# Until GRAFANA_UMAMI_DB_PASSWORD is set the login fails and only that panel shows an error.
datasources:
  - name: umami-readonly
    uid: umami-readonly
    type: grafana-postgresql-datasource
    access: proxy
    url: postgres:5432
    user: grafana_umami_ro
    editable: false
    jsonData:
      database: umami
      sslmode: disable
      postgresVersion: 1700
      maxOpenConns: 2
      timescaledb: false
    secureJsonData:
      password: ${GRAFANA_UMAMI_DB_PASSWORD}
```

- [ ] **Step 5: Alert rule.** Append to the `rules:` list in `provisioning/alerting/rules.yml`, matching the existing indentation:

```yaml
      - uid: newsletter-send-failed
        title: Newsletter send failed
        condition: C
        data:
          - refId: A
            relativeTimeRange: { from: 900, to: 0 }
            datasourceUid: prometheus
            model:
              refId: A
              instant: true
              expr: sum(increase(newsletter_emails_total{kind="post", result="failed"}[15m]))
          - refId: C
            datasourceUid: __expr__
            model:
              refId: C
              type: threshold
              expression: A
              conditions:
                - evaluator: { type: gt, params: [0] }
        noDataState: OK
        execErrState: Error
        for: 0s
        annotations:
          summary: Some newsletter emails were not sent (often Resend's daily limit of 100). Open the post in Directus and click Email to subscribers again, today or tomorrow; it only emails people who have not got it.
        labels:
          severity: warning
```

Update the header comment "The eight Phase 6/7 alerts" to "The nine alerts (Phase 6/7 and the newsletter)".

- [ ] **Step 6: CI.** In `.github/workflows/ci.yml` ("Grafana provisioning and dashboards parse"):
  - Change `[[ "${rules}" == 8 ]] || { echo "expected 8 alert rules, found ${rules}"; exit 1; }` to use `9` in both places.
  - Change the dollar guard to allow exactly the two intended variables:

```bash
          # Grafana expands $VAR in every provisioning file; the only intended uses are
          # ${CONTACT_TO} and ${GRAFANA_UMAMI_DB_PASSWORD}.
          if grep -n '\$' infra/observability/grafana/provisioning/*/*.yml \
              | grep -v '\${CONTACT_TO}' | grep -v '\${GRAFANA_UMAMI_DB_PASSWORD}'; then
```

  Run that whole CI step's script locally (it uses docker for `yq`; timeout 180 s). Expected: `grafana provisioning ok`.

- [ ] **Step 7: Dashboard** `infra/observability/grafana/dashboards/newsletter.json`:

```json
{
  "uid": "newsletter",
  "title": "Newsletter",
  "tags": ["portfolio", "newsletter"],
  "timezone": "America/New_York",
  "schemaVersion": 41,
  "version": 1,
  "editable": false,
  "refresh": "5m",
  "time": { "from": "now-30d", "to": "now" },
  "panels": [
    {
      "id": 1,
      "type": "stat",
      "title": "Confirmed subscribers",
      "gridPos": { "h": 4, "w": 6, "x": 0, "y": 0 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "sum(newsletter_subscribers{status=\"confirmed\"})", "instant": true }],
      "fieldConfig": { "defaults": { "noValue": "0", "decimals": 0 }, "overrides": [] },
      "options": { "colorMode": "none", "graphMode": "none", "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 2,
      "type": "stat",
      "title": "Pending (awaiting confirm)",
      "gridPos": { "h": 4, "w": 6, "x": 6, "y": 0 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "sum(newsletter_subscribers{status=\"pending\"})", "instant": true }],
      "fieldConfig": { "defaults": { "noValue": "0", "decimals": 0 }, "overrides": [] },
      "options": { "colorMode": "none", "graphMode": "none", "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 3,
      "type": "stat",
      "title": "Post emails sent (time range)",
      "gridPos": { "h": 4, "w": 6, "x": 12, "y": 0 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "sum(increase(newsletter_emails_total{kind=\"post\", result=\"sent\"}[$__range]))", "instant": true }],
      "fieldConfig": { "defaults": { "noValue": "0", "decimals": 0 }, "overrides": [] },
      "options": { "colorMode": "none", "graphMode": "none", "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 4,
      "type": "stat",
      "title": "Post emails failed (time range)",
      "gridPos": { "h": 4, "w": 6, "x": 18, "y": 0 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "sum(increase(newsletter_emails_total{kind=\"post\", result=\"failed\"}[$__range]))", "instant": true }],
      "fieldConfig": {
        "defaults": {
          "noValue": "0",
          "decimals": 0,
          "color": { "mode": "thresholds" },
          "thresholds": { "mode": "absolute", "steps": [{ "color": "green", "value": null }, { "color": "red", "value": 1 }] }
        },
        "overrides": []
      },
      "options": { "colorMode": "value", "graphMode": "none", "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 5,
      "type": "timeseries",
      "title": "Subscribers over time",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 4 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "sum by (status) (newsletter_subscribers)", "legendFormat": "{{status}}" }],
      "fieldConfig": { "defaults": { "decimals": 0, "custom": { "fillOpacity": 15 } }, "overrides": [] },
      "options": { "legend": { "displayMode": "list", "placement": "bottom" } }
    },
    {
      "id": 6,
      "type": "timeseries",
      "title": "Subscribes, confirmations and unsubscribes (per week)",
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 4 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "interval": "1d",
      "targets": [
        { "refId": "A", "expr": "sum(increase(newsletter_subscribe_requests_total{result=\"accepted\"}[1w]))", "legendFormat": "Subscribe requests" },
        { "refId": "B", "expr": "sum(increase(newsletter_confirmations_total[1w]))", "legendFormat": "Confirmations" },
        { "refId": "C", "expr": "sum(increase(newsletter_unsubscribes_total[1w]))", "legendFormat": "Unsubscribes" }
      ],
      "fieldConfig": { "defaults": { "decimals": 0, "custom": { "drawStyle": "bars", "fillOpacity": 60 } }, "overrides": [] },
      "options": { "legend": { "displayMode": "list", "placement": "bottom" } }
    },
    {
      "id": 7,
      "type": "timeseries",
      "title": "Post emails per hour (sent and failed)",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 12 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "interval": "1h",
      "targets": [{ "refId": "A", "expr": "sum by (result) (increase(newsletter_emails_total{kind=\"post\"}[1h]))", "legendFormat": "{{result}}" }],
      "fieldConfig": { "defaults": { "decimals": 0, "custom": { "drawStyle": "bars", "fillOpacity": 60 } }, "overrides": [] },
      "options": { "legend": { "displayMode": "list", "placement": "bottom" } }
    },
    {
      "id": 8,
      "type": "bargauge",
      "title": "Newsletter visits per post",
      "description": "Distinct Umami sessions that arrived from a newsletter link (utm_source=newsletter), by post slug, in the dashboard's time range.",
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 12 },
      "datasource": { "type": "grafana-postgresql-datasource", "uid": "umami-readonly" },
      "targets": [
        {
          "refId": "A",
          "format": "table",
          "rawQuery": true,
          "editorMode": "code",
          "rawSql": "SELECT utm_campaign AS post, COUNT(DISTINCT session_id) AS visits\nFROM website_event\nWHERE utm_source = 'newsletter'\n  AND utm_campaign IS NOT NULL\n  AND $__timeFilter(created_at)\nGROUP BY utm_campaign\nORDER BY visits DESC\nLIMIT 20"
        }
      ],
      "fieldConfig": {
        "defaults": { "decimals": 0, "min": 0, "noValue": "No newsletter visits yet" },
        "overrides": [
          { "matcher": { "id": "byName", "options": "visits" }, "properties": [{ "id": "displayName", "value": "${__data.fields.post}" }] }
        ]
      },
      "options": {
        "orientation": "horizontal",
        "displayMode": "gradient",
        "showUnfilled": true,
        "reduceOptions": { "values": true, "calcs": [], "fields": "/^visits$/" },
        "text": {}
      }
    }
  ]
}
```

The `displayName` override labels each bar with its post slug. Dollar signs are fine in dashboard JSON; the CI guard covers only provisioning YAML.

Column names: confirm `utm_source`, `utm_campaign`, `session_id` and `created_at` exist in Umami 3.4.0's `website_event` (Task 10 checks this against a real Umami schema). If Umami 3.4.0 keeps UTM values only in `url_query`, use instead:
`SELECT substring(url_query from 'utm_campaign=([^&]+)') AS post, COUNT(DISTINCT session_id) AS visits FROM website_event WHERE url_query LIKE '%utm_source=newsletter%' AND $__timeFilter(created_at) GROUP BY 1 HAVING substring(url_query from 'utm_campaign=([^&]+)') IS NOT NULL ORDER BY visits DESC LIMIT 20`.

Run `jq -e '(.uid | type == "string") and (.panels | length > 0)' infra/observability/grafana/dashboards/newsletter.json`. Expected: `true`.

- [ ] **Step 8: Docs.**
  - **`docs/setup.md`:** add `## Newsletter (blog subscriptions)` after "Cloudflare WAF rules (Phase 7)", containing the spec's "Chris's setup (after merge)" steps 1–3 written out as numbered instructions (Access path app for `christopherguzman.me/admin` with the same policy as `cms.`, copy the AUD tag and team domain; `make secrets-edit` to add the three optional keys, `GRAFANA_UMAMI_DB_PASSWORD` from `openssl rand -hex 24`; commit, PR, merge; test send). Add one line noting that all three are optional and what stays off without each.
  - **`docs/runbook.md`:** add `## Newsletter` after "Contact messages", covering:
    - **Send a post:** open a published post in Directus, then Email to subscribers. Send a test first (tick the box); it goes to CONTACT_TO. Then send for real (box unticked).
    - **After a real send** `emailed_at` and `emailed_count` fill in. If they stay empty, the send was partial (Resend's free plan allows 100 emails a day and 3,000 a month), and the "Newsletter send failed" alert emails you. Click the button again later; it only emails subscribers who have not got the post. A post already sent answers `already_sent`.
    - **Remove a subscriber:** `https://christopherguzman.me/admin/subscribers` (Cloudflare Access).
    - **Secret rotation:** rotating `INTERNAL_API_SECRET` breaks unsubscribe links in emails already sent. Those readers can still unsubscribe from any newer email, or ask Chris to remove them.
    - **Umami upgrades:** after a major Umami upgrade, check the "Newsletter visits per post" panel; Umami may rename `website_event` columns.
    - **Grafana history:** subscriber trend history goes back as far as Prometheus retention (35 days). The admin page shows every sign-up date.
  - **`docs/security.md`:** under Controls, add a "Blog subscriptions" bullet group:
    - double opt-in with sha256-stored confirm tokens (7-day expiry)
    - stateless HMAC unsubscribe tokens (key derived from `INTERNAL_API_SECRET`)
    - the same response for every address (no list enumeration), and confirmation emails sent after the response (no timing signal)
    - Turnstile plus the per-client and per-address limits
    - link pages POST from the browser, so mail scanners' GETs do nothing
    - `/admin/subscribers` behind a Cloudflare Access path app, with the JWT re-verified server-side (404 otherwise), also inside the server action
    - internal endpoints refuse tunnel traffic
    - `grafana_umami_ro` can read only `website_event`
    - no open pixels or click tracking

    Under Accepted trade-offs, add: link tokens appear in the confirm and unsubscribe page URLs, so Umami (private, behind Access) may record them in page-view URLs. A leaked unsubscribe token can only unsubscribe that one reader.

- [ ] **Step 9: Checks.** Run shellcheck on `scripts/deploy.sh` and the new script, `make prod-config`, and the Grafana CI step script. **Commit** `feat(infra): newsletter dashboard, alert, read-only Umami role and docs`.

---

### Task 10: Dev-stack verification (controller)

The controller runs this, not an implementer subagent. It needs the running dev stack and judgment about results. Record every output in `.superpowers/sdd/newsletter/verify.md`.

- [ ] **Step 1: Suites.**
  - API: `cd apps/api && uv run pytest -q` (timeout 600 s), `uv run ruff check .`, `uv run pyright`, `uv run alembic check`.
  - Web: `pnpm --dir apps/web lint && pnpm --dir apps/web typecheck && pnpm --dir apps/web test`, then `pnpm --dir apps/web build` (no env) and `pnpm --dir apps/web test:e2e` (timeouts 600 s).
  - Directus: `node --test infra/directus/lib.test.mjs`.

- [ ] **Step 2: Umami schema and the visits query.** Run Umami 3.4.0 once against the dev `umami` database so it creates its tables. Use the pinned digest from `compose.yaml`, on the dev compose network, with `DATABASE_URL=postgresql://umami:umami@postgres:5432/umami` and `APP_SECRET=dev`. Detach it, wait for its migration log line, then stop it. Then:
  - `\d website_event` must list `utm_source`, `utm_campaign`, `session_id` and `created_at`. If it does not, switch the panel to the `url_query` query from Task 9 Step 7.
  - Re-run the role script (Task 9 Step 3 command, with `-e GRAFANA_UMAMI_DB_PASSWORD=devpass`). It must now grant (no "does not exist yet" notice).
  - As `grafana_umami_ro` (`PGPASSWORD=devpass psql -h 127.0.0.1 -U grafana_umami_ro -d umami` inside the postgres container), the panel's SQL runs, with `$__timeFilter(created_at)` replaced by `created_at > now() - interval '30 days'`, and returns 0 rows.
  - `SELECT * FROM session LIMIT 1` fails with `permission denied`.

- [ ] **Step 3: The Flow end to end with zero subscribers.**
  1. Recreate the dev `api` with `API_RESEND_API_KEY=re_dummy` and `API_TURNSTILE_SECRET=dummy` (a compose override file in the scratchpad; never a `.env` file). The newsletter service then exists, and a send with no subscribers makes no Resend call.
  2. With an admin token, create a published test post (`POST /items/posts`).
  3. Trigger the Flow: `POST http://localhost:8055/flows/trigger/<flow id>` with `{"collection":"posts","keys":[<id>],"test_only":false}`.
  4. Expect the post's `emailed_at` to be set and `emailed_count` to be `0`.
  5. Trigger again. The Flow must report a failure (409 `already_sent`), and the post must be unchanged.
  6. Trigger with `"test_only": true`. The API reaches Resend with the dummy key and answers 502 `send_failed`, which proves the test flag parsed as true and nothing was recorded.
  7. Clean up: delete the test post and the `newsletter_sends` row, and recreate `api` without the override.
  8. Record what the Directus UI or API reported for each trigger. The runbook's description of success and failure must match what was observed; fix the runbook if not.

- [ ] **Step 4: Final whole-branch review**, per subagent-driven-development, on the most capable model, with the Minor-findings list from the ledger.

- [ ] **Step 5: PR** from `feat/newsletter` to `main` with a summary, the three deviations, test evidence and Chris's setup steps. Merge only when Chris says so.

- [ ] **Step 6: After merge and deploy:**
  - Live checks:
    - `/blog` shows the box, and `/` shows it under the latest posts (when posts exist).
    - Mobile Lighthouse on `/` stays ≥ 95, and Turnstile is absent from the network log until the email field is focused.
    - 0 CSP violations.
  - Guide Chris through docs/setup.md "Newsletter".
  - After his secrets PR, check:
    - `/admin/subscribers` loads behind Access, and the origin without the Access JWT returns 404.
    - The visits panel queries without error.
    - A real subscribe → confirm email → confirm page.
    - His test send from Directus arrives with working links and a one-click unsubscribe header.
