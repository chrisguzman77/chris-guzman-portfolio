# Phase 7a: Engineering Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the site launch-ready. That means an enforced nonce-based CSP and security headers on the site and the API, mobile Lighthouse ≥ 95 on `/`, zero axe violations, and a Playwright visitor journey in CI. It also means clearing the 49 in-scope backlog items from the 2026-10-06 audit.

**Architecture:**
- **Web:** a Next 16 `src/proxy.ts` generates a per-request nonce and sets the CSP. Static headers come from `next.config.ts`. The API gets one ASGI middleware for its headers.
- **E2E:** Playwright runs against the standalone production build. One fake backend (a Node HTTP server) stands in for both Directus and the API, so CI needs none of our services.
- **Backlog:** the work splits into three tracks with disjoint files (API, Web, Infra/docs), each in its own worktree, merged by an integration task.

**Tech Stack:** Next.js 16.3, React 19.3, TypeScript, vitest, `@playwright/test` + `@axe-core/playwright`; FastAPI, pytest, ruff, pyright (via `uv`); bash, Docker Compose, GitHub Actions, Grafana/Prometheus provisioning.

**Spec:** `docs/superpowers/specs/2026-10-06-phase-7a-engineering-polish-design.md` is binding; this plan implements it. Backlog item text lives in the spec's tables. The original finding behind each item (with file and line detail) is in the phase ledgers `.superpowers/sdd/phase{2,3,4,5,6}/progress.md` and `.superpowers/sdd/phase7/audit.md`. Every backlog task tells its implementer to grep those ledgers for the item before changing code.

## Global Constraints

- **CSP:** enforced, nonce-based, built per request in `src/proxy.ts`, with exactly these directives in this order:
  - `default-src 'self'`
  - `script-src 'self' 'nonce-{N}' 'strict-dynamic' https://challenges.cloudflare.com`, plus ` 'unsafe-eval'` only when `NODE_ENV !== "production"`
  - `style-src 'self' 'unsafe-inline'`
  - `img-src 'self' data: blob:`
  - `font-src 'self'`
  - `connect-src 'self' {API origin from PUBLIC_API_URL} https://challenges.cloudflare.com`
  - `frame-src https://challenges.cloudflare.com`
  - `object-src 'self'`
  - `base-uri 'none'`
  - `form-action 'self'`
  - `frame-ancestors 'none'`
  - `upgrade-insecure-requests`, only when `SITE_URL` is https
  - Directives are joined with `"; "`.
- **Nonce:** 16 random bytes, base64. The proxy sets it on the request as `x-nonce` and sets `Content-Security-Policy` on both the request and the response.
- **Proxy matcher:** excludes `_next/static`, `_next/image`, `favicon.ico`, `cms-assets`, `stats`, `api` and `.well-known`, plus prefetch requests.
- **Static web headers on every route:**
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
  - `Cross-Origin-Opener-Policy: same-origin`
  - Also set `poweredByHeader: false`.
- **API headers on every response:**
  - `X-Content-Type-Options: nosniff`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `Referrer-Policy: no-referrer`
  - `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
  - `Cross-Origin-Resource-Policy: same-site`
- **CORS:** `allow_headers=["Content-Type", "X-Request-ID"]`, `expose_headers=["X-Request-ID"]`; origins unchanged.
- **`security.txt`:** at `apps/web/public/.well-known/security.txt` with these lines:
  - `Contact: mailto:chguzman@augusta.edu`
  - `Expires: 2027-10-06T00:00:00.000Z`
  - `Preferred-Languages: en`
  - `Canonical: https://christopherguzman.me/.well-known/security.txt`
  - A vitest fails when fewer than 30 days remain before `Expires`.
- **Performance and accessibility targets:** mobile Lighthouse Performance ≥ 95 on `/`, and every other page stays ≥ 95. axe reports 0 violations on every page in both themes.
- **Out of scope:** W5 (print stylesheet), W6 (loading skeletons), A12 (recruiter FAQ, moves to 7b).
- **Credential switches stay backward compatible:**
  - New credentials `DIRECTUS_BOOTSTRAP_TOKEN`, `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` are optional (`:-` in compose).
  - When they are unset, the old path (admin email/password, `GITHUB_RUNNER_TOKEN` PAT) still works.
  - That lets the PR deploy before Chris adds them.
- **Phase 3 web rules still bind:**
  - no emojis
  - Lucide icons
  - semantic Tailwind tokens only (no raw hex)
  - dark default theme
  - `pnpm build` passes with no env vars set
- **Before the final checks of a task:**
  - API: `uv run ruff format .` and `uv run ruff check --fix .`
  - Web: `pnpm --dir apps/web format:write` on your files if `pnpm format` fails.
- **Secrets and tooling:**
  - Never read or write `.env*`.
  - Never run sops or `make secrets-*`.
  - Python only via `uv` (`uv run`, `uv add`), never pip.
- **Commits:** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Command timeouts:** every long command (build, test suite, docker) runs with an explicit timeout, so a hung process cannot stall the task.

## Execution structure

Three tracks, each in its own git worktree off `phase-7a`, with disjoint files:

| Track | Tasks | Branch | Worktree |
|---|---|---|---|
| A: API | 1 → 2 → 3 → 4 | `p7-api` | `../portfolio-p7-api` |
| B: Web | 5 → 6 → 7 → 8 → 9 → 10 → 11 | `p7-web` | `../portfolio-p7-web` |
| C: Infra/docs | 12 → 13 → 14 → 15 | `p7-infra` | `../portfolio-p7-infra` |

- **File ownership:**
  - Track A owns `apps/api/**`.
  - Track B owns `apps/web/**` plus the `web` job of `.github/workflows/ci.yml`.
  - Track C owns `infra/**`, `scripts/**`, `docs/**` (except plan and spec files), `.github/dependabot.yml`, the `infra` job of `ci.yml`, `Makefile` and `README.md`.
- **Integration:** Task 16 merges the tracks into `phase-7a`, runs everything, and opens the PR.
- **Chris:** Task 17 covers his steps.

### Running API tests locally

Host port 5432 is taken on Chris's Mac, so start the dev Postgres on 55432:

```bash
POSTGRES_PORT=55432 docker compose -f infra/compose/compose.dev.yaml up -d postgres
cd apps/api
export API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio
uv run alembic upgrade head
uv run ruff check . && uv run ruff format --check . && uv run pyright && uv run pytest
```

### Running web checks locally

```bash
cd apps/web
pnpm lint && pnpm typecheck && pnpm format && pnpm test && pnpm build
```

---

## Track A: API

### Task 1: API security headers and CORS (A14, A7 CORS part)

**Files:**
- Create: `apps/api/src/portfolio_api/security_headers.py`
- Modify: `apps/api/src/portfolio_api/main.py` (middleware registration and the CORS block)
- Test: `apps/api/tests/test_security_headers.py`

**Interfaces:**
- Produces: `SecurityHeaders` (pure ASGI middleware class) and the module constant `SECURITY_HEADERS: tuple[tuple[bytes, bytes], ...]`.

- [ ] **Step 1: Write the failing tests**

```python
# apps/api/tests/test_security_headers.py
import pytest
from httpx import ASGITransport, AsyncClient

from portfolio_api.main import create_app

EXPECTED = {
    "x-content-type-options": "nosniff",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "cross-origin-resource-policy": "same-site",
}


@pytest.fixture
async def client(settings):
    app = create_app(settings)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.mark.parametrize("path", ["/health", "/does-not-exist"])
async def test_every_response_carries_security_headers(client, path):
    res = await client.get(path)
    for name, value in EXPECTED.items():
        assert res.headers[name] == value


async def test_cors_preflight_allows_and_exposes_request_id(client, settings):
    origin = settings.cors_origins[0]
    res = await client.options(
        "/v1/contact",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-request-id",
        },
    )
    assert res.status_code == 200
    assert "x-request-id" in res.headers["access-control-allow-headers"].lower()
    simple = await client.get("/health", headers={"Origin": origin})
    assert "x-request-id" in simple.headers["access-control-expose-headers"].lower()
```

Use the existing `settings` fixture from `tests/conftest.py`. If the fixture has a different name, or `cors_origins` is empty there, adapt the fixture use (not the assertions). Also add `"http://localhost:3000"` to that test's settings if needed.

- [ ] **Step 2: Run the tests and check they fail**

Run: `cd apps/api && uv run pytest tests/test_security_headers.py -v`
Expected: FAIL (`KeyError: 'x-content-type-options'`).

- [ ] **Step 3: Implement**

```python
# apps/api/src/portfolio_api/security_headers.py
"""Security headers on every API response. The API serves JSON only, so the CSP denies everything."""

from starlette.types import ASGIApp, Message, Receive, Scope, Send

SECURITY_HEADERS: tuple[tuple[bytes, bytes], ...] = (
    (b"x-content-type-options", b"nosniff"),
    (b"strict-transport-security", b"max-age=31536000; includeSubDomains"),
    (b"referrer-policy", b"no-referrer"),
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
    (b"cross-origin-resource-policy", b"same-site"),
)


class SecurityHeaders:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                message["headers"] = [*message.get("headers", []), *SECURITY_HEADERS]
            await send(message)

        await self.app(scope, receive, send_with_headers)
```

In `main.py`:
- Register the middleware just before `install_request_id(app)`, so it sits outside the metrics and body-limit layers and every 413, 404 and 500 gets the headers: `app.add_middleware(SecurityHeaders)`.
- Change the CORS call to:

```python
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `uv run pytest tests/test_security_headers.py -v`, then run the full API suite (see "Running API tests locally").
Expected: PASS, with no regressions.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "feat(api): security headers on every response; CORS allows and exposes X-Request-ID"
```

### Task 2: Rate limiter and chat hardening (A1, A2, A3)

**Files:**
- Modify: `apps/api/src/portfolio_api/ratelimit.py`, `apps/api/src/portfolio_api/main.py` (only the chat-retention job registration), `apps/api/src/portfolio_api/services/chat.py`, `apps/api/src/portfolio_api/routers/chat.py`
- Test: `apps/api/tests/test_ratelimit.py`, `apps/api/tests/test_chat.py`, `apps/api/tests/test_chat_api.py`

**Interfaces:**
- Produces: `client_key(ip: str) -> str` in `ratelimit.py`. It returns the IPv4 address unchanged; for IPv6 it returns the `/64` network in compressed form, like `"2001:db8:1:2::/64"`; for an unparsable input it returns it unchanged. `SlidingWindowLimiter(windows, max_keys: int = 10_000)`.

Start by grepping `.superpowers/sdd/phase4/progress.md` and `.superpowers/sdd/phase5/progress.md` for "limiter", "/64", "race", "unknown", "retention" and "masking" to read the original findings.

- [ ] **Step 1: Write the failing limiter tests** (append to `tests/test_ratelimit.py`)

```python
from portfolio_api.ratelimit import SlidingWindowLimiter, client_key


def test_client_key_groups_ipv6_by_64():
    assert client_key("2001:db8:1:2:aaaa::1") == client_key("2001:db8:1:2:bbbb::9")
    assert client_key("2001:db8:1:2:aaaa::1") == "2001:db8:1:2::/64"
    assert client_key("2001:db8:1:3::1") != client_key("2001:db8:1:2::1")


def test_client_key_keeps_ipv4_and_garbage():
    assert client_key("203.0.113.7") == "203.0.113.7"
    assert client_key("unknown") == "unknown"


def test_limiter_caps_tracked_keys():
    limiter = SlidingWindowLimiter([(5, 60)], max_keys=3)
    for i in range(10):
        limiter.hit(f"10.0.0.{i}")  # use the limiter's real method name
    assert len(limiter._hits) <= 3  # use the limiter's real storage attribute
```

Read `ratelimit.py` first and use its real method and attribute names in the last test. The cap evicts the least-recently-used key (keep keys in insertion order with `dict` and move a key to the end on access).

- [ ] **Step 2: Run the tests and check they fail**

Run: `uv run pytest tests/test_ratelimit.py -v`. Expected: FAIL (`ImportError: client_key`).

- [ ] **Step 3: Implement**
  - Add `client_key` using `ipaddress.ip_address` and `ipaddress.ip_network(f"{ip}/64", strict=False)`.
  - Add the `max_keys` LRU cap.
  - Make every caller that keys a limiter by IP go through `client_key`: grep for `contact_limiter`, `chat_session_limiter`, `chat_message_limiter` and `status_limiter`, and wrap the IP at the one place it is derived if one exists.

- [ ] **Step 4: Fix A2 and A3, test first, one at a time**
  - **A3:** register the `chat-retention` job whenever `settings.chat_hash_salt` is set (the DB always is), not only when the whole chat stack is configured. Retention must purge old chats even when Groq is off.
    - This means constructing the purge independently of `ChatService`. If `purge_expired` lives on `ChatService`, extract it to a module-level `async def purge_expired_chats(sessions) -> int` in `services/chat.py` and have `ChatService.purge_expired` call it.
    - Test: `create_app` with a salt and no Groq key registers a job named `chat-retention`. Inspect the jobs the same way the existing tests do; if none exist, expose `app.state.job_names`.
  - **A2 count/budget race:** the question count and token budget checks and the increment must be atomic per session. Use one `UPDATE … WHERE questions < cap RETURNING` (or `SELECT … FOR UPDATE`) instead of read-then-write.
    - Test: two concurrent asks on a session with 1 question left produce exactly one answer and one `session_limit`.
  - **A2 DB error masking model error:** when the model call fails and the follow-up DB write also fails, the response must report the model failure (`model_busy`), and the DB error must be logged.
    - Test with a fake model that raises and a sessionmaker whose commit raises.
  - **A2 shared "unknown" IP bucket:** a request with no client IP must not share one global limiter bucket with all other unknown-IP requests. Reject it with 400 `bad_request` on chat endpoints (behind the tunnel every real request has `CF-Connecting-IP`).
    - Test: no header and no client gives 400.
  - **A2 test smells:** fix the smells the phase-5 ledger lists for `test_chat*.py` (for example, assertions on private state or sleeps). Change tests only.

- [ ] **Step 5: Run the full API suite and commit**

```bash
git add apps/api && git commit -m "fix(api): /64 limiter keys with LRU cap, atomic chat quota, retention independent of Groq"
```

### Task 3: RAG, contact and GitHub hardening (A4, A5, A6, A7 rest, A8, A13)

**Files:** `apps/api/src/portfolio_api/{rag/*, services/indexer.py, services/contact.py, routers/contact.py, clients/email.py, db.py, jobs.py, main.py (lifespan only), services/github.py, routers/github.py, clients/directus.py, cli.py}` and their tests under `apps/api/tests/`. The files listed are the expected ones; touch only what each item needs.

Grep the phase 4 and 5 ledgers for each item ID's keywords before starting. Use TDD for each bullet: a failing test, then the fix, then a green test. Commit after each lettered group.

- [ ] **A4:** a title longer than 300 characters must not abort a RAG sync partway. Truncate titles to 300 characters at the indexer boundary (keep `String(300)`). Test: a Directus fake returning one 400-character title and one normal item syncs both.
- [ ] **A5:**
  - The keyword leg combines terms with OR (`websearch_to_tsquery` → build an OR `to_tsquery` from lexemes, or `plainto_tsquery` replaced with `' | '.join`). Test: a query with one matching term and one absent term still returns the matching chunk.
  - `upsert_document` leaves `updated_at` alone when the content hash is unchanged. Test it.
  - The reindex debounce task is cancelled on shutdown (lifespan). Test: after lifespan exit, the task is done.
  - Embedding dimension check: raise a clear error if the vector length is not 384. Test with a fake embedder returning 3 dims.
  - The chunk window step must be > 0: validate the overlap is smaller than the size, with a ValueError. Test it.
  - Resume PDF size cap: skip PDFs over 10 MB with a log line. Test with a fake 11 MB body.
- [ ] **A6:**
  - Malformed JSON on `/v1/contact` still counts against the rate limit and still checks configuration: the limiter runs before body parsing. Test: 6 malformed posts in a minute give a 429 on the sixth.
  - Strip CR and LF from `name` before it reaches the email body or subject. Test it.
  - The retry query uses the DB clock (`func.now()`), not Python `datetime.now()`. Test with a row due by the DB clock.
  - Content-Length with non-ASCII digits (for example `"١٢"`) gives 400, not fallthrough. Test it in the body-limit tests.
  - `make_engine(..., hide_parameters=True)`. Test: `engine.hide_parameters is True`.
- [ ] **A7 rest:**
  - `run_forever` backs off exponentially after consecutive failures (interval × 2^n, capped at 1 hour, reset on success). Test with a failing job and a fake sleep.
  - The lifespan uses `try/finally` so cleanup runs if startup fails after the tasks start.
  - Add tests: 405 on `GET /v1/contact`, and 422-style `validation_error` for missing fields.
- [ ] **A8:**
  - Test that `GET /v1/github/activity` makes no GitHub call (the fake source records calls).
  - Test that the `github-refresh` job is registered when a token is set and absent when it isn't.
  - `refresh_if_stale` catches any `Exception` (logged), not only `GitHubError`, so one bad response cannot kill the job loop. Test it.
  - A corrupt cached payload gives the same empty or unavailable response as a missing cache, not a 500. Test it.
- [ ] **A13:**
  - An unhandled Directus error in `_reindex` returns the standard error body and logs it; the CLI `reindex` prints one line and exits 1 instead of a traceback. Test both.
  - Narrow the `pdf_text` catch to `pypdf` errors plus `ValueError`.
  - Replace the `replace(**{...})` wrapper with a direct `dataclasses.replace` call or explicit construction.
  - A missing seed file logs a warning naming the file. Test it.

After each group, run the full API suite. Commit messages: `fix(api): RAG sync robustness (A4, A5)`, `fix(api): contact hardening (A6)`, `fix(api): job backoff and lifespan cleanup (A7)`, `test(api): GitHub activity coverage (A8)`, `fix(api): reindex and CLI error handling (A13)`.

### Task 4: Ruff security rules, metrics and status fixes (A9, A10, A11)

**Files:** `apps/api/pyproject.toml`; `apps/api/src/portfolio_api/{metrics.py, routers/chat.py, services/chat.py, services/status.py, clients/prometheus.py, observability.py}`; tests `apps/api/tests/{test_metrics.py, test_status.py, test_foundation.py}`.

Grep the phase 4 ledger for "S rules" and "structlog", and the phase 6 ledger for the T1 and T2 minors, before starting.

- [ ] **A9:**
  - Add `"S"` to ruff `select` in `pyproject.toml`.
  - Fix every finding, or add a per-line `# noqa: S###` with a reason comment when it is a false positive (for example `S311` on non-crypto jitter).
  - Ignore `S101` (assert) under `tests/**` via `per-file-ignores`.
  - Add a test that `configure_logging("INFO")` followed by `structlog.get_logger().info("x", k=1)` writes one JSON line containing `"event": "x"` and `"k": 1` (use `capsys`).
- [ ] **A10:**
  - `chat_questions_total` also counts rejections that happen before the answer is composed (rate-limited, session limit, budget). Use the outcome label values the ledger names; if it names none, use `rejected`.
  - Add tests: a 413 is recorded with `route="unmatched"` (or the matched route if the limit triggers after routing; assert whatever the middleware order produces, then document it in a code comment), the uncited counter, and the gauge job registration.
  - Replace the global `disable_created_metrics()` side effect with a dedicated `CollectorRegistry` used by the app's metrics and `/metrics`, so importing the module changes no global state. Test: `/metrics` output has no `_created` series.
- [ ] **A11:**
  - Floor slack in tiny windows: today's expected probes use `max(1, floor(seconds / 30))` only when `seconds >= 30`; otherwise today is `null`. Test it at 00:00:10 New York time.
  - The httpx timeout is per phase (`httpx.Timeout(2.0, connect=1.0)`) instead of one total.
  - The roughly 35 concurrent PromQL queries per refresh run through an `asyncio.Semaphore(8)`. Test: a fake Prometheus records at most 8 in flight.
  - Cache `first_probe` for the process lifetime once found.
  - Exclude `route="/v1/status"` from the `requests_today` and `p95` PromQL. Test the query strings.

Run the full API suite after each item. Commit per item: `chore(api): enable ruff S rules (A9)`, `fix(api): chat metrics coverage and private registry (A10)`, `fix(api): status query concurrency and accuracy (A11)`.

---

## Track B: Web

### Task 5: Nonce CSP, static security headers, security.txt (W1, W19)

**Files:**
- Create: `apps/web/src/lib/csp.ts`, `apps/web/src/lib/csp.test.ts`, `apps/web/src/proxy.ts`, `apps/web/src/proxy.test.ts`, `apps/web/public/.well-known/security.txt`, `apps/web/src/security-txt.test.ts`
- Modify: `apps/web/next.config.ts`, `apps/web/src/next-config.test.ts`, `apps/web/src/app/layout.tsx`, `apps/web/src/components/analytics/umami-script.tsx` (+ its test), `apps/web/src/components/analytics/resume-link.tsx` (W19)

**Interfaces:**
- Produces: `buildCsp(opts: { nonce: string; apiOrigin: string; dev: boolean; upgradeInsecure: boolean }): string` and `SECURITY_HEADERS: { key: string; value: string }[]` (exported from `next.config.ts`'s sibling `src/lib/security-headers.ts`).
- Proxy behaviour that Task 7's e2e test checks: the response has a `content-security-policy` header containing `'nonce-`, and the nonce differs per request.

- [ ] **Step 1: Write the failing CSP test**

```ts
// apps/web/src/lib/csp.test.ts
import { describe, expect, it } from "vitest";

import { buildCsp } from "./csp";

describe("buildCsp", () => {
  it("builds the production policy", () => {
    expect(
      buildCsp({
        nonce: "abc",
        apiOrigin: "https://api.christopherguzman.me",
        dev: false,
        upgradeInsecure: true,
      }),
    ).toBe(
      [
        "default-src 'self'",
        "script-src 'self' 'nonce-abc' 'strict-dynamic' https://challenges.cloudflare.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self' https://api.christopherguzman.me https://challenges.cloudflare.com",
        "frame-src https://challenges.cloudflare.com",
        "object-src 'self'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests",
      ].join("; "),
    );
  });

  it("allows eval in development and skips the upgrade over http", () => {
    const csp = buildCsp({
      nonce: "n",
      apiOrigin: "http://localhost:8000",
      dev: true,
      upgradeInsecure: false,
    });
    expect(csp).toContain("'strict-dynamic' https://challenges.cloudflare.com 'unsafe-eval';");
    expect(csp).toContain("connect-src 'self' http://localhost:8000 ");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});
```

- [ ] **Step 2: Run it and check it fails** (`pnpm vitest run src/lib/csp.test.ts`, which fails because the module is missing).

- [ ] **Step 3: Implement `csp.ts`**

```ts
// apps/web/src/lib/csp.ts
// Enforced CSP. Scripts need this request's nonce; 'strict-dynamic' lets nonced scripts load
// others (Turnstile), and makes browsers ignore 'self' and host sources for scripts.
// style-src keeps 'unsafe-inline' because Next and next-themes set style attributes (see
// docs/security.md).
export function buildCsp({
  nonce,
  apiOrigin,
  dev,
  upgradeInsecure,
}: {
  nonce: string;
  apiOrigin: string;
  dev: boolean;
  upgradeInsecure: boolean;
}): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${apiOrigin} https://challenges.cloudflare.com`,
    "frame-src https://challenges.cloudflare.com",
    "object-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (upgradeInsecure) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}
```

- [ ] **Step 4: Write the failing proxy test**

```ts
// apps/web/src/proxy.test.ts
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { config, proxy } from "./proxy";

afterEach(() => vi.unstubAllEnvs());

function cspOf(res: Response): string {
  return res.headers.get("content-security-policy") ?? "";
}

describe("proxy", () => {
  it("sets a CSP with a fresh nonce on every response", () => {
    vi.stubEnv("PUBLIC_API_URL", "https://api.example.test/");
    const a = cspOf(proxy(new NextRequest("https://example.test/")));
    const b = cspOf(proxy(new NextRequest("https://example.test/")));
    const nonceA = /'nonce-([A-Za-z0-9+/=]+)'/.exec(a)?.[1];
    const nonceB = /'nonce-([A-Za-z0-9+/=]+)'/.exec(b)?.[1];
    expect(nonceA).toHaveLength(24); // 16 bytes, base64
    expect(nonceA).not.toBe(nonceB);
    expect(a).toContain("connect-src 'self' https://api.example.test ");
  });

  it("passes the nonce and CSP to the app on the request", () => {
    const res = proxy(new NextRequest("https://example.test/"));
    // NextResponse.next({ request: { headers } }) encodes overrides in x-middleware-request-*.
    const nonce = res.headers.get("x-middleware-request-x-nonce");
    expect(nonce).toBeTruthy();
    expect(res.headers.get("x-middleware-request-content-security-policy")).toContain(
      `'nonce-${nonce}'`,
    );
  });

  it("skips static assets, CMS assets, analytics, API routes and .well-known", () => {
    const source = config.matcher[0].source;
    for (const path of [
      "_next/static",
      "_next/image",
      "favicon.ico",
      "cms-assets",
      "stats",
      "api",
      "\\.well-known",
    ]) {
      expect(source).toContain(path);
    }
  });
});
```

- [ ] **Step 5: Run it and check it fails, then implement `proxy.ts`**

```ts
// apps/web/src/proxy.ts
import { NextResponse, type NextRequest } from "next/server";

import { buildCsp } from "@/lib/csp";
import { serverEnv } from "@/lib/env";

// Next 16 proxy (formerly middleware): one nonce per page request. Next reads it from the
// request's CSP header and stamps it on its own scripts; the layout reads x-nonce for the rest.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const { publicApiUrl, siteUrl } = serverEnv();
  const csp = buildCsp({
    nonce,
    apiOrigin: new URL(publicApiUrl).origin,
    dev: process.env.NODE_ENV !== "production",
    upgradeInsecure: siteUrl.startsWith("https://"),
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|cms-assets|stats|api|\\.well-known).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
```

If the test environment lacks `crypto.getRandomValues` or `Buffer`, add `// @vitest-environment node` at the top of the test file. Do not change the implementation.

- [ ] **Step 6: Static headers.**
  - Create `src/lib/security-headers.ts` exporting `SECURITY_HEADERS`, the five static headers from Global Constraints, as `{ key, value }`.
  - In `next.config.ts`, add `poweredByHeader: false` and `async headers() { return [{ source: "/:path*", headers: SECURITY_HEADERS }]; }`.
  - Extend `next-config.test.ts`:

```ts
  it("sends the static security headers on every route and hides x-powered-by", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(await nextConfig.headers?.()).toEqual([
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ]);
  });
```

`next.config.ts` imports from `./src/lib/security-headers` with a relative path; the `@/` alias is not available there.

- [ ] **Step 7: Nonce plumbing in the layout (and W19 "script streams late").**
  - `RootLayout` becomes `async`. It reads `const nonce = (await headers()).get("x-nonce") ?? undefined;` (import `headers` from `next/headers`) and passes `nonce={nonce}` to `<ThemeProvider>` (next-themes 0.4.6 accepts `nonce`).
  - `UmamiScript` takes `{ nonce }: { nonce?: string }`, renders `nonce={nonce}` on its `<script>`, and is rendered directly in `<head>` (`<head><UmamiScript nonce={nonce} /></head>` inside `<html>`, before `<body>`) instead of inside a body `Suspense`. Its `await connection()` stays.
  - Update `umami-script.test.tsx` to assert the nonce attribute is set.
  - JSON-LD scripts need no nonce. Turnstile is injected by already-nonced code, so `'strict-dynamic'` allows it; leave `turnstile.tsx` unchanged.
- [ ] **Step 8: W19 resume double-count.**
  - Grep the phase 6 ledger for "double-count".
  - Make `ResumeLink` fire `resume-download` exactly once per activation. For example, if both a click handler and `data-umami-event` exist, keep only `track()`.
  - Add a test that one click calls `track` once and that the element has no `data-umami-event` attribute.
- [ ] **Step 9: security.txt and its expiry test**

```text
Contact: mailto:chguzman@augusta.edu
Expires: 2027-10-06T00:00:00.000Z
Preferred-Languages: en
Canonical: https://christopherguzman.me/.well-known/security.txt
```

```ts
// apps/web/src/security-txt.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const text = readFileSync(join(__dirname, "../public/.well-known/security.txt"), "utf8");

describe("security.txt", () => {
  it("has the required fields", () => {
    expect(text).toMatch(/^Contact: mailto:\S+@\S+$/m);
    expect(text).toMatch(/^Canonical: https:\/\/christopherguzman\.me\/\.well-known\/security\.txt$/m);
  });

  it("does not expire within 30 days (bump Expires a year ahead when this fails)", () => {
    const expires = Date.parse(/^Expires: (.+)$/m.exec(text)?.[1] ?? "");
    expect(expires - Date.now()).toBeGreaterThan(30 * 86_400_000);
  });
});
```

- [ ] **Step 10: Verify.**
  - Run the full web checks (lint, typecheck, format, test, build). `pnpm build` must pass with no env vars.
  - Then run the built app and check the headers and console:

```bash
pnpm build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/
PORT=3100 HOSTNAME=127.0.0.1 SITE_URL=http://127.0.0.1:3100 node .next/standalone/server.js &
sleep 3; curl -sI http://127.0.0.1:3100/ | grep -iE "content-security|strict-transport|x-content|referrer|permissions|cross-origin|x-powered"
curl -s http://127.0.0.1:3100/ | grep -o 'nonce="[^"]*"' | sort -u | head
curl -s http://127.0.0.1:3100/.well-known/security.txt
kill %1
```

Expected: every header is present, `x-powered-by` is absent, every `<script>` in the HTML carries the same nonce as the header, and `security.txt` is served. Pages may render the CMS-unavailable state without Directus; that is fine here. Record the output in the report.

- [ ] **Step 11: Commit**: `feat(web): enforced nonce CSP via proxy, static security headers, security.txt`

### Task 6: Accessibility (W2, W3, W17 a11y parts, focus rings)

**Files:** `apps/web/src/app/layout.tsx`; `apps/web/src/components/layout/{site-header.tsx, site-footer.tsx, mobile-nav.tsx, nav-link.tsx, theme-toggle.tsx}`; `apps/web/src/components/content/{project-card.tsx, github-activity.tsx, status-card.tsx}`; `apps/web/src/components/chat/chat-launcher.tsx`; `apps/web/src/lib/status.ts`; `apps/web/src/app/globals.css`; and the matching `*.test.tsx`.

**Interfaces:**
- Produces: `uptimeSummary(daily: { date: string; uptime: number | null }[]): string` in `lib/status.ts`, and `<main id="main" tabIndex={-1}>`. Task 7's e2e test uses the skip link text `Skip to content`.

- [ ] **Step 1: Skip link (W2).** Test first in `src/app/layout.test.tsx`, or the closest existing layout or header test. Render `<SkipLink />` and assert that the first link is `Skip to content` with `href="#main"`. Then add to the layout, as the first child of `<body>`:

```tsx
<a
  href="#main"
  className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-foreground focus:outline-2 focus:outline-accent-brand"
>
  Skip to content
</a>
```

  and change `<main className="flex-1">` to `<main id="main" tabIndex={-1} className="flex-1 focus:outline-none">`. Put the link in its own `components/layout/skip-link.tsx` so it can be unit-tested; the test imports that.
- [ ] **Step 2: Accessible names (W3).**
  - In `ProjectCard`, remove the `aria-label` that replaces the card's visible content, so the link's name comes from its visible text (title first).
  - In the heatmap profile link, make the accessible name start with the visible text. Either remove the `aria-label` and add the extra context as `sr-only` text after the visible text, or set `aria-label` to `{visible text}: {context}`.
  - Tests: `getByRole("link", { name: /^OFFRes \/ OFFPay/ })` for the card. For the heatmap, the link's accessible name starts with its visible text.
- [ ] **Step 3: Focus rings.** Every interactive element in the header nav, mobile nav, footer links, theme toggle, chat launcher pill and status card gets `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand`. Grep for each component's root interactive elements and add the class where no `focus-visible:` style exists. Test: one assertion per component that the class string contains `focus-visible:outline`.
- [ ] **Step 4: Status card group label (W17 a11y).**
  - Test first in `lib/status.test.ts`:

```ts
import { uptimeSummary } from "./status";

it("summarises the 30 days for screen readers", () => {
  const days = Array.from({ length: 30 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, "0")}`,
    uptime: i === 4 ? 0.987 : 1,
  }));
  expect(uptimeSummary(days)).toBe("30-day uptime, 29 days at 100%, 1 day at 98.7%");
});

it("counts days without data", () => {
  const days = [
    ...Array.from({ length: 28 }, () => ({ date: "2026-09-01", uptime: null })),
    { date: "2026-09-29", uptime: 1 },
    { date: "2026-09-30", uptime: 0.999 },
  ];
  expect(uptimeSummary(days)).toBe(
    "30-day uptime, 1 day at 100%, 1 day at 99.9%, 28 days with no data",
  );
});
```

  - Implement: group days by the same percent string the card displays (reuse its formatter), sort groups by uptime descending, then append `N day(s) with no data` last. Use singular `day` for 1.
  - In `StatusCard`, the bar container becomes `role="img" aria-label={uptimeSummary(daily)}`, and each bar becomes `aria-hidden` with no `role` or label of its own.
  - Fix the empty `aria-hidden` skeleton value the phase 6 ledger names.
  - Update `status-card.test.tsx`: one `img` role named `30-day uptime, …`, and no per-bar `img` roles.
- [ ] **Step 5: Full web checks, commit**: `feat(web): skip link, accessible names, focus rings, status bars as one labelled image`

### Task 7: Playwright visitor journey in CI (W7)

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/fake-backend.mjs`, `apps/web/e2e/fixtures/directus/*.json`, `apps/web/e2e/fixtures/api/*.json`, `apps/web/e2e/turnstile-stub.js`, `apps/web/e2e/helpers.ts`, `apps/web/e2e/journey.spec.ts`, `apps/web/e2e/serve.sh`
- Modify: `apps/web/package.json` (`test:e2e` script; devDeps `@playwright/test`, `@axe-core/playwright`), `apps/web/vitest.config.mts` (exclude `e2e/**`), `apps/web/eslint.config.mjs` (only if it needs the `e2e` globs), `.github/workflows/ci.yml` (`web` job only), `apps/web/.gitignore` (or the root one: `test-results/`, `playwright-report/`)

**Interfaces:**
- Consumes: from Task 5, the CSP header with a nonce and the static headers. From Task 6, the `Skip to content` link and `#main`.
- Produces: `pnpm test:e2e`, which Tasks 8–11 rerun.

**Design (deviation from spec, recorded):** the e2e steps run inside the existing `web` CI job after `pnpm build`, not in a separate job. That reuses the build, keeps the job a required check without changing branch protection, and still meets the "after web builds" ordering.

- [ ] **Step 1: Install.** `pnpm add -D @playwright/test @axe-core/playwright` and `pnpm exec playwright install chromium`.
- [ ] **Step 2: Fake backend.** `e2e/fake-backend.mjs` is a plain `node:http` server on `127.0.0.1:3101` with no dependencies. It serves:
  - `GET /items/{collection}` and `GET /items/{collection}?filter…`: responds `{ data: <fixture> }` from `e2e/fixtures/directus/{collection}.json`.
    - For detail queries filtered by slug, return the array filtered to the matching `slug`; parse the `filter[slug][_eq]` query param, or whatever `lib/directus/queries.ts` sends (read it).
    - Singletons (`profile`, `resume`, `chat_settings`, etc.) return an object.
  - `GET /v1/status` → `fixtures/api/status.json` (operational, 30 days, the last day `1`).
  - `GET /v1/github/activity` → `fixtures/api/github-activity.json`.
  - `POST /v1/contact` → `202 {}`.
  - `POST /v1/chat/sessions` → `{ "session_id": "s1", "questions_left": 10 }`.
  - `POST /v1/chat/sessions/s1/messages` → `{ "answer": "Chris built this site with Next.js and FastAPI [1].", "sources": [{ "n": 1, "title": "This portfolio", "url": "/projects/this-portfolio" }], "outcome": "answered", "questions_left": 9 }`.
  - `OPTIONS *` → 204 with `Access-Control-Allow-Origin: http://127.0.0.1:3100`, `Access-Control-Allow-Methods: GET, POST`, `Access-Control-Allow-Headers: content-type, x-request-id`. Every response also carries `Access-Control-Allow-Origin`.
  - Anything else → 404 `{ "error": { "code": "not_found", "message": "not found" } }`.

  **Building fixtures:**
  - Build the Directus fixtures from `infra/directus/seed/*.json`, reshaped to what `src/lib/directus/schemas.ts` parses.
  - Include at least 3 projects (one with slug `this-portfolio`, one `featured`), 1 post, profile, resume (with a file id), experience, education and chat settings with `enabled: true`.
  - Add a vitest `src/lib/directus/e2e-fixtures.test.ts` that parses every fixture with the real zod schemas, so fixture drift fails fast.
  - Match the API fixtures to the zod schemas in `lib/status.ts`, `lib/github-activity.ts` and `lib/chat.ts` the same way, and add those to the fixture test too.
  - Read `lib/chat.ts` and `routers/chat.py` (API) for the exact session and message paths; use those if they differ from the paths above.
- [ ] **Step 3: Serve script.**

```bash
#!/usr/bin/env bash
# apps/web/e2e/serve.sh: run the standalone production build the way the Docker image does.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf .next/standalone/.next/static .next/standalone/public
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
exec env PORT=3100 HOSTNAME=127.0.0.1 node .next/standalone/server.js
```

- [ ] **Step 4: `playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

const backend = "http://127.0.0.1:3101";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    { command: "node e2e/fake-backend.mjs", url: `${backend}/v1/status`, reuseExistingServer: !process.env.CI },
    {
      command: "bash e2e/serve.sh",
      url: "http://127.0.0.1:3100/api/healthz",
      reuseExistingServer: !process.env.CI,
      env: {
        SITE_URL: "http://127.0.0.1:3100",
        DIRECTUS_URL: backend,
        DIRECTUS_TOKEN: "e2e",
        API_INTERNAL_URL: backend,
        PUBLIC_API_URL: backend,
        TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
        REVALIDATE_SECRET: "e2e",
      },
    },
  ],
});
```

`pnpm build` runs before `playwright test` (in CI it already has). `package.json` gets `"test:e2e": "playwright test"`.
- [ ] **Step 5: Helpers.** `e2e/helpers.ts` exports a Playwright `test` extended with an auto-fixture that:
  - Routes `https://challenges.cloudflare.com/**` to `e2e/turnstile-stub.js`, so the test is hermetic and uses no Cloudflare network. The stub defines `window.turnstile = { render(el, o) { setTimeout(() => o.callback("e2e-token"), 0); return "w1"; }, reset() {}, remove() {} }`.
  - Collects `console` errors and `pageerror`s.
  - Collects CSP violations via `page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => (window.__csp ??= []).push(e.violatedDirective + " " + e.blockedURI)))`.
  - After each test, asserts that the console errors and `window.__csp` are both empty.
  - Exports `expectNoAxeViolations(page)` using `new AxeBuilder({ page }).analyze()`, which expects `violations` to equal `[]`. On failure it prints rule ids and targets.
- [ ] **Step 6: `e2e/journey.spec.ts`.** Each test runs in both projects (dark is the default):
  1. **Home:** the `h1` has the profile name; the status card shows `all systems operational`; at least one featured project card is visible; axe is clean. Press Tab once, and the focused element is `Skip to content`. Press Enter, and `#main` is focused.
  2. **Projects:** `/projects`, click the `This portfolio` card, the URL is `/projects/this-portfolio` and the `h1` matches; axe is clean on both pages.
  3. **Resume:** `/resume` shows a link whose name matches `/download/i` with an `href`; axe is clean.
  4. **Contact:** submitting empty shows the validation messages. Fill in name, email and message; Turnstile resolves via the stub; submit; the success message is visible. Axe is clean.
  5. **Chat:** click the chat pill (desktop), or press `Control+K`/`Meta+K` (both projects; use `ControlOrMeta+k`). Type `what stack is this site?` and press Enter. The fixture answer text appears with a source link to `/projects/this-portfolio`. Escape closes the terminal.
  6. **404:** `/nope` shows `Page not found`; axe is clean.
  7. **Light theme:** set `localStorage.theme = "light"` via `addInitScript`, load `/`, `/projects` and `/contact`; `html` has class `light`; axe is clean.
  8. **Headers:** `request.get("/")` has `content-security-policy` matching `/'nonce-[A-Za-z0-9+/=]{24}'/`, plus `strict-transport-security`, `x-content-type-options: nosniff`, `referrer-policy`, `permissions-policy` and `cross-origin-opener-policy`, and no `x-powered-by`.

  Use roles and accessible names for locators (no CSS selectors, except `#main`). If a selector needs a stable hook, add a `data-testid` to the component in this task.
- [ ] **Step 7: Run locally.** `pnpm build && pnpm test:e2e` (timeout 10 min). Fix the app, not the test, when a real defect shows up: a CSP violation, an axe violation or a console error. Record each fix in the report. Also exclude `e2e/**` from vitest.
- [ ] **Step 8: CI.** In `.github/workflows/ci.yml` `web` job, after the `pnpm build` step and before the docker build:

```yaml
      - name: Playwright browser cache
        uses: actions/cache@<same pinned SHA the repo already uses for actions/cache, or pin the latest v4 by SHA>
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('apps/web/pnpm-lock.yaml') }}
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
        env:
          CI: true
          NEXT_TELEMETRY_DISABLED: 1
      - uses: actions/upload-artifact@<pinned SHA>
        if: failure()
        with:
          name: playwright-traces
          path: apps/web/test-results
          retention-days: 7
```

  Pin every new action by full commit SHA with a `# vX.Y.Z` comment, like the existing ones. Find the SHAs with `gh api repos/actions/cache/git/ref/tags/v4.2.3`, or reuse SHAs already in `.github/workflows/*.yml`. Raise the job's `timeout-minutes` to 20.
- [ ] **Step 9: Full web checks and commit**: `test(web): Playwright visitor journey with fake backend, CSP and axe gates, in CI`

### Task 8: Mobile performance on `/` (W4)

**Files:** decided by the measurement. Expected: `apps/web/src/app/page.tsx`, `apps/web/src/components/chat/{chat-slot.tsx, chat-launcher.tsx}`, `apps/web/src/components/content/{github-activity.tsx, status-card.tsx}`, `apps/web/next.config.ts` (analyzer wrapper), `apps/web/package.json` (`@next/bundle-analyzer` dev dep).

- [ ] **Step 1: Baseline.** Build the app and start it with the e2e fake backend (`node e2e/fake-backend.mjs & pnpm build && bash e2e/serve.sh &`). Then run Lighthouse 3 times and record each Performance score, the TBT, the long tasks and the HTML size:

```bash
npx -y lighthouse@12 http://127.0.0.1:3100/ --form-factor=mobile --only-categories=performance \
  --chrome-flags="--headless=new" --output=json --output-path=./lh-before-1.json --quiet
```

  Write the outputs to the scratchpad directory given in the dispatch, not the repo. Also run `/projects` once as a reference.
- [ ] **Step 2: Find the owner of the long task.**
  - Add `@next/bundle-analyzer` as a dev dependency. Wrap `next.config.ts` export with it only when `ANALYZE=true`, so the normal config is unchanged; `next-config.test.ts` must still pass.
  - Run `ANALYZE=true pnpm build`, then identify which modules make up the chunk that runs the long task (Lighthouse `bootup-time` and `long-tasks` details name the chunk URL).
  - Write down the cause before changing anything.
- [ ] **Step 3: Fix the cause.** Apply only the levers the measurement points to:
  - Load the chat terminal code only on first open (`next/dynamic` with `ssr: false` behind the launcher, or `import()` in the click handler). The launcher stays tiny.
  - Make the heatmap's grid a server-rendered component with only the hover tooltip on the client, or lazy-hydrate below the fold.
  - Pass only the fields client components use, to shrink the RSC payload on `/`. Check the 110 KB `self.__next_f` payload for whole CMS objects passed to client components.
  - Keep the behaviour identical: unit tests and `pnpm test:e2e` stay green.
- [ ] **Step 4: Re-measure.** Run 3 times on `/` and take the median. Target: ≥ 95 on the local mobile profile. Check `/projects` did not regress. Put a before/after table in the report.
  - If ≥ 95 cannot be reached locally after addressing the measured cause, report DONE_WITH_CONCERNS with the numbers. Do not micro-optimise unrelated code.
- [ ] **Step 5: Full web checks, `pnpm test:e2e`, commit**: `perf(web): <the measured fix, one line>`

### Task 9: Web backlog sweep 1 (W8, W9, W10, W11, W12, W13)

**Files:** as each item needs, under `apps/web/src/**`. Grep `.superpowers/sdd/phase2/progress.md` and `.superpowers/sdd/phase3/progress.md` for each item's keywords first. TDD per bullet; commit per item ID.

- [ ] **W8:** extract the `outlineButton` class string duplicated in 4 pages to one export (for example a `buttonVariants`-style `outlineButton` in `components/ui/button.tsx`, or `lib/styles.ts`), and import it in all 4 pages. Test: one assertion that the export is used, or none if it is just a constant; the existing page tests cover rendering.
- [ ] **W9:** remove the orphan shadcn tokens from `globals.css`: CSS custom properties nothing references. Grep each candidate token name across `src/` before deleting. No visual change; build and e2e stay green.
- [ ] **W10:** each sub-item from the phase 3 ledger:
  - the posts list query omits `body_md`
  - metadata descriptions exist on every page
  - markdown `#` (h1) headings are demoted to h2 so a post has one h1
  - a collection list parity test (the collections listed in `tags.ts` match the revalidate allowlist)
  - the header-test regex is tightened
  - mobile-nav test strength (assert open, close and focus)
  - flaky tests (the fake-timer `findBy` and the no-caption assertion) are fixed
  - `robots.txt` sitemap URL comes from runtime `SITE_URL`, not from build time
- [ ] **W11:** on the contact page, a bad CMS URL must not throw. Wrap `new URL()` in a helper returning `null`, and skip that link. Replace empty-string fallbacks with omission. `CopyEmail` clears its timer on unmount. Test each.
- [ ] **W12:** on mobile, the hidden PDF `<object>` must not fetch. Render the `<object>` only on desktop: use a `matchMedia("(min-width: …)")` client gate, or `<object>` with `data` set only after mount on wide screens. Test: at a narrow viewport (stub `matchMedia`), no `object` element is in the DOM.
- [ ] **W13:**
  - RSS strips XML-illegal control characters (test with `\u0001`).
  - The rfc822 date does not `slice(0,10)` (it uses the full timestamp).
  - The TOC `lg:top-24` magic offset becomes a named CSS variable or a shared constant with the header height.
  - Duplicate heading ids get unique suffixes, and the TOC keys are unique (test with two `## Setup` headings).

Run the full web checks and `pnpm test:e2e` at the end.

### Task 10: Web backlog sweep 2 (W14, W15, W16, W17 rest, W18, W20)

Grep the phase 3–6 ledgers for each item first. TDD per bullet; commit per item ID.

- [ ] **W14:** `/api/revalidate` must not log on every unauthorized call. Log at most once per 60 s per process, with a count of suppressed calls. Test with fake timers. The edge WAF rule is documented by Task 15.
- [ ] **W15:**
  - The heatmap fetch memo dedupes in-flight requests at expiry (memoize the promise).
  - The first-month label is hidden on mobile when it would overlap.
  - An impossible date (for example `2026-02-30`) in the payload is dropped, not rendered.
  - Test each.
- [ ] **W16:** the contact form length counter and `maxLength` check use trimmed text, consistently with the API. Test that 2,000 characters plus surrounding spaces is accepted.
- [ ] **W17 rest:** the status card's bar colour uses the same rounded value it displays (99.495 shows `99.5%` and is green). Memoize the status promise, not the value. Test both.
- [ ] **W18:**
  - Chat drag handles `pointercancel` like `pointerup`.
  - The input clears only after the length check passes.
  - The live region re-announces identical consecutive messages: toggle a key, or append a zero-width counter.
  - The `clearInterval` moves out of the state updater into an effect cleanup.
  - The length counts code points (`[...text].length`), consistently with the 500 limit.
  - Test each.
- [ ] **W20:** silence jsdom "navigation not implemented" in the source-link tests. `preventDefault` the click in the test, or stub `window.location` / `HTMLAnchorElement.prototype.click`. Test: the suite prints no `Not implemented: navigation`; check with `pnpm test 2>&1 | grep -c "Not implemented"` being 0.

Run the full web checks and `pnpm test:e2e` at the end.

### Task 11: Web dependencies and TypeScript 6 (W21, spec §6)

**Files:** `apps/web/package.json`, `apps/web/pnpm-lock.yaml`, and type fixes only if TypeScript 6 is kept.

- [ ] **Step 1:** move `shadcn` from `dependencies` to `devDependencies`.
- [ ] **Step 2:** run `pnpm audit --prod`. For each remaining high or critical, update the parent (`pnpm update next` within its pinned major, or bump `next` to the latest 16.x patch) or add a `pnpm.overrides` entry pinning the patched transitive version (`source-map-js@>=1.2.2`, `sharp@>=0.35.5`). Re-run until it reports 0 high and 0 critical. Run the full web checks and `pnpm test:e2e`. Commit: `chore(web): shadcn to devDependencies, patch prod audit highs`.
- [ ] **Step 3: TypeScript 6 trial, on its own commit.**
  - Run `pnpm add -D typescript@^6`, then the full web checks and `pnpm test:e2e`.
  - If everything passes, with only small mechanical type fixes needed, commit: `chore(web): TypeScript 6`.
  - If anything fails in a way that is not a small mechanical fix, run `git checkout package.json pnpm-lock.yaml`, commit nothing, and record in the report: "TS6 reverted: <reason>". Dependabot #6 stays on hold.

---

## Track C: Infra and docs

### Task 12: Infra backlog (I2, I3, I4, I5, I8, I9, I10, I11, I12, I13)

**Files:** `infra/compose/{compose.yaml, compose.dev.yaml}`, `infra/cloudflare/worker-fallback.js` (+ test), `infra/observability/{grafana/**, prometheus/**}`, `infra/backup/*.sh`, `infra/vm/bootstrap.sh`, `.github/dependabot.yml`, `.github/workflows/ci.yml` (`infra` job only), `docs/runbook.md`.

Grep the phase 2 and phase 6 ledgers for each item first. Commit per item ID.

- [ ] **I2:** pin third-party images by digest in `compose.yaml` as `image: name:tag@sha256:…`. Get each digest with `docker buildx imagetools inspect name:tag --format '{{json .Manifest.Digest}}'`. Do not pin our own GHCR images. Dependabot docker-compose keeps updating tag and digest. Check: `docker compose -f infra/compose/compose.yaml --env-file infra/compose/prod.env.example config -q`.
- [ ] **I3:** the fallback Worker's `meta refresh` interval equals `Retry-After` (300). Update the worker test to assert both are 300.
- [ ] **I4:** check whether `cloudflared` has a healthcheck in `compose.yaml`. If it is missing, add one using `cloudflared tunnel --metrics 0.0.0.0:2000` plus `healthcheck: test: ["CMD", "cloudflared", "tunnel", "--metrics", "localhost:2000", "ready"]` (check the subcommand exists for the pinned version with `docker run --rm cloudflare/cloudflared:<tag> tunnel ready --help`). If it is already present, record "already present" in the report.
- [ ] **I5:** add a Grafana alert "Runner offline": the runner container is absent from `container_last_seen` for over 15 minutes, using the same pattern as Container down with `name=~"portfolio-runner-1"`. If the runner is excluded from cAdvisor, use `absent_over_time`. Use no `$` in `rules.yml`. Check with promtool or the CI provisioning parse.
- [ ] **I8:** extend `.github/dependabot.yml`:
  - an npm `ignore` for `@types/node` `version-update:semver-major`, with the comment `# runtime is Node 24; bump with the base image`
  - Dependabot coverage for `compose.dev.yaml`: docker-compose also scans `/infra/compose` files, so verify that `compose.dev.yaml` is included, and if Dependabot only reads `compose.yaml`, add a comment plus a CI check (next bullet)
  - for images pinned in `ci.yml` (promtool, blackbox) and the supercronic `ARG`, add a small CI step in the `infra` job: `scripts/check-image-drift.sh` asserts the dev compose, CI and prod compose use the same tag for each shared image

  Write the script with shellcheck-clean bash.
- [ ] **I9:** `bootstrap.sh` adds the Docker apt origin (`origin=Docker`, or `"Docker:${distro_codename}"`) to unattended-upgrades `Allowed-Origins` via a drop-in `/etc/apt/apt.conf.d/52unattended-docker`. It must stay idempotent and shellcheck-clean. Do not run bootstrap.sh.
- [ ] **I10:**
  - Grafana "Uptime (30d)" panel label and query match the card's definition, or the label is renamed to say what it measures.
  - The "Network" panel title says "Network (all containers)".
  - "Last backup age" shows `never` via a value mapping when absent.
  - The CI `$` guard covers every provisioning YAML.
  - Container-down's lookback is 24 h with a code comment explaining why (or shortened if the ledger says so).
- [ ] **I11:** in the backup scripts, quote or escape `PGUSER` in the ERE match. Move `pg_restore --version` out of the secrets step in `backup-verify.yml` (that file belongs to Track C). Run shellcheck and `bash infra/backup/test-roundtrip.sh`.
- [ ] **I12:** add a runbook check, `curl -sI https://christopherguzman.me/cms-assets/<id> | grep -i cf-cache-status` (expect `HIT` on the second request), plus the cache-rule setup if missing.
- [ ] **I13:** add a runbook "Memory watch" section: the Grafana panels to check weekly for a month, the thresholds (working set > 3.2 GiB, swap > 512 MiB sustained), and what to lower first.

Run `shellcheck infra/backup/*.sh scripts/*.sh infra/vm/bootstrap.sh`, `node --test infra/cloudflare/worker-fallback.test.mjs infra/directus/lib.test.mjs`, the compose config check, and the promtool and provisioning checks exactly as `ci.yml` runs them.

### Task 13: Directus bootstrap token and seed-once (I14)

**Files:** `infra/directus/{bootstrap.mjs, lib.mjs, lib.test.mjs, schema.mjs}`, `infra/compose/{compose.yaml, compose.dev.yaml, prod.env.example}`, `scripts/secrets-check.sh` (optional key list only), `docs/setup.md`.

**Interfaces:**
- Produces: `planSeedOnce(seededNames: string[], name: string, existingCount: number): "seed" | "record" | "skip"` in `lib.mjs`.

- [ ] **Step 1: Failing tests** in `lib.test.mjs` (node:test):

```js
test("planSeedOnce seeds a never-seeded empty collection", () => {
  assert.equal(planSeedOnce([], "projects", 0), "seed");
});
test("planSeedOnce records a pre-existing populated collection without seeding", () => {
  assert.equal(planSeedOnce([], "projects", 4), "record");
});
test("planSeedOnce never re-seeds a recorded collection, even when emptied", () => {
  assert.equal(planSeedOnce(["projects"], "projects", 0), "skip");
});
```

- [ ] **Step 2: Implement.**
  - **`lib.mjs`:** `planSeedOnce`.
  - **`schema.mjs`:** a hidden singleton collection `bootstrap_state` with field `seeded` (JSON, array of collection names). Use the same structure the other collections use, but with no reader policy permissions.
  - **`bootstrap.mjs`:**
    - If `process.env.DIRECTUS_BOOTSTRAP_TOKEN` is set, use it as the static bearer token instead of `api.login(...)`, and log `auth: static token`. Otherwise log in with `ADMIN_EMAIL`/`ADMIN_PASSWORD` as today and log `auth: admin password`.
    - `ensureSeed` reads `bootstrap_state.seeded` and calls `planSeedOnce` for each seed collection:
      - `"seed"` runs today's insert path;
      - `"record"` and `"seed"` both add the name;
      - singletons keep today's patch-when-different behaviour only when the result is `"seed"`.
    - It writes `seeded` back once at the end.
    - Add a short `DirectusClient` method if setting a static token needs one.
  - **`compose.yaml` and `compose.dev.yaml`:** pass `DIRECTUS_BOOTSTRAP_TOKEN: ${DIRECTUS_BOOTSTRAP_TOKEN:-}` to the directus service.
  - **`prod.env.example`:** add `DIRECTUS_BOOTSTRAP_TOKEN=` with a comment.
  - **`secrets-check.sh`:** only if it has an optional-keys list.
- [ ] **Step 3: Dev check.**
  - Run `POSTGRES_PORT=55432 make up`, then `make cms-bootstrap` twice. The second run reports 0 inserted, and `bootstrap_state.seeded` lists every seed collection.
  - Delete all items in one non-singleton collection via the Directus API, run bootstrap again, and confirm it stays empty.
  - Then repeat a run with `DIRECTUS_BOOTSTRAP_TOKEN` set to a token created for the dev admin (via the Directus API in dev), and confirm the log says `auth: static token`.
  - Record the output.
- [ ] **Step 4: `docs/setup.md`:** add a "Directus bootstrap token" section that covers:
  - how to generate the token in the admin UI (User → Token → Generate)
  - saving it with `make secrets-edit` as `DIRECTUS_BOOTSTRAP_TOKEN`
  - deploying and checking for `auth: static token` in the deploy log
  - the admin password and email stay as Directus's first-admin settings, but deploys no longer use them
- [ ] **Step 5:** run `node --test infra/directus/lib.test.mjs` and the compose config check, then commit: `feat(infra): Directus bootstrap via static token, seed each collection once`.

### Task 14: Runner via GitHub App (I6)

**Files:** `infra/runner/{entrypoint.sh, Dockerfile}`, `infra/compose/{compose.yaml, prod.env.example}`, `docs/setup.md`, and a new `infra/runner/test-app-jwt.sh`.

- [ ] **Step 1: Test first.** `infra/runner/test-app-jwt.sh`:
  - generates a throwaway RSA key (`openssl genrsa 2048`);
  - sources a function `app_jwt APP_ID KEY_PEM` from `infra/runner/github-app.sh`;
  - checks the JWT has 3 base64url parts;
  - checks the header decodes to `{"alg":"RS256","typ":"JWT"}`;
  - checks the payload has `iss` equal to the app id and `exp - iat == 600` (`iat` is backdated 60 s);
  - checks the signature verifies with `openssl dgst -sha256 -verify`.

  Wire it into the `infra` CI job next to the backup roundtrip test.
- [ ] **Step 2: Implement `infra/runner/github-app.sh`**, using only bash, openssl, base64, tr and jq:
  - `app_jwt` builds the JWT described in Step 1.
  - `app_installation_token REPO JWT` calls `GET /repos/$REPO/installation` to get `.id`, then `POST /app/installations/$ID/access_tokens` to get `.token`.
- [ ] **Step 3: Update `entrypoint.sh`.**
  - When both `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` are set, mint an installation token and use it in place of the PAT for the registration-token call. Otherwise require `GITHUB_RUNNER_TOKEN` as today. Change the `:?` guard to fire only when neither is set.
  - Log which auth path it used (`auth: github app` / `auth: pat`).
  - Unset all credentials before `exec ./run.sh`.
  - Install openssl in the Dockerfile if it is missing.
  - In `compose.yaml`, pass `GITHUB_APP_ID: ${GITHUB_APP_ID:-}` and `GITHUB_APP_PRIVATE_KEY: ${GITHUB_APP_PRIVATE_KEY:-}`, and make `GITHUB_RUNNER_TOKEN` `:-` as well. Document that one of the two is required.
- [ ] **Step 4: Update `docs/setup.md`.** Add a "Runner GitHub App" section:
  - Create the app: GitHub → Settings → Developer settings → GitHub Apps → New. Turn off the webhook. Permissions: Repository Administration read and write (the runner registration token requires it), and Metadata read. Allow installation only on this account.
  - Install it on the `chris-guzman-portfolio` repo.
  - Generate a private key.
  - Add the secrets with `make secrets-edit`: `GITHUB_APP_ID`, and `GITHUB_APP_PRIVATE_KEY` (the PEM with `\n` escaped, or as a quoted multi-line value; state which format the entrypoint expects and make the entrypoint handle `\n`-escaped PEM).
  - Deploy and confirm `auth: github app` in `docker logs`.
  - Then revoke the PAT and remove `GITHUB_RUNNER_TOKEN`.
- [ ] **Step 5: Check and commit.** Run shellcheck, `bash infra/runner/test-app-jwt.sh`, `docker build infra/runner`, and the compose config check. Commit: `feat(infra): runner registers via GitHub App when configured, PAT fallback`.

### Task 15: Security docs and doc fixes (spec §7, I1, I7, D1, D2, D3)

**Files:** create `docs/security.md`. Modify `docs/runbook.md`, `docs/setup.md`, `docs/superpowers/specs/2026-10-03-phase-5-*.md` (D1, one sentence), `README.md`, `Makefile`, `docs/architecture.md` (one link).

- [ ] **`docs/security.md`:** plain prose, under about 150 lines, with these sections:
  - **Assets**
  - **Attackers**
  - **Controls:** a table mapping each threat to its controls, from spec §7.
  - **Accepted trade-offs:** `style-src 'unsafe-inline'`, the runner's Docker socket (ADR 0006), single-VM availability, and Grafana/Umami admin behind Access plus their own logins.
  - **Headers:** the exact CSP and header lists from Global Constraints, and where each is set.
  - **Reporting a vulnerability:** email `chguzman@augusta.edu`, matching `security.txt`.

  Link it from `docs/architecture.md`.
- [ ] **I1 in `docs/setup.md`:** step-by-step Cloudflare WAF rate-limiting rule. The free plan has one rule, so use one expression covering `(http.host eq "api.christopherguzman.me" and (starts_with(http.request.uri.path, "/v1/contact") or starts_with(http.request.uri.path, "/v1/chat/")))`, 10 requests per 10 s per IP, Block for 10 s. Add a custom WAF rule blocking `/api/revalidate` from outside the tunnel: `http.host eq "christopherguzman.me" and http.request.uri.path eq "/api/revalidate"` → Block (the Directus Flow calls web over the Docker network, not via Cloudflare). Verify that claim in `infra/directus/bootstrap.mjs` before writing it; if the Flow uses the public URL, say Skip instead and explain why.
- [ ] **I7 in `docs/runbook.md`:** Proxmox key-only SSH:
  - `ssh-copy-id root@<proxmox>`
  - test key login in a second terminal
  - set `PasswordAuthentication no` and `PermitRootLogin prohibit-password` in `/etc/ssh/sshd_config.d/10-keys-only.conf`
  - `systemctl reload ssh`
  - test again before closing the first session
- [ ] **D1:** correct the Phase 5 spec sentence that claims a site-wide CSP existed, to: "(CSP added in Phase 7a; see docs/security.md)".
- [ ] **D2:**
  - README "Phase 4 and Phase 5 tables" wording
  - runbook "first four" → the real count of seeded items
  - Makefile help column alignment (widen `%-12s` to fit the longest target)
  - a clear `API_CONTAINER`-empty error: change the Makefile helpers to `$(or $(API_CONTAINER),$(error api container not running; is the stack up?))`, or the shell equivalent with `test -n`
- [ ] **D3, runbook "CSP and headers":**
  - how to check headers (`curl -sI`)
  - how to find CSP violations: browser console, the Playwright job
  - how to change the policy (`src/lib/csp.ts`, with a test update)
  - the Cloudflare features to keep off because they inject scripts: Email Obfuscation, Rocket Loader, and Web Analytics auto-inject
  - the yearly `security.txt` Expires bump, which the test enforces
  - the weekly proof routine: backup-verify green, the Grafana memory watch

Run `make help` and check the alignment. Commit: `docs: security model, Cloudflare WAF and SSH steps, runbook CSP section, doc fixes`.

---

## Task 16: Integration, full checks, PR

- [ ] **Step 1: Merge the tracks.**

```bash
git checkout phase-7a
git merge --no-ff p7-api -m "Merge p7-api"
git merge --no-ff p7-infra -m "Merge p7-infra"
git merge --no-ff p7-web -m "Merge p7-web"
```

  `ci.yml` is touched by B (the `web` job) and C (the `infra` job) in different hunks. Resolve any conflict by keeping both.
- [ ] **Step 2: Every suite.**

```bash
POSTGRES_PORT=55432 docker compose -f infra/compose/compose.dev.yaml up -d postgres
(cd apps/api && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio \
  sh -c 'uv run alembic upgrade head && uv run alembic check && uv run ruff check . && uv run ruff format --check . && uv run pyright && uv run pytest')
(cd apps/web && pnpm lint && pnpm typecheck && pnpm format && pnpm test && pnpm build && pnpm test:e2e && pnpm audit --prod)
node --test infra/cloudflare/worker-fallback.test.mjs infra/directus/lib.test.mjs
docker compose -f infra/compose/compose.yaml --env-file infra/compose/prod.env.example config -q
shellcheck infra/backup/*.sh infra/runner/*.sh scripts/*.sh infra/vm/bootstrap.sh
bash infra/backup/test-roundtrip.sh && bash infra/runner/test-app-jwt.sh && bash scripts/check-image-drift.sh
docker build -t p7-api apps/api && docker build --build-arg NEXT_PUBLIC_APP_VERSION=ci -t p7-web apps/web && docker build -t p7-runner infra/runner
```

  Also run the promtool and provisioning checks exactly as `ci.yml` runs them. Expected: all green. Record test counts.
- [ ] **Step 3: Dev stack.**
  - Run `POSTGRES_PORT=55432 make up`, `make migrate`, `make cms-bootstrap`.
  - Open `http://localhost:3000` in Chrome via Playwright (`pnpm exec playwright` script or `npx playwright open`).
  - Visit home, projects, a project, resume, contact and blog, and the chat open/ask flow (no Groq key in dev means a "chat unavailable" message, which is fine).
  - Confirm no CSP violations in the console, in dev mode with `'unsafe-eval'`.
  - `curl -sI localhost:8000/health` shows the API headers.
- [ ] **Step 4: Final whole-branch review, fixes, PR.**
  - Run the final review (controller) and apply its fixes in one pass. Re-run Step 2.
  - Push with `git push -u origin phase-7a`, then `gh pr create --base main --head phase-7a --title "Phase 7a: Engineering polish" --body-file <body>`.
  - The body summarizes the security headers and CSP, the a11y, perf and e2e work, and backlog items closed by ID.
  - It lists the new optional secrets (`DIRECTUS_BOOTSTRAP_TOKEN`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`) by name.
  - It states in bold: **turn off Cloudflare Email Obfuscation before merging** (its injected script would be blocked by the CSP).
  - It ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
  - Wait for CI to go green. Do not merge until Chris says so.
  - Close Dependabot #38 with the comment "Ignored by dependabot.yml: runtime is Node 24; @types/node majors are bumped with the base image." If TS6 was kept, close #6 as superseded; otherwise comment the revert reason.

## Task 17: Chris's steps and production checks

Done by Chris with step-by-step guidance; no code. Never paste secret values into chat.

- [ ] **Before merging:** Cloudflare → christopherguzman.me → Scrape Shield (Security → Settings) → Email Address Obfuscation: **Off**. Also confirm Rocket Loader is off (Speed → Optimization).
- [ ] **Merge the PR** (when Chris says so) and watch the deploy. Smoke passes.
- [ ] **Production checks (Claude runs these from the laptop):**
  - `curl -sI https://christopherguzman.me/` and `https://api.christopherguzman.me/health` show every header.
  - `security.txt` is served.
  - Lighthouse mobile on `/` 3 times, median ≥ 95; desktop 100.
  - Manual browse in Chrome with DevTools open (home, chat, contact with real Turnstile, resume PDF, theme toggle) shows no CSP errors.
  - securityheaders.com grade is A or better.
- [ ] **I1:** add the Cloudflare rate-limit and WAF rules from `docs/setup.md`, then test that 11 quick `curl -X POST https://api.christopherguzman.me/v1/contact` requests return 429 or a block.
- [ ] **I14:** create the Directus static token, `make secrets-edit` → `DIRECTUS_BOOTSTRAP_TOKEN`, push, and check that the deploy log says `auth: static token`.
- [ ] **I6:** create and install the GitHub App, `make secrets-edit` → `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, push, check that the runner log says `auth: github app`, then revoke the PAT and remove `GITHUB_RUNNER_TOKEN`.
- [ ] **I7:** Proxmox key-only SSH per the runbook.
- [ ] **I13:** add a calendar reminder to check the Grafana memory panels weekly for a month.
