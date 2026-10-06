# Phase 6: Monitoring, Analytics, and Backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The site's data is backed up off-site every night (encrypted, deletion-locked, restore-checked weekly), Chris gets an email when something breaks, he can see who visits, and the homepage shows an honest live status card with a 30-day uptime graph.

**Architecture:** Seven new compose services: Prometheus scrapes the API's new `/metrics`, node-exporter, cAdvisor, and a blackbox probe of the public site; Grafana provides private dashboards and email alerts; Umami provides analytics proxied through the site at `/stats/*`; and a backup container runs nightly `pg_dump` + uploads tar → age → rclone → R2. The API serves `GET /v1/status` by running fixed PromQL against Prometheus, and the homepage renders it as a status card. A weekly GitHub Action restores the newest backup into a throwaway Postgres and checks it.

**Tech Stack:** FastAPI, `prometheus-client`, httpx, Pydantic v2, pytest; Next.js 16 App Router, React 19, Tailwind 4, zod 4, vitest + Testing Library; Prometheus, Grafana OSS (file provisioning), node-exporter, cAdvisor, blackbox-exporter, Umami (Postgres), Alpine + `postgresql17-client` + age + rclone + supercronic; GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-03-phase-6-observability-analytics-backups-design.md` (binding; this plan implements it).

## Global Constraints

- VM has 4 GiB RAM. `mem_limit` exactly: prometheus 320m, grafana 384m, node-exporter 64m, cadvisor 128m, blackbox-exporter 32m, umami 256m, backup 256m. Every new service uses the `x-service` anchor, publishes no host port, and pins an exact image tag (no `latest`).
- Prometheus: scrape interval 30 s; `--storage.tsdb.retention.time=35d`, `--storage.tsdb.retention.size=2GB`; jobs `api` (`api:8000/metrics`), `node` (`node-exporter:9100`), `cadvisor` (`cadvisor:8080`), `site` (blackbox `http_2xx` probe of `https://christopherguzman.me/api/healthz`), `prometheus`.
- API metric names exactly: `http_requests_total{method,route,status}`, `http_request_duration_seconds{method,route}` (histogram), `chat_questions_total{outcome}`, `chat_tokens_total{kind="input"|"output"}`, `chat_budget_used_ratio` (gauge), `contact_submissions_total{result="sent"|"failed"}`, `rag_sync_runs_total{result="ok"|"error"}`. `route` is the matched route template; unmatched → `route="unmatched"`; `/metrics` and `/health` excluded from request metrics.
- `/metrics` returns 404 `not_found` (standard error body) when a `CF-Connecting-IP` header is present, 200 otherwise. No secret.
- Backup metrics exactly: `backup_last_success_timestamp_seconds`, `backup_last_size_bytes`, written to `/textfile/backup.prom` (temp file then rename) on the `node-textfile` volume; node-exporter `--collector.textfile.directory=/textfile`.
- `GET /v1/status` always 200, `Cache-Control: public, max-age=60`, 60 s in-process memo, per-IP limit 60/min, JSON exactly: `{status: "operational"|"degraded", uptime_30d: float|null, daily: [{date: "YYYY-MM-DD", uptime: float|null}] (30 entries, oldest first, last = today), p95_ms: int|null, requests_today: int|null, last_backup_at: ISO-8601 UTC string|null}`. Day boundaries: America/New_York. `operational` only if Prometheus answered, DB check passes, and the latest `site` probe succeeded. Prometheus unreachable or any query error (2 s timeout) → `degraded`, all metric fields null, all `daily[].uptime` null. Uptime = successful probes ÷ expected probes (covered seconds ÷ 30); missing samples count as down; days wholly before the first recorded probe → null; today counts only elapsed time. `p95_ms` = 24 h p95 over all routes except `/v1/chat/*`, whole ms. PromQL fixed in code; nothing from the request reaches Prometheus. API setting `prometheus_url` default `http://prometheus:9090` (env `API_PROMETHEUS_URL`).
- Status card copy exactly: header `all systems operational · self-hosted on Proxmox` / `degraded · self-hosted on Proxmox`; skeleton `checking status`; rows `uptime (30d)`, `api response (p95)`, `requests today`, `last backup` (value like `3h ago · encrypted · R2`), `stack` (`Proxmox · Docker · Cloudflare Tunnel`); bar labels `30 days ago` / `today`; null value `—`; bar green at ≥ 99.5%, amber below, muted for null; each bar's accessible label like `Oct 3: 99.97%`. Hero order: name, intro, Download resume + Get in touch, GitHub + LinkedIn, card. The old `LiveStatus` is removed.
- Umami: tracker `<script defer src="/stats/script.js" data-website-id={UMAMI_WEBSITE_ID} data-host-url="/stats">`, rendered only when runtime env `UMAMI_WEBSITE_ID` is set. `next.config.ts` rewrites `/stats/script.js` → `http://umami:3000/script.js` and `/stats/api/send` → `http://umami:3000/api/send`. Events exactly: `resume-download` `{from: pathname}`, `chat-open`, `chat-question`, `contact-sent`, `outbound-click` `{to: "github"|"linkedin"|"repo"|"live"|"other"}`. Never send chat question text. `track(name, data?)` no-ops without `window.umami`.
- Alerts (Grafana-provisioned), email to `CONTACT_TO` via `smtp.resend.com:465`, user `resend`, password `RESEND_API_KEY`, from `Portfolio alerts <alerts@christopherguzman.me>`: Disk filling >80% 10m; Memory tight >90% 10m; Site down `probe_success{job="site"} == 0` 5m; API errors 5xx share >5% with ≥20 requests 10m; Container down (`up == 0` or `time() - max by (name) (max_over_time(container_last_seen{name=~"portfolio-(postgres|directus|api|web|cloudflared|umami)-1"}[24h])) > 60`) 5m; Backup stale (`time() - backup_last_success_timestamp_seconds > 36h` or absent) 15m; Chat budget `chat_budget_used_ratio > 0.8` 0m.
- Backups: 03:30 America/New_York daily; `pg_dumpall --globals-only` + `pg_dump -Fc` of `directus`, `portfolio`, `umami` + tar of `directus-uploads` + `manifest.json` (timestamp, image tag, files, sizes, sha256); one tar stream → `age -r "$BACKUP_AGE_RECIPIENT"` → `rclone rcat r2:${R2_BUCKET}/backups/YYYY/MM/DD/portfolio-YYYYMMDDTHHMMSSZ.tar.age`; success → textfile metric + `curl` `BACKUP_HEARTBEAT_URL`; failure → `curl ${BACKUP_HEARTBEAT_URL}/fail`, exit non-zero. Container non-root.
- New prod secrets: `GRAFANA_ADMIN_PASSWORD`, `UMAMI_APP_SECRET`, `BACKUP_AGE_RECIPIENT`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `BACKUP_HEARTBEAT_URL` (all required, `:?`); `UMAMI_WEBSITE_ID` optional (`:-`). GitHub environment `backup-verify` secrets: `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_READ_ACCESS_KEY_ID`, `R2_READ_SECRET_ACCESS_KEY`, `BACKUP_AGE_KEY`.
- Phase 3 rules still bind the web app: no emojis, Lucide icons, semantic Tailwind tokens only (no raw hex), dark default theme, `pnpm build` passes with no env vars set.
- Before the final checks of any API task, run `uv run ruff format .` and `uv run ruff check --fix .`; for web tasks run `pnpm --dir apps/web format:write` on your files if `pnpm format` fails.
- Never read/write `.env*`; never run sops or `make secrets-*`. Python via `uv` only (`uv run`, `uv add`), never pip.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Execution structure

Three tracks, each in its own git worktree off `phase-6`, with disjoint files:

| Track | Tasks | Branch |
|---|---|---|
| A: API | 1 → 2 | `p6-api` |
| B: Web | 3 → 4 | `p6-web` |
| C: Infra | 5 → 6 → 7 → 8 | `p6-infra` |

Tracks run in parallel. Task 9 (integration) merges all three into `phase-6`, runs every suite and a dev-stack check, and opens the PR. Task 10 is Chris's setup: his secrets PR merges **before** the code PR (compose requires the new keys), then the code PR merges and deploys.

### Running API tests locally

Host port 5432 is taken on Chris's Mac, so start the dev Postgres on 55432:

```bash
POSTGRES_PORT=55432 docker compose -f infra/compose/compose.dev.yaml up -d postgres
cd apps/api
export API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio
uv run alembic upgrade head
uv run pytest
```

---

### Task 1: API metrics (`/metrics`, request middleware, feature counters)

Track A, branch `p6-api`. All commands run from `apps/api` with the test database exported (see "Running API tests locally").

**Files:**
- Modify: `apps/api/pyproject.toml`, `apps/api/uv.lock` (via `uv add prometheus-client`)
- Create: `apps/api/src/portfolio_api/metrics.py`
- Create: `apps/api/src/portfolio_api/routers/metrics.py`
- Modify: `apps/api/src/portfolio_api/main.py`
- Modify: `apps/api/src/portfolio_api/services/chat.py`
- Modify: `apps/api/src/portfolio_api/services/contact.py`
- Modify: `apps/api/src/portfolio_api/services/indexer.py`
- Modify: `apps/api/tests/fakes.py`
- Create: `apps/api/tests/test_metrics.py`
- Modify: `apps/api/tests/test_chat.py`, `apps/api/tests/test_contact.py`, `apps/api/tests/rag/test_indexer.py` (append tests)

**Interfaces:**
- Consumes: `ApiError` (`portfolio_api.errors`), `ChatOutcome` (`portfolio_api.models`), `repositories.chat.tokens_used`, `Job` (`portfolio_api.jobs`), the existing `ChatService`, `ContactService`, `IndexService`.
- Produces:
  - `portfolio_api.metrics`: `REGISTRY` (a dedicated `CollectorRegistry`), `HTTP_REQUESTS` (`http_requests_total{method,route,status}`), `HTTP_REQUEST_DURATION` (`http_request_duration_seconds{method,route}` histogram, default buckets), `CHAT_QUESTIONS` (`chat_questions_total{outcome}`, outcome in `answered|no_match|uncited|error`), `CHAT_TOKENS` (`chat_tokens_total{kind="input"|"output"}`), `CHAT_BUDGET_USED_RATIO` (`chat_budget_used_ratio` gauge), `CONTACT_SUBMISSIONS` (`contact_submissions_total{result="sent"|"failed"}`), `RAG_SYNC_RUNS` (`rag_sync_runs_total{result="ok"|"error"}`), `RequestMetrics` (pure ASGI middleware), `UNMATCHED = "unmatched"`, `EXCLUDED_PATHS = {"/metrics", "/health"}`.
  - `GET /metrics` (`portfolio_api.routers.metrics.router`, `include_in_schema=False`): Prometheus text, 404 `not_found` when `CF-Connecting-IP` is present.
  - `ChatService.refresh_budget_gauge() -> None` (run by the new `chat-budget-gauge` job at startup and every 300 s).
  - `tests.fakes.metric(name: str, **labels: str) -> float` (test helper reading `REGISTRY`).

Notes for the implementer:
- Metrics live on one module-level `REGISTRY`, not the global default one and not per app. `create_app` never registers anything, so building many apps in one test process cannot hit "Duplicated timeseries". Tests compare values before and after (the registry is shared by every test).
- `RequestMetrics` reads `scope["route"]` **after** the app ran: FastAPI 0.141 writes the matched `APIRoute` into the same scope dict, and `route.path` is the full template including the router prefix (verified: `/v1/chat/sessions/{session_id}/messages`). It sits between `BodySizeLimit` and the request-ID middleware, so it sees 413s (as `unmatched`, they are rejected before routing) and unhandled exceptions (recorded as 500, then re-raised for the request-ID middleware to turn into the JSON 500).
- `ASGITransport` does not run the lifespan, so the startup gauge refresh is tested by calling `refresh_budget_gauge()` directly.
- The chat budget day is the UTC date, the same day `ChatService` already uses for `chat_usage_daily`. The 5-minute job also brings the gauge back to 0 after UTC midnight; without it the Chat budget alert would keep firing until the next question.
- `contact_submissions_total{result="failed"}` counts every failed send attempt (retries included); `sent` counts each delivered email once.
- There is no `resume_downloads_total`: the resume PDF is served by the web app (`/cms-assets/<id>`), not the API. Resume downloads are measured by the Umami `resume-download` event (Task 4). Do not invent an API endpoint for it.

- [ ] **Step 1: Add the dependency**

```bash
cd apps/api
uv add prometheus-client
uv run python -c "import prometheus_client; print(prometheus_client.CollectorRegistry)"
```

Expected: `pyproject.toml` gains `"prometheus-client>=0.26.0"` (or newer), `uv.lock` updates, and the import prints the class.

- [ ] **Step 2: Write the failing tests**

Append to `apps/api/tests/fakes.py` (add the import with the other `portfolio_api` imports, the function at the end of the file):

```python
from portfolio_api.metrics import REGISTRY
```

```python
def metric(name: str, **labels: str) -> float:
    """Current value of one sample in the API's metrics registry (0 if it has none yet)."""
    return REGISTRY.get_sample_value(name, labels) or 0.0
```

`apps/api/tests/test_metrics.py`:

```python
import uuid

from httpx import ASGITransport, AsyncClient

from portfolio_api.config import Settings
from portfolio_api.main import create_app
from tests.fakes import metric

CHAT_MESSAGES = "/v1/chat/sessions/{session_id}/messages"
METRIC_NAMES = (
    "http_requests_total",
    "http_request_duration_seconds",
    "chat_questions_total",
    "chat_tokens_total",
    "chat_budget_used_ratio",
    "contact_submissions_total",
    "rag_sync_runs_total",
)


async def test_metrics_is_hidden_through_cloudflare(client: AsyncClient) -> None:
    res = await client.get("/metrics", headers={"CF-Connecting-IP": "203.0.113.7"})
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "not_found"


async def test_metrics_serves_prometheus_text(client: AsyncClient) -> None:
    res = await client.get("/metrics")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/plain")
    for name in METRIC_NAMES:
        assert f"# TYPE {name} " in res.text


async def test_metrics_is_not_in_the_openapi_schema(client: AsyncClient) -> None:
    paths = (await client.get("/openapi.json")).json()["paths"]
    assert "/metrics" not in paths


async def test_requests_are_labelled_with_the_route_template(client: AsyncClient) -> None:
    labels = {"method": "POST", "route": CHAT_MESSAGES, "status": "503"}
    before = metric("http_requests_total", **labels)
    timed = metric("http_request_duration_seconds_count", method="POST", route=CHAT_MESSAGES)
    session_id = str(uuid.uuid4())
    res = await client.post(f"/v1/chat/sessions/{session_id}/messages", json={"question": "hi"})
    assert res.status_code == 503  # chat is not configured in tests
    assert metric("http_requests_total", **labels) == before + 1
    after = metric("http_request_duration_seconds_count", method="POST", route=CHAT_MESSAGES)
    assert after == timed + 1
    assert session_id not in (await client.get("/metrics")).text


async def test_unmatched_paths_share_one_label(client: AsyncClient) -> None:
    labels = {"method": "GET", "route": "unmatched", "status": "404"}
    before = metric("http_requests_total", **labels)
    assert (await client.get("/no/such/page")).status_code == 404
    assert metric("http_requests_total", **labels) == before + 1
    assert "/no/such/page" not in (await client.get("/metrics")).text


async def test_health_and_metrics_are_not_measured(client: AsyncClient) -> None:
    await client.get("/health")
    await client.get("/metrics")
    text = (await client.get("/metrics")).text
    assert 'route="/health"' not in text
    assert 'route="/metrics"' not in text


async def test_unhandled_errors_are_measured_as_500(settings: Settings) -> None:
    app = create_app(settings)

    async def boom() -> None:
        raise RuntimeError("boom")

    app.add_api_route("/boom", boom)
    labels = {"method": "GET", "route": "/boom", "status": "500"}
    before = metric("http_requests_total", **labels)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        assert (await c.get("/boom")).status_code == 500
    assert metric("http_requests_total", **labels) == before + 1
```

In `apps/api/tests/test_chat.py`, change the fakes import to:

```python
from tests.fakes import HIT, FakeChatModel, FakeChatSettingsSource, FakeRetriever, metric
```

and append:

```python
async def test_questions_tokens_and_budget_are_measured(db: Sessions) -> None:
    answered = metric("chat_questions_total", outcome="answered")
    no_match = metric("chat_questions_total", outcome="no_match")
    tokens_in = metric("chat_tokens_total", kind="input")
    tokens_out = metric("chat_tokens_total", kind="output")
    chat = service(db)
    session_id, _ = await chat.open_session(IP)
    await chat.ask(session_id, IP, "Has he used FastAPI?")
    assert metric("chat_questions_total", outcome="answered") == answered + 1
    assert metric("chat_tokens_total", kind="input") == tokens_in + 1000
    assert metric("chat_tokens_total", kind="output") == tokens_out + 50
    assert metric("chat_budget_used_ratio") == pytest.approx(1050 / 180_000)

    unmatched = service(db, retriever=FakeRetriever(best=0.1))
    session_id, _ = await unmatched.open_session(IP)
    await unmatched.ask(session_id, IP, "Unrelated?")
    assert metric("chat_questions_total", outcome="no_match") == no_match + 1
    assert metric("chat_tokens_total", kind="input") == tokens_in + 1000  # model not called


async def test_model_errors_are_measured(db: Sessions) -> None:
    errors = metric("chat_questions_total", outcome="error")
    chat = service(db, FakeChatModel(ModelUnavailableError("groq 500")))
    session_id, _ = await chat.open_session(IP)
    with pytest.raises(ModelUnavailableError):
        await chat.ask(session_id, IP, "q?")
    assert metric("chat_questions_total", outcome="error") == errors + 1


async def test_budget_gauge_reads_todays_stored_usage(db: Sessions) -> None:
    async with db.begin() as session:
        session.add(ChatUsageDaily(day=datetime.now(UTC).date(), tokens=90_000, requests=10))
    await service(db).refresh_budget_gauge()
    assert metric("chat_budget_used_ratio") == 0.5
```

In `apps/api/tests/test_contact.py`, change the fakes import to:

```python
from tests.fakes import FakeSender, FakeTurnstile, metric
```

and append:

```python
async def test_deliveries_are_measured(db: Sessions) -> None:
    sent = metric("contact_submissions_total", result="sent")
    failed = metric("contact_submissions_total", result="failed")
    service = ContactService(db, FakeSender(fail_times=1), mail_from="f", mail_to="t@example.com")
    submission_id = await service.submit(ContactForm("Ada", "ada@example.com", "Hello there!"))
    await service.deliver(submission_id)
    assert metric("contact_submissions_total", result="failed") == failed + 1
    assert metric("contact_submissions_total", result="sent") == sent
    await service.deliver(submission_id)
    assert metric("contact_submissions_total", result="sent") == sent + 1
    assert metric("contact_submissions_total", result="failed") == failed + 1
```

In `apps/api/tests/rag/test_indexer.py`, change the fakes import to:

```python
from tests.fakes import FakeEmbedder, metric
```

and append:

```python
async def test_sync_runs_are_measured(db: Sessions) -> None:
    ok = metric("rag_sync_runs_total", result="ok")
    error = metric("rag_sync_runs_total", result="error")
    source = FakeSource(content_with_projects())
    service = IndexService(db, source, FakeEmbedder())
    await service.sync_job()
    assert metric("rag_sync_runs_total", result="ok") == ok + 1
    source.content = DirectusError("down")
    await service.sync_job()
    assert metric("rag_sync_runs_total", result="error") == error + 1
    assert metric("rag_sync_runs_total", result="ok") == ok + 1
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `uv run pytest tests/test_metrics.py tests/test_chat.py tests/test_contact.py tests/rag/test_indexer.py -v`
Expected: collection errors in all four files: `ModuleNotFoundError: No module named 'portfolio_api.metrics'` (raised from `tests/fakes.py`).

- [ ] **Step 4: Metrics module, `/metrics` router, wiring, and feature counters**

`apps/api/src/portfolio_api/metrics.py`:

```python
"""Prometheus metrics, served at GET /metrics to the Prometheus on the compose network.

Every metric lives on one module-level registry, so building several apps in one process
(the tests do) never registers a metric twice.
"""

import time

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, disable_created_metrics
from starlette.routing import Route
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from portfolio_api.models import ChatOutcome

disable_created_metrics()  # no *_created series: half the series for nothing we query

REGISTRY = CollectorRegistry()

HTTP_REQUESTS = Counter(
    "http_requests_total",
    "HTTP requests by method, route template and status.",
    ["method", "route", "status"],
    registry=REGISTRY,
)
HTTP_REQUEST_DURATION = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration by method and route template.",
    ["method", "route"],
    registry=REGISTRY,
)
CHAT_QUESTIONS = Counter(
    "chat_questions_total", "Chat questions by outcome.", ["outcome"], registry=REGISTRY
)
CHAT_TOKENS = Counter(
    "chat_tokens_total", "Model tokens used by chat answers.", ["kind"], registry=REGISTRY
)
CHAT_BUDGET_USED_RATIO = Gauge(
    "chat_budget_used_ratio", "Today's chat tokens divided by the daily budget.", registry=REGISTRY
)
CONTACT_SUBMISSIONS = Counter(
    "contact_submissions_total",
    "Contact email delivery attempts by result.",
    ["result"],
    registry=REGISTRY,
)
RAG_SYNC_RUNS = Counter(
    "rag_sync_runs_total", "RAG index sync runs by result.", ["result"], registry=REGISTRY
)

# Children for every known label value exist from startup, so increase() sees the first event.
for _outcome in ChatOutcome:
    CHAT_QUESTIONS.labels(outcome=_outcome.value)
for _kind in ("input", "output"):
    CHAT_TOKENS.labels(kind=_kind)
for _result in ("sent", "failed"):
    CONTACT_SUBMISSIONS.labels(result=_result)
for _result in ("ok", "error"):
    RAG_SYNC_RUNS.labels(result=_result)

UNMATCHED = "unmatched"
EXCLUDED_PATHS = frozenset({"/metrics", "/health"})
# Anything else becomes "other", so a client inventing methods cannot add label values.
_METHODS = frozenset({"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"})


class RequestMetrics:
    """Count and time every HTTP request, labelled with the matched route template.

    The router writes the matched route into the scope, so it is read after the app ran.
    Requests no route matched (404s, and 413s rejected before routing) use "unmatched".
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] in EXCLUDED_PATHS:
            await self.app(scope, receive, send)
            return
        status = 500  # if the app raises before responding, the request-ID middleware sends 500

        async def send_and_capture(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        start = time.perf_counter()
        try:
            await self.app(scope, receive, send_and_capture)
        finally:
            route = scope.get("route")
            template = route.path if isinstance(route, Route) else UNMATCHED
            method = scope["method"] if scope["method"] in _METHODS else "other"
            HTTP_REQUESTS.labels(method=method, route=template, status=str(status)).inc()
            HTTP_REQUEST_DURATION.labels(method=method, route=template).observe(
                time.perf_counter() - start
            )
```

`apps/api/src/portfolio_api/routers/metrics.py`:

```python
from fastapi import APIRouter, Depends, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from portfolio_api.errors import ApiError
from portfolio_api.metrics import REGISTRY

router = APIRouter(include_in_schema=False)


async def refuse_tunnel(request: Request) -> None:
    """404 for anything that came through the Cloudflare Tunnel, the same rule as /internal."""
    if "cf-connecting-ip" in request.headers:
        raise ApiError(404, "not_found", "Not Found")


@router.get("/metrics", dependencies=[Depends(refuse_tunnel)])
async def metrics() -> Response:
    return Response(generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)
```

`apps/api/src/portfolio_api/main.py`, four edits:

1. Imports: add `from portfolio_api.metrics import RequestMetrics` after the `portfolio_api.jobs` import, and change the routers import to:

```python
from portfolio_api.routers import chat, contact, github, health, internal, metrics
```

2. Inside the `if (directus is not None and ...)` chat block, right after `jobs.append(Job("chat-retention", 86_400, chat_service.purge_expired))`:

```python
        # Sets the budget gauge at startup and lets it fall back to 0 after UTC midnight.
        jobs.append(Job("chat-budget-gauge", 300, chat_service.refresh_budget_gauge))
```

3. Replace the middleware lines

```python
    # Inside the request-ID middleware (413s get an X-Request-ID); CORS stays outermost.
    app.add_middleware(BodySizeLimit)
    install_request_id(app)
```

with

```python
    # Inside the request-ID middleware (413s get an X-Request-ID); CORS stays outermost.
    app.add_middleware(BodySizeLimit)
    # Between the two: sees 413s, and unhandled errors before they become JSON 500s.
    app.add_middleware(RequestMetrics)
    install_request_id(app)
```

4. After `app.include_router(internal.router)`:

```python
    app.include_router(metrics.router)
```

`apps/api/src/portfolio_api/services/chat.py`:

- Import, after the `portfolio_api.clients.groq` import:

```python
from portfolio_api.metrics import CHAT_BUDGET_USED_RATIO, CHAT_QUESTIONS, CHAT_TOKENS
```

- In `ask`, the model-error branch becomes (one line added before `raise`):

```python
        except (ModelBusyError, ModelUnavailableError) as exc:
            log.warning("chat model failed", error=str(exc))
            async with self._sessions.begin() as session:
                await repo.record_message(
                    session,
                    session_id=session_id,
                    question=question,
                    answer=None,
                    outcome=ChatOutcome.error,
                    sources=[],
                    input_tokens=0,
                    output_tokens=0,
                    counts=False,
                )
            CHAT_QUESTIONS.labels(outcome=ChatOutcome.error.value).inc()
            raise
```

- The rest of `ask`, from `counts = ...` to the `return`, becomes:

```python
        counts = composed.outcome == ChatOutcome.answered
        used_today: int | None = None
        async with self._sessions.begin() as session:
            await repo.record_message(
                session,
                session_id=session_id,
                question=question,
                answer=composed.raw if composed.outcome == ChatOutcome.uncited else composed.answer,
                outcome=composed.outcome,
                sources=[asdict(s) for s in composed.sources],
                input_tokens=composed.input_tokens,
                output_tokens=composed.output_tokens,
                counts=counts,
            )
            if composed.raw is not None:  # the model was called
                await repo.add_usage(
                    session, now.date(), composed.input_tokens + composed.output_tokens
                )
                used_today = await repo.tokens_used(session, now.date())
        CHAT_QUESTIONS.labels(outcome=composed.outcome.value).inc()
        if used_today is not None:
            CHAT_TOKENS.labels(kind="input").inc(composed.input_tokens)
            CHAT_TOKENS.labels(kind="output").inc(composed.output_tokens)
            CHAT_BUDGET_USED_RATIO.set(used_today / self._daily_budget)
        left = MAX_QUESTIONS - row.question_count - (1 if counts else 0)
        return ChatAnswer(composed.answer, composed.sources, composed.outcome, left)
```

- New method, directly above `purge_expired`:

```python
    async def refresh_budget_gauge(self) -> None:
        """Set chat_budget_used_ratio from today's stored usage (startup and every 5 minutes)."""
        async with self._sessions() as session:
            used = await repo.tokens_used(session, self._clock().date())
        CHAT_BUDGET_USED_RATIO.set(used / self._daily_budget)
```

(`record_usage` is left alone: only the `chat-eval` CLI calls it, in its own process, where the gauge is never scraped.)

`apps/api/src/portfolio_api/services/contact.py`:

- Import, after the `portfolio_api.clients.email` import:

```python
from portfolio_api.metrics import CONTACT_SUBMISSIONS
```

- In `deliver`, the failure and success tails become:

```python
        except EmailSendError as exc:
            async with self._sessions.begin() as session:
                attempts = await repo.record_failure(session, submission_id, str(exc))
            CONTACT_SUBMISSIONS.labels(result="failed").inc()
            if attempts >= repo.MAX_ATTEMPTS:
                log.error(
                    "contact email gave up", submission_id=str(submission_id), attempts=attempts
                )
            else:
                log.warning("contact email failed; will retry", submission_id=str(submission_id))
            return
        async with self._sessions.begin() as session:
            await repo.record_sent(session, submission_id)
        CONTACT_SUBMISSIONS.labels(result="sent").inc()
        log.info("contact email sent", submission_id=str(submission_id))
```

`apps/api/src/portfolio_api/services/indexer.py`:

- Import, before the `portfolio_api.rag.chunking` import:

```python
from portfolio_api.metrics import RAG_SYNC_RUNS
```

- `sync_job` body becomes:

```python
    async def sync_job(self) -> None:
        """For the nightly job and startup: never raises, so the job loop keeps running."""
        try:
            await self.sync()
        except Exception:
            RAG_SYNC_RUNS.labels(result="error").inc()
            log.exception("rag sync failed; index left as it was")
        else:
            RAG_SYNC_RUNS.labels(result="ok").inc()
```

(`sync_job` is what both the 15-minute job and the debounced `/internal/reindex` run, so every in-process sync is counted once.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest tests/test_metrics.py tests/test_chat.py tests/test_contact.py tests/rag/test_indexer.py -v`
Expected: all pass, including the 7 tests in `test_metrics.py` and the 5 appended feature-counter tests.

- [ ] **Step 6: Full checks and commit**

```bash
uv run ruff format . && uv run ruff check --fix .
uv run ruff check . && uv run ruff format --check . && uv run pyright && uv run pytest
git add -A apps/api
git commit -m "feat(api): Prometheus /metrics with route-template request metrics and feature counters

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: ruff clean, `0 errors` from pyright, every test passes.

---

### Task 2: `GET /v1/status` (Prometheus client, status service, endpoint)

Track A, after Task 1. All commands run from `apps/api` with the test database exported.

**Files:**
- Modify: `apps/api/src/portfolio_api/config.py`
- Create: `apps/api/src/portfolio_api/clients/prometheus.py`
- Create: `apps/api/src/portfolio_api/schemas/status.py`
- Create: `apps/api/src/portfolio_api/services/status.py`
- Create: `apps/api/src/portfolio_api/routers/status.py`
- Modify: `apps/api/src/portfolio_api/main.py`
- Create: `apps/api/tests/test_prometheus_client.py`
- Create: `apps/api/tests/test_status.py`

**Interfaces:**
- Consumes: `app.state.http` (shared `httpx.AsyncClient`), `app.state.db_ping` (the same `ping(engine)` `/health` uses), `SlidingWindowLimiter` and `client_ip` (`portfolio_api.ratelimit`), `ApiError`; metric names from Task 1 (`http_requests_total`, `http_request_duration_seconds_bucket`, label `route`, job `api`); `probe_success{job="site"}` (Prometheus config, Task 5/6); `backup_last_success_timestamp_seconds` (backup, Task 7/8).
- Produces:
  - `Settings.prometheus_url: str = "http://prometheus:9090"` (env `API_PROMETHEUS_URL`; compose needs no change, the default is the compose service).
  - `portfolio_api.clients.prometheus`: `PrometheusClient` Protocol with `async query(promql: str, at: float) -> list[float]` (instant query at unix time `at`; one value per series, `[]` when empty, NaN kept as `float("nan")`); `PrometheusError` (the only exception it raises: network error, 2 s timeout, non-200, `status != "success"`, non-vector result, unparseable body); `HttpPrometheus(http: httpx.AsyncClient, base_url: str)`; `QUERY_TIMEOUT = 2.0`.
  - `portfolio_api.schemas.status`: `StatusResponse`, `DailyUptime`.
  - `portfolio_api.services.status`: `StatusService(prometheus: PrometheusClient, db_ping: Callable[[], Awaitable[bool]], *, now: Callable[[], datetime] = utc now, monotonic: Callable[[], float] = time.monotonic)` with `async get() -> StatusResponse` (60 s memo); PromQL constants `FIRST_PROBE`, `SUCCESSES`, `P95`, `REQUESTS_SINCE`, `LAST_BACKUP`, `LATEST_PROBE`; helpers `new_york_days(now)`, `covered(day, first_probe, now)`.
  - `GET /v1/status` (`portfolio_api.routers.status.router`): always 200 with `Cache-Control: public, max-age=60`; 429 `rate_limited` with `Retry-After` past 60 requests/minute per IP (`app.state.status_limiter`).

How the numbers are computed (all PromQL is fixed in `services/status.py`; only integers the service computes are formatted in):

| Field | Query (instant, evaluated at `time=`) | Handling |
|---|---|---|
| first probe | `min(min_over_time(timestamp(probe_success{job="site"})[<window>s:1m]))` at now, `<window>` = seconds since the oldest day's New York midnight + 60 | `timestamp()` of a plain selector returns each sample's own timestamp, so the subquery minimum is within one probe interval of the first real probe. Empty → no probe yet → every day null. |
| daily uptime | `sum(sum_over_time(probe_success{job="site"}[<s>s]))` at `covered_start + s` | Per New York day `[midnight, next midnight)` computed with `zoneinfo` (23 h / 25 h on DST days). Covered = clipped to `[first_probe, now]`, `s` = whole covered seconds. `s < 30` → `null`. Uptime = `min(1, successes / (s / 30))`, rounded to 4 places. Empty result = 0 successes, so missing samples are downtime. One query per non-null day, run concurrently. |
| `uptime_30d` | (no extra query) | `min(1, Σ successes / Σ(s / 30))` over the non-null days, 4 places; `null` if none. Same formula, starting at the first probe. |
| `p95_ms` | `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{job="api",route!~"/v1/chat/.*"}[24h])))` | `round(v * 1000)`; NaN, ±Inf or empty → `null`. |
| `requests_today` | `sum(increase(http_requests_total{job="api"}[<s>s]))` at now, `s` = whole seconds since New York midnight (min 1) | `round(sum)`; empty → 0. |
| `last_backup_at` | `max(backup_last_success_timestamp_seconds)` | `YYYY-MM-DDTHH:MM:SSZ`; empty → `null`. |
| latest probe | `max(probe_success{job="site"})` | `== 1` → ok; `0` or empty (stale > 5 min) → degraded. |

Any `PrometheusError` from any query → `degraded`, every metric field `null`, 30 `daily` entries with `uptime: null`. `status` is `operational` only when Prometheus answered, `db_ping()` is true, and the latest probe is 1. Degraded results are memoized for 60 s too; nothing is served past the memo.

- [ ] **Step 1: Write the failing tests**

`apps/api/tests/test_prometheus_client.py`:

```python
import math
from typing import Any

import httpx
import pytest

from portfolio_api.clients.prometheus import HttpPrometheus, PrometheusError


def vector(*values: str) -> dict[str, Any]:
    return {
        "status": "success",
        "data": {
            "resultType": "vector",
            "result": [{"metric": {}, "value": [1791043200.0, v]} for v in values],
        },
    }


def prometheus(handler: httpx.MockTransport) -> HttpPrometheus:
    return HttpPrometheus(httpx.AsyncClient(transport=handler), "http://prometheus:9090/")


async def test_query_sends_promql_and_time_and_parses_values() -> None:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=vector("1", "0.25"))

    values = await prometheus(httpx.MockTransport(handle)).query("up", 1791043200.5)
    assert values == [1.0, 0.25]
    [request] = seen
    assert request.url.path == "/api/v1/query"
    assert request.url.params["query"] == "up"
    assert request.url.params["time"] == "1791043200.500"
    assert request.extensions["timeout"]["read"] == 2.0


async def test_empty_result_and_nan_values() -> None:
    empty = httpx.MockTransport(lambda _: httpx.Response(200, json=vector()))
    assert await prometheus(empty).query("up", 0.0) == []
    nan = httpx.MockTransport(lambda _: httpx.Response(200, json=vector("NaN")))
    [value] = await prometheus(nan).query("up", 0.0)
    assert math.isnan(value)


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(503, text="unavailable"),
        httpx.Response(400, json={"status": "error", "errorType": "bad_data", "error": "x"}),
        httpx.Response(200, json={"status": "error", "errorType": "timeout", "error": "x"}),
        httpx.Response(200, text="not json"),
        httpx.Response(
            200, json={"status": "success", "data": {"resultType": "matrix", "result": []}}
        ),
    ],
)
async def test_bad_replies_raise(response: httpx.Response) -> None:
    with pytest.raises(PrometheusError):
        await prometheus(httpx.MockTransport(lambda _: response)).query("up", 0.0)


@pytest.mark.parametrize("error", [httpx.ConnectError, httpx.ReadTimeout])
async def test_network_errors_raise(error: type[httpx.TransportError]) -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise error("down", request=request)

    with pytest.raises(PrometheusError):
        await prometheus(httpx.MockTransport(boom)).query("up", 0.0)
```

`apps/api/tests/test_status.py`:

```python
import math
import re
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from portfolio_api.clients.prometheus import PrometheusError
from portfolio_api.config import Settings
from portfolio_api.main import create_app
from portfolio_api.services.status import LAST_BACKUP, LATEST_PROBE, P95, StatusService

NOW = datetime(2026, 10, 3, 16, 0, tzinfo=UTC)  # noon in New York (EDT)
FIRST = datetime(2026, 9, 20, 4, 0, tzinfo=UTC).timestamp()  # midnight Sep 20 in New York
BACKUP = datetime(2026, 10, 3, 7, 31, 12, tzinfo=UTC).timestamp()


class FakePrometheus:
    """A probe every 30 s from ``first`` until ``now``, minus probes inside ``gaps``."""

    def __init__(
        self,
        *,
        now: datetime = NOW,
        first: float | None = FIRST,
        gaps: Sequence[tuple[datetime, datetime]] = (),
        p95: Sequence[float] = (0.08449,),
        requests: Sequence[float] = (1203.6,),
        backup: Sequence[float] = (BACKUP,),
        probe: Sequence[float] = (1.0,),
        error: PrometheusError | None = None,
    ) -> None:
        self.now = now.timestamp()
        self.first = first
        self.gaps = [(a.timestamp(), b.timestamp()) for a, b in gaps]
        self.p95 = list(p95)
        self.requests = list(requests)
        self.backup = list(backup)
        self.probe = list(probe)
        self.error = error
        self.calls: list[tuple[str, float]] = []

    def probes(self, lo: float, hi: float) -> int:
        """Probes at first + 30k (k >= 0, not after now) with lo < t <= hi."""
        if self.first is None:
            return 0
        hi = min(hi, self.now)
        k_max = math.floor((hi - self.first) / 30)
        k_min = 0 if lo < self.first else math.floor((lo - self.first) / 30) + 1
        return max(0, k_max - k_min + 1)

    def successes(self, lo: float, hi: float) -> int:
        missing = sum(
            self.probes(max(lo, g0), min(hi, g1)) for g0, g1 in self.gaps if g0 < hi and lo < g1
        )
        return self.probes(lo, hi) - missing

    async def query(self, promql: str, at: float) -> list[float]:
        self.calls.append((promql, at))
        if self.error is not None:
            raise self.error
        if "timestamp(" in promql:
            return [] if self.first is None else [self.first]
        if "sum_over_time" in promql:
            match = re.search(r"\[(\d+)s\]", promql)
            assert match is not None
            ok = self.successes(at - int(match.group(1)), at)
            return [float(ok)] if ok else []
        if "increase(" in promql:
            return self.requests
        if promql == P95:
            return self.p95
        if promql == LAST_BACKUP:
            return self.backup
        if promql == LATEST_PROBE:
            return self.probe
        raise AssertionError(f"unexpected query: {promql}")

    def ranges(self, needle: str) -> list[int]:
        found: list[int] = []
        for promql, _ in self.calls:
            match = re.search(r"\[(\d+)s\]", promql)
            if needle in promql and match is not None:
                found.append(int(match.group(1)))
        return found


async def db_up() -> bool:
    return True


async def db_down() -> bool:
    return False


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def service(
    prometheus: FakePrometheus,
    *,
    now: datetime = NOW,
    db_ok: bool = True,
    monotonic: Clock | None = None,
) -> StatusService:
    return StatusService(
        prometheus,
        db_up if db_ok else db_down,
        now=lambda: now,
        monotonic=monotonic or Clock(),
    )


def dates(last: date) -> list[str]:
    return [(last - timedelta(days=n)).isoformat() for n in range(29, -1, -1)]


def uptime(body: dict[str, Any], day: str) -> float | None:
    [entry] = [d for d in body["daily"] if d["date"] == day]
    return entry["uptime"]


async def test_operational() -> None:
    body = (await service(FakePrometheus()).get()).model_dump()
    assert body == {
        "status": "operational",
        "uptime_30d": 1.0,
        "daily": [
            {"date": d, "uptime": None if d < "2026-09-20" else 1.0}
            for d in dates(date(2026, 10, 3))
        ],
        "p95_ms": 84,
        "requests_today": 1204,
        "last_backup_at": "2026-10-03T07:31:12Z",
    }


async def test_prometheus_error_is_degraded_with_every_number_null() -> None:
    body = (await service(FakePrometheus(error=PrometheusError("down"))).get()).model_dump()
    assert body == {
        "status": "degraded",
        "uptime_30d": None,
        "daily": [{"date": d, "uptime": None} for d in dates(date(2026, 10, 3))],
        "p95_ms": None,
        "requests_today": None,
        "last_backup_at": None,
    }


async def test_failed_or_missing_latest_probe_is_degraded() -> None:
    for probe in ((0.0,), ()):
        result = await service(FakePrometheus(probe=probe)).get()
        assert result.status == "degraded"
        assert result.uptime_30d == 1.0  # the numbers are still real


async def test_database_down_is_degraded() -> None:
    result = await service(FakePrometheus(), db_ok=False).get()
    assert result.status == "degraded" and result.p95_ms == 84


async def test_missing_samples_count_as_downtime() -> None:
    gap = (datetime(2026, 10, 1, 10, tzinfo=UTC), datetime(2026, 10, 1, 16, tzinfo=UTC))
    body = (await service(FakePrometheus(gaps=[gap])).get()).model_dump()
    assert uptime(body, "2026-10-01") == 0.75  # 6 of 24 hours without samples
    assert uptime(body, "2026-09-30") == 1.0
    # 13 full days and half of today: (38880 - 720) / 38880 expected probes.
    assert body["uptime_30d"] == 0.9815


async def test_days_before_the_first_probe_are_null() -> None:
    body = (await service(FakePrometheus(first=None)).get()).model_dump()
    assert all(d["uptime"] is None for d in body["daily"])
    assert body["uptime_30d"] is None
    assert body["requests_today"] == 1204  # Prometheus answered


async def test_first_day_counts_only_from_the_first_probe() -> None:
    first = datetime(2026, 9, 20, 16, tzinfo=UTC).timestamp()  # noon Sep 20 in New York
    prometheus = FakePrometheus(first=first)
    body = (await service(prometheus).get()).model_dump()
    assert uptime(body, "2026-09-19") is None
    assert uptime(body, "2026-09-20") == 1.0
    assert 12 * 3600 in prometheus.ranges("sum_over_time")


async def test_today_counts_only_the_elapsed_part() -> None:
    gap = (datetime(2026, 10, 3, 10, tzinfo=UTC), datetime(2026, 10, 3, 13, tzinfo=UTC))
    prometheus = FakePrometheus(gaps=[gap])
    body = (await service(prometheus).get()).model_dump()
    assert uptime(body, "2026-10-03") == 0.75  # 3 of the 12 elapsed hours
    assert prometheus.ranges("sum_over_time")[-1] == 12 * 3600


async def test_dst_days_use_their_real_length() -> None:
    now = datetime(2026, 11, 2, 17, tzinfo=UTC)  # noon Nov 2 in New York (EST)
    first = datetime(2026, 10, 10, 4, tzinfo=UTC).timestamp()
    prometheus = FakePrometheus(now=now, first=first)
    body = (await service(prometheus, now=now).get()).model_dump()
    assert 25 * 3600 in prometheus.ranges("sum_over_time")  # Nov 1, clocks fell back
    assert uptime(body, "2026-11-01") == 1.0
    assert body["daily"][-1]["date"] == "2026-11-02"


async def test_p95_is_rounded_to_whole_ms_and_nan_is_null() -> None:
    cases: list[tuple[Sequence[float], int | None]] = [
        ((0.08449,), 84),
        ((0.0846,), 85),
        ((math.nan,), None),
        ((), None),
    ]
    for p95, expected in cases:
        assert (await service(FakePrometheus(p95=p95)).get()).p95_ms == expected


async def test_requests_today_starts_at_new_york_midnight() -> None:
    just_after = datetime(2026, 10, 3, 4, 0, 30, tzinfo=UTC)  # 00:00:30 EDT
    prometheus = FakePrometheus(now=just_after)
    result = await service(prometheus, now=just_after).get()
    assert prometheus.ranges("increase(") == [30]
    assert result.daily[-1].date == "2026-10-03"

    just_before = datetime(2026, 10, 3, 3, 59, 59, tzinfo=UTC)  # 23:59:59 EDT Oct 2
    prometheus = FakePrometheus(now=just_before)
    result = await service(prometheus, now=just_before).get()
    assert prometheus.ranges("increase(") == [86_399]
    assert result.daily[-1].date == "2026-10-02"


async def test_requests_today_is_zero_when_prometheus_has_no_samples() -> None:
    assert (await service(FakePrometheus(requests=())).get()).requests_today == 0


async def test_no_backup_metric_is_null() -> None:
    assert (await service(FakePrometheus(backup=())).get()).last_backup_at is None


async def test_result_is_memoized_for_60_seconds() -> None:
    prometheus = FakePrometheus()
    clock = Clock()
    status = service(prometheus, monotonic=clock)
    await status.get()
    queries = len(prometheus.calls)
    clock.t += 59
    await status.get()
    assert len(prometheus.calls) == queries
    clock.t += 2
    await status.get()
    assert len(prometheus.calls) == 2 * queries


def make_app(settings: Settings) -> FastAPI:
    app = create_app(settings)
    app.state.status_service = service(FakePrometheus())
    return app


async def test_endpoint_returns_the_status_with_cache_header(settings: Settings) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=make_app(settings)), base_url="http://t"
    ) as c:
        res = await c.get("/v1/status")
    assert res.status_code == 200
    assert res.headers["cache-control"] == "public, max-age=60"
    body = res.json()
    assert set(body) == {
        "status",
        "uptime_30d",
        "daily",
        "p95_ms",
        "requests_today",
        "last_backup_at",
    }
    assert body["status"] == "operational" and len(body["daily"]) == 30


async def test_endpoint_is_limited_to_60_a_minute_per_ip(settings: Settings) -> None:
    app = make_app(settings)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        for _ in range(60):
            assert (
                await c.get("/v1/status", headers={"CF-Connecting-IP": "1.2.3.4"})
            ).status_code == 200
        limited = await c.get("/v1/status", headers={"CF-Connecting-IP": "1.2.3.4"})
        other = await c.get("/v1/status", headers={"CF-Connecting-IP": "5.6.7.8"})
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "rate_limited"
    assert int(limited.headers["retry-after"]) >= 1
    assert other.status_code == 200


def test_status_is_wired_to_prometheus_url(settings: Settings) -> None:
    assert Settings.model_fields["prometheus_url"].default == "http://prometheus:9090"
    app = create_app(settings)
    assert isinstance(app.state.status_service, StatusService)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_prometheus_client.py tests/test_status.py -v`
Expected: collection errors: `ModuleNotFoundError: No module named 'portfolio_api.clients.prometheus'` (and the same for `portfolio_api.services.status`).

- [ ] **Step 3: Setting, client, schema, service, router, wiring**

`apps/api/src/portfolio_api/config.py`, after `embedding_cache_dir: str | None = None`:

```python

    # Phase 6: GET /v1/status reads fixed queries from the compose-network Prometheus.
    prometheus_url: str = "http://prometheus:9090"
```

`apps/api/src/portfolio_api/clients/prometheus.py`:

```python
from typing import Protocol

import httpx
from pydantic import BaseModel, Field, ValidationError

QUERY_TIMEOUT = 2.0


class PrometheusError(Exception):
    """Prometheus did not answer (network error, timeout, non-200, error status or odd body)."""


class PrometheusClient(Protocol):
    async def query(self, promql: str, at: float) -> list[float]:
        """Evaluate an instant query at unix time ``at``; one value per series, [] if none."""
        ...


class _Series(BaseModel):
    value: tuple[float, str]  # [unix time, "value"]; the value may be "NaN" or "+Inf"


class _Data(BaseModel):
    result_type: str = Field(alias="resultType")
    result: list[_Series]


class _Reply(BaseModel):
    status: str
    data: _Data | None = None


class HttpPrometheus:
    def __init__(self, http: httpx.AsyncClient, base_url: str) -> None:
        self._http = http
        self._url = base_url.rstrip("/") + "/api/v1/query"

    async def query(self, promql: str, at: float) -> list[float]:
        try:
            res = await self._http.get(
                self._url, params={"query": promql, "time": f"{at:.3f}"}, timeout=QUERY_TIMEOUT
            )
        except httpx.HTTPError as exc:
            raise PrometheusError(type(exc).__name__) from exc
        if res.status_code != 200:
            raise PrometheusError(f"prometheus {res.status_code}")
        try:
            reply = _Reply.model_validate_json(res.content)
        except ValidationError as exc:
            raise PrometheusError("prometheus returned an unexpected body") from exc
        if reply.status != "success" or reply.data is None or reply.data.result_type != "vector":
            raise PrometheusError("prometheus returned no instant vector")
        return [float(series.value[1]) for series in reply.data.result]
```

`apps/api/src/portfolio_api/schemas/status.py`:

```python
from typing import Literal

from pydantic import BaseModel


class DailyUptime(BaseModel):
    date: str  # YYYY-MM-DD, an America/New_York calendar day
    uptime: float | None


class StatusResponse(BaseModel):
    status: Literal["operational", "degraded"]
    uptime_30d: float | None
    daily: list[DailyUptime]
    p95_ms: int | None
    requests_today: int | None
    last_backup_at: str | None  # ISO 8601 UTC, e.g. 2026-10-03T07:31:12Z
```

`apps/api/src/portfolio_api/services/status.py`:

```python
import asyncio
import math
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import structlog

from portfolio_api.clients.prometheus import PrometheusClient, PrometheusError
from portfolio_api.schemas.status import DailyUptime, StatusResponse

log = structlog.get_logger()

NY = ZoneInfo("America/New_York")
DAYS = 30
PROBE_INTERVAL = 30  # seconds between site probes (the Prometheus scrape interval)
MEMO_SECONDS = 60.0

# The PromQL is fixed here. Only numbers this module computes are formatted in; nothing from
# a request ever reaches Prometheus.
#
# Earliest probe sample in the window. timestamp() of a plain selector returns each sample's
# own timestamp, so over a 1-minute-step subquery the minimum is within one probe interval of
# the first real probe. One series over 30 days at 1m is ~43k steps: a few ms, once a minute.
FIRST_PROBE = 'min(min_over_time(timestamp(probe_success{{job="site"}})[{seconds}s:1m]))'
# Successful probes in the `seconds` before the evaluation time. A missing sample adds
# nothing, so time with no probes (VM or Prometheus down) counts as downtime.
SUCCESSES = 'sum(sum_over_time(probe_success{{job="site"}}[{seconds}s]))'
P95 = (
    "histogram_quantile(0.95, sum by (le) (rate("
    'http_request_duration_seconds_bucket{job="api",route!~"/v1/chat/.*"}[24h])))'
)
REQUESTS_SINCE = 'sum(increase(http_requests_total{{job="api"}}[{seconds}s]))'
LAST_BACKUP = "max(backup_last_success_timestamp_seconds)"
LATEST_PROBE = 'max(probe_success{job="site"})'

DbPing = Callable[[], Awaitable[bool]]
Window = tuple[float, int]  # (evaluation time, whole seconds before it)


@dataclass(frozen=True)
class _Day:
    date: date
    start: float  # unix seconds of New York midnight
    end: float  # unix seconds of the next New York midnight (23 h or 25 h later on DST days)


@dataclass(frozen=True)
class _Stats:
    daily: list[float | None]
    uptime_30d: float | None
    p95_ms: int | None
    requests_today: int
    last_backup_at: str | None
    probe_ok: bool


def _utcnow() -> datetime:
    return datetime.now(UTC)


def new_york_days(now: datetime) -> list[_Day]:
    """The 30 New York calendar days ending today, oldest first."""
    today = now.astimezone(NY).date()
    days: list[_Day] = []
    for back in range(DAYS - 1, -1, -1):
        day = today - timedelta(days=back)
        start = datetime.combine(day, datetime.min.time(), NY)
        end = datetime.combine(day + timedelta(days=1), datetime.min.time(), NY)
        days.append(_Day(day, start.timestamp(), end.timestamp()))
    return days


def covered(day: _Day, first_probe: float | None, now: float) -> Window | None:
    """The part of ``day`` after the first probe and before now, or None if under one probe."""
    if first_probe is None:
        return None
    start = max(day.start, first_probe)
    seconds = int(min(day.end, now) - start)
    if seconds < PROBE_INTERVAL:
        return None
    return start + seconds, seconds


def _ratio(successes: float, seconds: int) -> float:
    # Successes over expected probes; a duplicate sample cannot push a day above 100%.
    return round(min(1.0, successes / (seconds / PROBE_INTERVAL)), 4)


class StatusService:
    """The homepage status card's numbers, from Prometheus, memoized for 60 s."""

    def __init__(
        self,
        prometheus: PrometheusClient,
        db_ping: DbPing,
        *,
        now: Callable[[], datetime] = _utcnow,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._prometheus = prometheus
        self._db_ping = db_ping
        self._now = now
        self._monotonic = monotonic
        self._lock = asyncio.Lock()
        self._cached: StatusResponse | None = None
        self._cached_at = 0.0

    async def get(self) -> StatusResponse:
        async with self._lock:  # one refresh at a time; waiters get its result
            if self._cached is None or self._monotonic() - self._cached_at >= MEMO_SECONDS:
                self._cached = await self._compute()
                self._cached_at = self._monotonic()
            return self._cached

    async def _compute(self) -> StatusResponse:
        now = self._now()
        days = new_york_days(now)
        db_ok, stats = await asyncio.gather(self._db_ping(), self._stats(now.timestamp(), days))
        if stats is None:
            return StatusResponse(
                status="degraded",
                uptime_30d=None,
                daily=[DailyUptime(date=d.date.isoformat(), uptime=None) for d in days],
                p95_ms=None,
                requests_today=None,
                last_backup_at=None,
            )
        return StatusResponse(
            status="operational" if db_ok and stats.probe_ok else "degraded",
            uptime_30d=stats.uptime_30d,
            daily=[
                DailyUptime(date=d.date.isoformat(), uptime=u)
                for d, u in zip(days, stats.daily, strict=True)
            ],
            p95_ms=stats.p95_ms,
            requests_today=stats.requests_today,
            last_backup_at=stats.last_backup_at,
        )

    async def _stats(self, now: float, days: list[_Day]) -> _Stats | None:
        query = self._prometheus.query
        try:
            first, p95, requests, backup, probe = await asyncio.gather(
                query(FIRST_PROBE.format(seconds=math.ceil(now - days[0].start) + 60), now),
                query(P95, now),
                query(REQUESTS_SINCE.format(seconds=max(1, int(now - days[-1].start))), now),
                query(LAST_BACKUP, now),
                query(LATEST_PROBE, now),
            )
            first_probe = first[0] if first else None
            windows = [covered(day, first_probe, now) for day in days]
            successes = await asyncio.gather(*(self._successes(w) for w in windows))
        except PrometheusError as exc:
            log.warning("prometheus unavailable; status degraded", error=str(exc))
            return None
        daily: list[float | None] = []
        total_successes = 0.0
        total_seconds = 0
        for window, ok in zip(windows, successes, strict=True):
            if window is None or ok is None:
                daily.append(None)
                continue
            daily.append(_ratio(ok, window[1]))
            total_successes += ok
            total_seconds += window[1]
        p95_seconds = p95[0] if p95 else math.nan
        return _Stats(
            daily=daily,
            uptime_30d=_ratio(total_successes, total_seconds) if total_seconds else None,
            p95_ms=round(p95_seconds * 1000) if math.isfinite(p95_seconds) else None,
            requests_today=round(sum(requests)),
            last_backup_at=(
                datetime.fromtimestamp(backup[0], UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
                if backup
                else None
            ),
            probe_ok=bool(probe) and probe[0] == 1.0,
        )

    async def _successes(self, window: Window | None) -> float | None:
        if window is None:
            return None
        at, seconds = window
        return sum(await self._prometheus.query(SUCCESSES.format(seconds=seconds), at))
```

`apps/api/src/portfolio_api/routers/status.py`:

```python
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from portfolio_api.errors import ApiError
from portfolio_api.ratelimit import SlidingWindowLimiter, client_ip
from portfolio_api.schemas.status import StatusResponse
from portfolio_api.services.status import StatusService

router = APIRouter(prefix="/v1", tags=["status"])


def get_status_service(request: Request) -> StatusService:
    return request.app.state.status_service


async def limit_status(request: Request) -> None:
    limiter: SlidingWindowLimiter = request.app.state.status_limiter
    wait = limiter.hit(client_ip(request) or "unknown")
    if wait is not None:
        raise ApiError(
            429,
            "rate_limited",
            "Too many requests. Try again later.",
            headers={"Retry-After": str(wait)},
        )


@router.get("/status", response_model=StatusResponse, dependencies=[Depends(limit_status)])
async def public_status(
    response: Response,
    service: Annotated[StatusService, Depends(get_status_service)],
) -> StatusResponse:
    response.headers["Cache-Control"] = "public, max-age=60"
    return await service.get()
```

`apps/api/src/portfolio_api/main.py`, four edits:

1. Imports: add `from portfolio_api.clients.prometheus import HttpPrometheus` after the `portfolio_api.clients.groq` import, `from portfolio_api.services.status import StatusService` after the `portfolio_api.services.indexer` import, and change the routers import to:

```python
from portfolio_api.routers import chat, contact, github, health, internal, metrics, status
```

2. After `app.state.chat_service = chat_service`:

```python
    app.state.status_service = StatusService(
        HttpPrometheus(http, settings.prometheus_url), app.state.db_ping
    )
    app.state.status_limiter = SlidingWindowLimiter([(60, 60)])
```

3. After `app.include_router(metrics.router)`:

```python
    app.include_router(status.router)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_prometheus_client.py tests/test_status.py -v`
Expected: all pass (9 client tests, 17 status tests).

Check the production image has the time-zone database `zoneinfo` needs (the runner is `python:3.12-slim-bookworm`, which ships `tzdata`):

```bash
docker run --rm python:3.12-slim-bookworm python -c "from zoneinfo import ZoneInfo; print(ZoneInfo('America/New_York'))"
```

Expected: `America/New_York`.

- [ ] **Step 5: Full checks and commit**

```bash
uv run ruff format . && uv run ruff check --fix .
uv run ruff check . && uv run ruff format --check . && uv run pyright && uv run pytest
git add -A apps/api
git commit -m "feat(api): GET /v1/status with 30-day uptime, p95, requests today and last backup from Prometheus

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: ruff clean, `0 errors` from pyright, every test passes.

---

### Task 3: Homepage status card

Track B (`p6-web`). Replaces the hero's one-line `LiveStatus` with the status card fed by `GET /v1/status`. The web side only depends on the JSON contract in Global Constraints, so this task can run before Track A lands; tests mock the API.

**Files:**
- Create: `apps/web/src/lib/status.ts`
- Create: `apps/web/src/lib/status.test.ts`
- Create: `apps/web/src/components/content/status-card.tsx`
- Create: `apps/web/src/components/content/status-card.test.tsx`
- Modify: `apps/web/src/app/page.tsx` (hero order; card replaces `LiveStatus`)
- Modify: `apps/web/src/app/page.test.tsx` (mock the card, assert the order)
- Delete: `apps/web/src/components/content/live-status.tsx`
- Delete: `apps/web/src/components/content/live-status.test.tsx`

**Interfaces:**
- Consumes: `GET ${API_INTERNAL_URL}/v1/status` → 200 JSON exactly as in Global Constraints (`status`, `uptime_30d`, `daily[30]`, `p95_ms`, `requests_today`, `last_backup_at`); `serverEnv().apiInternalUrl` from `@/lib/env`; tokens `bg-card`, `border-border`, `text-muted-foreground`, `text-foreground`, `bg-live`, `bg-warn`, `bg-muted`, `bg-muted-foreground`.
- Produces:
  - `@/lib/status`: `SiteStatusSchema` (zod object), `type SiteStatus = z.infer<typeof SiteStatusSchema>`; `GREEN_AT = 0.995`; `getStatus(): Promise<SiteStatus | null>` (request-time via `connection()`, 2 s timeout, 60 s in-process memo of the result including `null`, `null` on any failure or when `API_INTERNAL_URL` is unset); `formatPercent(ratio: number): string` (`0.9997` → `"99.97%"`); `dayLabel(day: { date: string; uptime: number | null }): string` (`"Oct 3: 99.97%"`, `"Oct 3: no data"`); `formatAgo(iso: string, now?: number): string` (`"12m ago"`, `"3h ago"`, `"2d ago"`, minimum `"1m ago"`).
  - `@/components/content/status-card`: `async function StatusCard(): Promise<JSX.Element>` and `function StatusCardSkeleton(): JSX.Element`. The card root is `<section aria-label="Site status">`. Each data bar is `role="img"` with `title` and `aria-label` equal to its `dayLabel` (or `"no data"` when the API is unreachable); skeleton bars are `aria-hidden` and carry no label.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/status.test.ts`:

```ts
import { connection } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as StatusModule from "./status";

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));

const fetchMock = vi.fn();
let mod: typeof StatusModule;

// 2026-09-04 .. 2026-10-03, oldest first, last is today.
const DATES = Array.from({ length: 30 }, (_, i) =>
  new Date(Date.UTC(2026, 8, 4 + i)).toISOString().slice(0, 10),
);

const OK_BODY = {
  status: "operational",
  uptime_30d: 0.9998,
  daily: DATES.map((date) => ({ date, uptime: 1 })),
  p95_ms: 84,
  requests_today: 1204,
  last_backup_at: "2026-10-03T07:31:12Z",
};

beforeEach(async () => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_INTERNAL_URL", "http://api:8000");
  // Fresh module per test: the last result is memoised at module level.
  vi.resetModules();
  mod = await import("./status");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
  vi.mocked(connection).mockClear();
});

describe("getStatus", () => {
  it("fetches /v1/status at request time without the Next data cache and returns the parsed body", async () => {
    fetchMock.mockResolvedValue(Response.json(OK_BODY));
    await expect(mod.getStatus()).resolves.toEqual(OK_BODY);
    expect(connection).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api:8000/v1/status",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
  });

  it("accepts all-null metrics (Prometheus down)", async () => {
    const body = {
      status: "degraded",
      uptime_30d: null,
      daily: DATES.map((date) => ({ date, uptime: null })),
      p95_ms: null,
      requests_today: null,
      last_backup_at: null,
    };
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(mod.getStatus()).resolves.toEqual(body);
  });

  it("accepts a +00:00 offset on last_backup_at", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ ...OK_BODY, last_backup_at: "2026-10-03T07:31:12+00:00" }),
    );
    expect((await mod.getStatus())?.last_backup_at).toBe("2026-10-03T07:31:12+00:00");
  });

  it("returns null without calling fetch when API_INTERNAL_URL is unset", async () => {
    vi.stubEnv("API_INTERNAL_URL", "");
    await expect(mod.getStatus()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-200 response", () => Response.json(OK_BODY, { status: 503 })],
    ["invalid JSON", () => new Response("not json", { status: 200 })],
    ["an unknown status value", () => Response.json({ ...OK_BODY, status: "ok" })],
    ["29 daily entries", () => Response.json({ ...OK_BODY, daily: OK_BODY.daily.slice(1) })],
    ["a fractional p95", () => Response.json({ ...OK_BODY, p95_ms: 84.5 })],
    ["a non-ISO backup time", () => Response.json({ ...OK_BODY, last_backup_at: "yesterday" })],
  ])("returns null for %s", async (_name, make) => {
    fetchMock.mockResolvedValue(make());
    await expect(mod.getStatus()).resolves.toBeNull();
  });

  it("returns null when the request fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(mod.getStatus()).resolves.toBeNull();
  });

  it("returns null when the API exceeds the 2 second timeout", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const started = Date.now();
    await expect(mod.getStatus()).resolves.toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
  });

  it("reuses the last result for 60 seconds, then fetches again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
    fetchMock.mockResolvedValueOnce(Response.json(OK_BODY));
    await mod.getStatus();

    vi.setSystemTime(new Date("2026-10-03T12:00:59Z"));
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(mod.getStatus()).resolves.toEqual(OK_BODY);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-10-03T12:01:01Z"));
    await expect(mod.getStatus()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("memoises a failed result too", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await mod.getStatus();

    vi.setSystemTime(new Date("2026-10-03T12:00:30Z"));
    fetchMock.mockResolvedValueOnce(Response.json(OK_BODY));
    await expect(mod.getStatus()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("formatPercent", () => {
  it.each([
    [0.9998, "99.98%"],
    [0.9997, "99.97%"],
    [1, "100.00%"],
    [0.995, "99.50%"],
    [0, "0.00%"],
  ])("%d -> %s", (ratio, text) => {
    expect(mod.formatPercent(ratio)).toBe(text);
  });
});

describe("dayLabel", () => {
  it("formats the date in UTC with the day's uptime", () => {
    expect(mod.dayLabel({ date: "2026-10-03", uptime: 0.9997 })).toBe("Oct 3: 99.97%");
    expect(mod.dayLabel({ date: "2026-09-04", uptime: 1 })).toBe("Sep 4: 100.00%");
  });

  it("says no data for a null day", () => {
    expect(mod.dayLabel({ date: "2026-10-03", uptime: null })).toBe("Oct 3: no data");
  });
});

describe("formatAgo", () => {
  const now = Date.parse("2026-10-03T12:00:00Z");
  it.each([
    ["2026-10-03T11:59:30Z", "1m ago"],
    ["2026-10-03T11:48:00Z", "12m ago"],
    ["2026-10-03T11:00:01Z", "59m ago"],
    ["2026-10-03T11:00:00Z", "1h ago"],
    ["2026-10-03T09:00:00Z", "3h ago"],
    ["2026-10-02T12:00:01Z", "23h ago"],
    ["2026-10-02T12:00:00Z", "1d ago"],
    ["2026-10-01T10:00:00Z", "2d ago"],
    ["2026-10-03T12:05:00Z", "1m ago"],
  ])("%s -> %s", (iso, text) => {
    expect(mod.formatAgo(iso, now)).toBe(text);
  });
});
```

`apps/web/src/components/content/status-card.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getStatus, type SiteStatus } from "@/lib/status";

import { StatusCard, StatusCardSkeleton } from "./status-card";

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("@/lib/status", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/status")>()),
  getStatus: vi.fn(),
}));

const DATES = Array.from({ length: 30 }, (_, i) =>
  new Date(Date.UTC(2026, 8, 4 + i)).toISOString().slice(0, 10),
);

function status(over: Partial<SiteStatus> = {}): SiteStatus {
  return {
    status: "operational",
    uptime_30d: 0.9998,
    daily: DATES.map((date, i) => ({ date, uptime: i === 29 ? 0.9997 : 1 })),
    p95_ms: 84,
    requests_today: 1204,
    last_backup_at: "2026-10-03T09:00:00Z",
    ...over,
  };
}

function row(label: string): string | null | undefined {
  return screen.getByText(label).nextElementSibling?.textContent;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(getStatus).mockReset();
});

describe("StatusCard", () => {
  it("shows the operational header, every stat, and 30 labelled bars", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
    vi.mocked(getStatus).mockResolvedValue(status());
    const { container } = render(await StatusCard());

    expect(screen.getByRole("region", { name: "Site status" })).toBeTruthy();
    expect(screen.getByText("all systems operational · self-hosted on Proxmox")).toBeTruthy();
    expect(container.querySelector("p > .bg-live")).toBeTruthy();
    expect(row("uptime (30d)")).toBe("99.98%");
    expect(row("api response (p95)")).toBe("84 ms");
    expect(row("requests today")).toBe("1,204");
    expect(row("last backup")).toBe("3h ago · encrypted · R2");
    expect(row("stack")).toBe("Proxmox · Docker · Cloudflare Tunnel");
    expect(screen.getByText("30 days ago")).toBeTruthy();
    expect(screen.getByText("today")).toBeTruthy();

    const bars = screen.getAllByRole("img");
    expect(bars).toHaveLength(30);
    expect(bars[0].getAttribute("aria-label")).toBe("Sep 4: 100.00%");
    const last = screen.getByRole("img", { name: "Oct 3: 99.97%" });
    expect(last).toBe(bars[29]);
    expect(last.getAttribute("title")).toBe("Oct 3: 99.97%");
  });

  it("shows the degraded header with an amber dot but keeps real values", async () => {
    vi.mocked(getStatus).mockResolvedValue(status({ status: "degraded" }));
    const { container } = render(await StatusCard());

    expect(screen.getByText("degraded · self-hosted on Proxmox")).toBeTruthy();
    expect(container.querySelector("p > .bg-warn")).toBeTruthy();
    expect(container.querySelector("p > .bg-live")).toBeNull();
    expect(row("api response (p95)")).toBe("84 ms");
  });

  it("shows — for every null value and muted bars for null days", async () => {
    vi.mocked(getStatus).mockResolvedValue({
      status: "degraded",
      uptime_30d: null,
      daily: DATES.map((date) => ({ date, uptime: null })),
      p95_ms: null,
      requests_today: null,
      last_backup_at: null,
    });
    const { container } = render(await StatusCard());

    expect(screen.getByText("degraded · self-hosted on Proxmox")).toBeTruthy();
    for (const label of ["uptime (30d)", "api response (p95)", "requests today", "last backup"]) {
      expect(row(label)).toBe("—");
    }
    expect(row("stack")).toBe("Proxmox · Docker · Cloudflare Tunnel");
    const bars = screen.getAllByRole("img");
    expect(bars).toHaveLength(30);
    expect(bars[29].getAttribute("aria-label")).toBe("Oct 3: no data");
    for (const bar of bars) expect(bar.className).toContain("bg-muted-foreground/30");
    expect(container.querySelector('[role="img"].bg-live')).toBeNull();
  });

  it("renders the degraded card with — and 30 muted bars when the API is unreachable", async () => {
    vi.mocked(getStatus).mockResolvedValue(null);
    const { container } = render(await StatusCard());

    expect(screen.getByText("degraded · self-hosted on Proxmox")).toBeTruthy();
    expect(container.querySelector("p > .bg-warn")).toBeTruthy();
    for (const label of ["uptime (30d)", "api response (p95)", "requests today", "last backup"]) {
      expect(row(label)).toBe("—");
    }
    const bars = screen.getAllByRole("img", { name: "no data" });
    expect(bars).toHaveLength(30);
    for (const bar of bars) expect(bar.className).toContain("bg-muted-foreground/30");
  });

  it("colours a day green at 99.5% or more, amber below, muted when null", async () => {
    const daily = DATES.map((date) => ({ date, uptime: 1 as number | null }));
    daily[0].uptime = 0.995;
    daily[1].uptime = 0.9949;
    daily[2].uptime = null;
    vi.mocked(getStatus).mockResolvedValue(status({ daily }));
    render(await StatusCard());

    expect(screen.getByRole("img", { name: "Sep 4: 99.50%" }).className).toContain("bg-live");
    const amber = screen.getByRole("img", { name: "Sep 5: 99.49%" });
    expect(amber.className).toContain("bg-warn");
    expect(amber.className).not.toContain("bg-live");
    expect(screen.getByRole("img", { name: "Sep 6: no data" }).className).toContain(
      "bg-muted-foreground/30",
    );
  });

  it("is full width on phones and capped at 380px from md up", async () => {
    vi.mocked(getStatus).mockResolvedValue(status());
    render(await StatusCard());

    const card = screen.getByRole("region", { name: "Site status" });
    expect(card.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["w-full", "md:max-w-[380px]", "bg-card", "border-border"]),
    );
  });
});

describe("StatusCardSkeleton", () => {
  it("says checking status and claims nothing", () => {
    const { container } = render(<StatusCardSkeleton />);

    expect(screen.getByText("checking status · self-hosted on Proxmox")).toBeTruthy();
    expect(container.querySelector(".bg-live")).toBeNull();
    expect(container.querySelector(".bg-warn")).toBeNull();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.getByText("uptime (30d)")).toBeTruthy();
    expect(screen.getByText("30 days ago")).toBeTruthy();
  });
});
```

`apps/web/src/app/page.test.tsx`: replace the `vi.mock("@/components/content/live-status", ...)` block with:

```tsx
vi.mock("@/components/content/status-card", () => ({
  StatusCard: () => <p>status card stub</p>,
  StatusCardSkeleton: () => <p>checking</p>,
}));
```

In the test `renders the prompt, name, intro, status line, and both action rows`, rename it to `renders the prompt, name, intro, both action rows, and the status card` and replace

```tsx
    expect(screen.getByText("status line stub")).toBeTruthy();
```

with

```tsx
    expect(screen.getByText("status card stub")).toBeTruthy();
```

Then add this test at the end of `describe("HomePage hero", ...)`:

```tsx
  it("orders intro, resume and contact buttons, GitHub and LinkedIn, then the status card", async () => {
    render(await HomePage());

    const order = [
      screen.getByText(profile.intro),
      screen.getByRole("link", { name: "Download resume" }),
      screen.getByRole("link", { name: "Get in touch" }),
      screen.getByRole("link", { name: "GitHub" }),
      screen.getByRole("link", { name: "LinkedIn" }),
      screen.getByText("status card stub"),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
    // The card sits in the same text column as the intro.
    expect(screen.getByText("status card stub").closest(".order-3")).toBe(
      screen.getByText(profile.intro).parentElement,
    );
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --dir apps/web test src/lib/status.test.ts src/components/content/status-card.test.tsx src/app/page.test.tsx`
Expected: FAIL. `status.test.ts` and `status-card.test.tsx` fail with `Failed to resolve import "./status"` / `"./status-card"` (or `"@/lib/status"`); `page.test.tsx` fails because `status card stub` is not found (the page still renders `LiveStatus`).

- [ ] **Step 3: Implement**

`apps/web/src/lib/status.ts`:

```ts
import { connection } from "next/server";
import { z } from "zod";

import { serverEnv } from "@/lib/env";

const MEMO_MS = 60_000;
const TIMEOUT_MS = 2_000;

/** A day's bar is green at or above this uptime ratio, amber below. */
export const GREEN_AT = 0.995;

const ratio = z.number().min(0).max(1);

// Mirrors GET /v1/status exactly. Anything else is treated as "API unreachable".
export const SiteStatusSchema = z.object({
  status: z.enum(["operational", "degraded"]),
  uptime_30d: ratio.nullable(),
  daily: z.array(z.object({ date: z.iso.date(), uptime: ratio.nullable() })).length(30),
  p95_ms: z.number().int().nonnegative().nullable(),
  requests_today: z.number().int().nonnegative().nullable(),
  last_backup_at: z.iso.datetime({ offset: true }).nullable(),
});

export type SiteStatus = z.infer<typeof SiteStatusSchema>;

// Last observed result (including a failure), reused for 60s so every homepage view does not
// hit the API. Not the Next data cache: that would keep serving stale numbers while the API is down.
let memo: { value: SiteStatus | null; at: number } | undefined;

async function fetchStatus(apiInternalUrl: string): Promise<SiteStatus | null> {
  try {
    const res = await fetch(`${apiInternalUrl}/v1/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const parsed = SiteStatusSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Request-time only (connection() keeps `next build` from calling the API). Null on any failure. */
export async function getStatus(): Promise<SiteStatus | null> {
  await connection();
  const { apiInternalUrl } = serverEnv();
  if (!apiInternalUrl) return null;
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.value;
  const value = await fetchStatus(apiInternalUrl);
  memo = { value, at: Date.now() };
  return value;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

const dayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** "Oct 3: 99.97%". The date is already an America/New_York calendar day, so format it as UTC. */
export function dayLabel(day: { date: string; uptime: number | null }): string {
  const date = dayFormat.format(new Date(`${day.date}T00:00:00Z`));
  return `${date}: ${day.uptime === null ? "no data" : formatPercent(day.uptime)}`;
}

/** "12m ago", "3h ago", "2d ago". Never below "1m ago", even with clock skew. */
export function formatAgo(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
```

`apps/web/src/components/content/status-card.tsx`:

```tsx
import type { ReactNode } from "react";

import { GREEN_AT, dayLabel, formatAgo, formatPercent, getStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

const DAYS = 30;
const NONE = "—";
const STACK = "Proxmox · Docker · Cloudflare Tunnel";
const MUTED_BAR = "bg-muted-foreground/30";

type Bar = { key: string; label: string | null; className: string };

function show<T>(value: T | null | undefined, format: (value: T) => string): string {
  return value === null || value === undefined ? NONE : format(value);
}

function barClass(uptime: number | null): string {
  if (uptime === null) return MUTED_BAR;
  return uptime >= GREEN_AT ? "bg-live" : "bg-warn";
}

function Frame({ dot, headline, children }: { dot: string; headline: string; children: ReactNode }) {
  return (
    <section
      aria-label="Site status"
      className="w-full rounded-[10px] border border-border bg-card px-4 py-3.5 font-mono text-[11.5px] text-muted-foreground md:max-w-[380px]"
    >
      <p className="mb-2 flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={cn("inline-block size-[7px] shrink-0 rounded-full", dot)}
        />
        {`${headline} · self-hosted on Proxmox`}
      </p>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <dt>{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}

function Bars({ bars }: { bars: Bar[] }) {
  return (
    <>
      <div className="mt-1 mb-1.5 flex gap-0.5">
        {bars.map((bar) =>
          bar.label ? (
            <span
              key={bar.key}
              role="img"
              title={bar.label}
              aria-label={bar.label}
              className={cn("h-[18px] flex-1 rounded-[2px] opacity-85", bar.className)}
            />
          ) : (
            <span
              key={bar.key}
              aria-hidden="true"
              className={cn("h-[18px] flex-1 rounded-[2px]", bar.className)}
            />
          ),
        )}
      </div>
      <div className="mb-1.5 flex justify-between text-[10px]">
        <span>30 days ago</span>
        <span>today</span>
      </div>
    </>
  );
}

function Pending() {
  return <span aria-hidden="true" className="inline-block h-3 w-12 animate-pulse rounded bg-muted" />;
}

// Suspense fallback while /v1/status loads; claims nothing about health.
export function StatusCardSkeleton() {
  const bars = Array.from({ length: DAYS }, (_, i) => ({
    key: String(i),
    label: null,
    className: `animate-pulse ${MUTED_BAR}`,
  }));
  return (
    <Frame dot="bg-muted-foreground/40" headline="checking status">
      <dl>
        <Row label="uptime (30d)" value={<Pending />} />
      </dl>
      <Bars bars={bars} />
      <dl>
        <Row label="api response (p95)" value={<Pending />} />
        <Row label="requests today" value={<Pending />} />
        <Row label="last backup" value={<Pending />} />
        <Row label="stack" value={STACK} />
      </dl>
    </Frame>
  );
}

// Never claims health it did not observe: an unreachable API renders "degraded" with no numbers.
export async function StatusCard() {
  const status = await getStatus();
  const operational = status?.status === "operational";
  const bars: Bar[] = status
    ? status.daily.map((day) => ({
        key: day.date,
        label: dayLabel(day),
        className: barClass(day.uptime),
      }))
    : Array.from({ length: DAYS }, (_, i) => ({
        key: String(i),
        label: "no data",
        className: MUTED_BAR,
      }));

  return (
    <Frame
      dot={operational ? "bg-live" : "bg-warn"}
      headline={operational ? "all systems operational" : "degraded"}
    >
      <dl>
        <Row label="uptime (30d)" value={show(status?.uptime_30d, formatPercent)} />
      </dl>
      <Bars bars={bars} />
      <dl>
        <Row label="api response (p95)" value={show(status?.p95_ms, (ms) => `${ms} ms`)} />
        <Row
          label="requests today"
          value={show(status?.requests_today, (n) => n.toLocaleString("en-US"))}
        />
        <Row
          label="last backup"
          value={show(status?.last_backup_at, (iso) => `${formatAgo(iso)} · encrypted · R2`)}
        />
        <Row label="stack" value={STACK} />
      </dl>
    </Frame>
  );
}
```

`apps/web/src/app/page.tsx`:

1. Replace the import line

```tsx
import { LiveStatus, LiveStatusFallback } from "@/components/content/live-status";
```

with

```tsx
import { StatusCard, StatusCardSkeleton } from "@/components/content/status-card";
```

2. Replace the whole `<div className="order-3 md:mt-4"> … </div>` block (from `<div className="order-3 md:mt-4">` through its closing `</div>`, just before the closing `</div>` of `contents md:block`) with:

```tsx
          <div className="order-3 md:mt-4">
            {profile?.intro ? (
              <p
                data-cms="profile-intro"
                className="mb-4 max-w-[46ch] text-[15.5px] leading-relaxed text-muted-foreground"
              >
                {profile.intro}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2.5">
              <Link href="/resume" className={primaryButton}>
                Download resume
              </Link>
              <Link href="/contact" className={outlineButton}>
                Get in touch
              </Link>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2.5">
              <a href={githubUrl} target="_blank" rel="noopener noreferrer" className={ghostLink}>
                <GitHubIcon className="size-4" aria-hidden="true" />
                GitHub
              </a>
              <a href={linkedinUrl} target="_blank" rel="noopener noreferrer" className={ghostLink}>
                <LinkedInIcon className="size-4" aria-hidden="true" />
                LinkedIn
              </a>
            </div>
            <div className="mt-5">
              {/* Streams in: a slow or down API never delays the rest of the page. */}
              <Suspense fallback={<StatusCardSkeleton />}>
                <StatusCard />
              </Suspense>
            </div>
          </div>
```

Delete the old component and its test:

```bash
git rm apps/web/src/components/content/live-status.tsx apps/web/src/components/content/live-status.test.tsx
grep -rn "live-status\|LiveStatus" apps/web/src && exit 1 || true
```

Expected: the grep prints nothing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --dir apps/web test src/lib/status.test.ts src/components/content/status-card.test.tsx src/app/page.test.tsx`
Expected: PASS (the timeout test takes about 2 s).

- [ ] **Step 5: Full checks and commit**

```bash
pnpm --dir apps/web format:write
pnpm --dir apps/web lint && pnpm --dir apps/web typecheck && pnpm --dir apps/web format && pnpm --dir apps/web test && pnpm --dir apps/web build
```

Expected: all pass; `build` succeeds with no env vars set (`getStatus` calls `connection()`, so nothing fetches at build time).

```bash
git add -A apps/web
git commit -m "feat(web): homepage status card with 30-day uptime bars, replacing LiveStatus

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Umami tracker, proxy rewrites, and the five events

Track B (`p6-web`), after Task 3.

**Design notes (binding for this task):**
- **Tracker tag:** a plain `<script defer …>` rendered by an async server component inside `<Suspense fallback={null}>` in the root layout, not `next/script`. Reasons: the markup is exactly the Global Constraints tag, server-rendered so it loads with the first HTML, no client JS is added, and `renderToStaticMarkup` can assert it. `await connection()` makes it read `UMAMI_WEBSITE_ID` at request time, so a `pnpm build` with no env (CI, Docker) never bakes analytics in or out. The Suspense boundary keeps that dynamic read from blocking the layout; this is the same pattern as `ChatSlot`.
- **`outbound-click` is declarative** (`data-umami-event="outbound-click" data-umami-event-to=…`), as the spec prefers. Every external link opens in a new tab (`target="_blank"`), and Umami's click handler never intercepts those links.
- **`resume-download` uses `track()`, not data attributes.** For same-tab links, Umami's declarative click handler calls `preventDefault()` and then sets `location.href`. That would break the `download` attribute on the PDF link and turn the `/resume` `<Link>` into a full page reload. A small client component, `ResumeLink`, calls `track("resume-download", { from: window.location.pathname })` on click instead.
- **Which links count as resume downloads:** every link labelled as a resume download: the hero's `Download resume` (→ `/resume`), the experience page's `Download full resume` (→ `/resume`), and on `/resume` both `Download PDF` and the `Open the resume PDF` fallback. `from` tells them apart (`/`, `/experience`, `/resume`). The header nav's `resume` item is navigation, not a download, so it is not tracked.
- **`outbound-click` call sites and `to`:** hero GitHub/LinkedIn (`github`/`linkedin`); footer GitHub/LinkedIn; contact page `Open LinkedIn profile`/`Open GitHub profile`; GitHub activity card (`github`); `SectionHeading` external link (hostname: `github`/`linkedin`/`other`); project page `Source code` (`repo`) and `Live site` (`live`); education `View credential` (`other`). Links inside Markdown bodies (blog posts and project write-ups) are not tagged, because tagging them would mean a rehype plugin, which is out of scope. Chat source links are internal.

**Files:**
- Create: `apps/web/src/lib/analytics.ts`
- Create: `apps/web/src/lib/analytics.test.ts`
- Create: `apps/web/src/components/analytics/umami-script.tsx`
- Create: `apps/web/src/components/analytics/umami-script.test.tsx`
- Create: `apps/web/src/components/analytics/resume-link.tsx`
- Create: `apps/web/src/next-config.test.ts`
- Modify: `apps/web/next.config.ts` (rewrites)
- Modify: `apps/web/src/lib/env.ts`, `apps/web/src/lib/env.test.ts` (`umamiWebsiteId`)
- Modify: `apps/web/src/app/layout.tsx` (tracker)
- Modify: `apps/web/src/components/chat/chat-launcher.tsx`, `chat-launcher.test.tsx` (`chat-open`)
- Modify: `apps/web/src/components/chat/chat-terminal.tsx`, `chat-terminal.test.tsx` (`chat-question`)
- Modify: `apps/web/src/components/contact/contact-form.tsx`, `contact-form.test.tsx` (`contact-sent`)
- Modify: `apps/web/src/app/page.tsx`, `page.test.tsx`; `apps/web/src/app/experience/page.tsx`, `page.test.tsx`; `apps/web/src/app/resume/page.tsx`, `page.test.tsx` (`resume-download`; hero outbound)
- Modify: `apps/web/src/components/layout/site-footer.tsx`, `site-footer.test.tsx`; `apps/web/src/app/contact/page.tsx`, `page.test.tsx`; `apps/web/src/app/projects/[slug]/page.tsx`, `page.test.tsx`; `apps/web/src/app/education/page.tsx`, `page.test.tsx`; `apps/web/src/components/content/github-activity.tsx`, `github-activity.test.tsx`; `apps/web/src/components/content/section-heading.tsx`, `primitives.test.tsx` (`outbound-click`)

**Interfaces:**
- Consumes: runtime env `UMAMI_WEBSITE_ID` (optional; the compose `web` service passes `UMAMI_WEBSITE_ID: ${UMAMI_WEBSITE_ID:-}`, which Track C owns); the `umami` compose service on `umami:3000` (Track C); Umami's browser API `window.umami.track(name, data?)`.
- Produces:
  - `@/lib/analytics`: `type AnalyticsEvent = "resume-download" | "chat-open" | "chat-question" | "contact-sent" | "outbound-click"`; `type OutboundTarget = "github" | "linkedin" | "repo" | "live" | "other"`; `track<E extends AnalyticsEvent>(name: E, ...data: EventData[E] extends undefined ? [] : [EventData[E]]): void`, where `EventData` maps `resume-download` → `{ from: string }`, `outbound-click` → `{ to: OutboundTarget }`, and the other three → `undefined` (passing data to them is a type error, so question text can never be sent). It does nothing when `window.umami` is absent. Also `outboundProps(to: OutboundTarget): { "data-umami-event": "outbound-click"; "data-umami-event-to": OutboundTarget }` and `outboundTargetFor(href: string): OutboundTarget`. Also a global `Window.umami?: { track(name: string, data?: Record<string, string>): void }`.
  - `@/components/analytics/umami-script`: `async function UmamiScript(): Promise<JSX.Element | null>`.
  - `@/components/analytics/resume-link`: `ResumeLink` (client) with props `{ kind: "page" | "file"; href: string; download?: string; className?: string; children: ReactNode }`. `"page"` renders `next/link`, and `"file"` renders `<a>`.
  - `serverEnv().umamiWebsiteId: string | undefined`.
  - `next.config.ts` `rewrites()` → `[{ source: "/stats/script.js", destination: "http://umami:3000/script.js" }, { source: "/stats/api/send", destination: "http://umami:3000/api/send" }]`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/analytics.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { outboundProps, outboundTargetFor, track } from "./analytics";

afterEach(() => {
  delete window.umami;
});

describe("track", () => {
  it("does nothing when the Umami tracker has not loaded", () => {
    expect(window.umami).toBeUndefined();
    expect(() => track("chat-open")).not.toThrow();
    expect(() => track("resume-download", { from: "/" })).not.toThrow();
  });

  it("sends events without data as a bare name", () => {
    const umamiTrack = vi.fn();
    window.umami = { track: umamiTrack };
    track("chat-question");
    expect(umamiTrack.mock.calls).toEqual([["chat-question"]]);
  });

  it("sends event data when the event has some", () => {
    const umamiTrack = vi.fn();
    window.umami = { track: umamiTrack };
    track("resume-download", { from: "/experience" });
    expect(umamiTrack.mock.calls).toEqual([["resume-download", { from: "/experience" }]]);
  });
});

describe("outboundProps", () => {
  it("returns Umami's declarative click attributes", () => {
    expect(outboundProps("repo")).toEqual({
      "data-umami-event": "outbound-click",
      "data-umami-event-to": "repo",
    });
  });
});

describe("outboundTargetFor", () => {
  it.each([
    ["https://github.com/octo", "github"],
    ["https://www.github.com/octo", "github"],
    ["https://www.linkedin.com/in/someone/", "linkedin"],
    ["https://linkedin.com/in/someone", "linkedin"],
    ["https://notgithub.com/octo", "other"],
    ["https://example.com", "other"],
    ["http//broken", "other"],
  ])("%s -> %s", (href, to) => {
    expect(outboundTargetFor(href)).toBe(to);
  });
});
```

`apps/web/src/components/analytics/umami-script.test.tsx`:

```tsx
import { connection } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UmamiScript } from "./umami-script";

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(connection).mockClear();
});

describe("UmamiScript", () => {
  it("renders nothing when UMAMI_WEBSITE_ID is unset, and reads it at request time", async () => {
    vi.stubEnv("UMAMI_WEBSITE_ID", "");
    await expect(UmamiScript()).resolves.toBeNull();
    expect(connection).toHaveBeenCalled();
  });

  it("renders the proxied tracker when UMAMI_WEBSITE_ID is set", async () => {
    vi.stubEnv("UMAMI_WEBSITE_ID", "6b1f0c2e-1d2a-4c3b-9e8f-0a1b2c3d4e5f");
    const element = await UmamiScript();
    expect(renderToStaticMarkup(element!)).toBe(
      '<script defer="" src="/stats/script.js" data-website-id="6b1f0c2e-1d2a-4c3b-9e8f-0a1b2c3d4e5f" data-host-url="/stats"></script>',
    );
  });
});
```

`apps/web/src/next-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";

describe("next.config", () => {
  it("proxies the Umami tracker and collector under /stats", async () => {
    expect(await nextConfig.rewrites?.()).toEqual([
      { source: "/stats/script.js", destination: "http://umami:3000/script.js" },
      { source: "/stats/api/send", destination: "http://umami:3000/api/send" },
    ]);
  });

  it("keeps the standalone output and image formats", () => {
    expect(nextConfig.output).toBe("standalone");
    expect(nextConfig.images).toEqual({ formats: ["image/avif", "image/webp"] });
  });
});
```

`apps/web/src/lib/env.test.ts`: in the first test add `vi.stubEnv("UMAMI_WEBSITE_ID", "site-id");` after the `PUBLIC_API_URL` stub and add `umamiWebsiteId: "site-id",` as the last key of the expected object. In the second test add `"UMAMI_WEBSITE_ID",` as the last entry of the name list and `umamiWebsiteId: undefined,` as the last key of the expected object.

`apps/web/src/components/chat/chat-launcher.test.tsx`: append at the end of the file:

```tsx
describe("ChatLauncher analytics", () => {
  const umamiTrack = vi.fn();

  beforeEach(() => {
    window.umami = { track: umamiTrack };
  });

  afterEach(() => {
    delete window.umami;
    umamiTrack.mockReset();
  });

  it("tracks chat-open when the pill opens the terminal", async () => {
    await renderLauncher();
    await act(async () => {
      fireEvent.click(pill()!);
    });
    expect(umamiTrack.mock.calls).toEqual([["chat-open"]]);
  });

  it("tracks chat-open when ⌘K opens the terminal, but not when ⌘K closes it", async () => {
    await renderLauncher();
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });
    expect(await screen.findByRole("region", { name: "Ask about Chris" })).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });
    expect(umamiTrack.mock.calls).toEqual([["chat-open"]]);
  });
});
```

`apps/web/src/components/chat/chat-terminal.test.tsx`: change the import `import { CHAT_MESSAGES } from "@/lib/chat";` to `import { CHAT_LIMITS, CHAT_MESSAGES } from "@/lib/chat";`, add `delete window.umami;` as the last line of the existing top-level `afterEach`, and append:

```tsx
describe("ChatTerminal analytics", () => {
  it("tracks chat-question with no data, never the question text", async () => {
    const umamiTrack = vi.fn();
    window.umami = { track: umamiTrack };
    await renderTerminal();
    await ask("Has he used FastAPI? My email is ada@example.com");
    expect(umamiTrack.mock.calls).toEqual([["chat-question"]]);
  });

  it("tracks a clicked suggestion as a question", async () => {
    const umamiTrack = vi.fn();
    window.umami = { track: umamiTrack };
    await renderTerminal();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "[1] What projects has Chris built?" }));
    });
    expect(umamiTrack.mock.calls).toEqual([["chat-question"]]);
  });

  it("does not track a question that is too long to send", async () => {
    const umamiTrack = vi.fn();
    window.umami = { track: umamiTrack };
    await renderTerminal();
    await ask("x".repeat(CHAT_LIMITS.question + 1));
    expect(umamiTrack).not.toHaveBeenCalled();
  });
});
```

`apps/web/src/components/contact/contact-form.test.tsx`: add `delete window.umami;` as the last line of the existing `afterEach`, and append:

```tsx
describe("ContactForm analytics", () => {
  it("tracks contact-sent once the API accepts the message", async () => {
    const umamiTrack = vi.fn();
    window.umami = { track: umamiTrack };
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    await act(async () => {
      renderForm();
    });
    fill(valid);
    await submit();
    expect(umamiTrack.mock.calls).toEqual([["contact-sent"]]);
  });

  it("does not track contact-sent when the API rejects the message", async () => {
    const umamiTrack = vi.fn();
    window.umami = { track: umamiTrack };
    fetchMock.mockResolvedValue(
      Response.json({ error: { code: "rate_limited", message: "x" } }, { status: 429 }),
    );
    await act(async () => {
      renderForm();
    });
    fill(valid);
    await submit();
    expect(umamiTrack).not.toHaveBeenCalled();
  });

  it("does not track contact-sent when validation stops the submit", async () => {
    const umamiTrack = vi.fn();
    window.umami = { track: umamiTrack };
    await act(async () => {
      renderForm();
    });
    await submit();
    expect(umamiTrack).not.toHaveBeenCalled();
  });
});
```

`apps/web/src/app/page.test.tsx`: change the Testing Library import to `import { cleanup, fireEvent, render, screen } from "@testing-library/react";` and append:

```tsx
describe("HomePage analytics", () => {
  afterEach(() => {
    delete window.umami;
  });

  it("tags the hero GitHub and LinkedIn links as outbound clicks", async () => {
    render(await HomePage());

    const github = screen.getByRole("link", { name: "GitHub" });
    expect(github.getAttribute("data-umami-event")).toBe("outbound-click");
    expect(github.getAttribute("data-umami-event-to")).toBe("github");
    const linkedin = screen.getByRole("link", { name: "LinkedIn" });
    expect(linkedin.getAttribute("data-umami-event")).toBe("outbound-click");
    expect(linkedin.getAttribute("data-umami-event-to")).toBe("linkedin");
  });

  it("tracks Download resume as a resume download from /", async () => {
    const umamiTrack = vi.fn();
    window.umami = { track: umamiTrack };
    render(await HomePage());

    const resume = screen.getByRole("link", { name: "Download resume" });
    expect(resume.getAttribute("href")).toBe("/resume");
    expect(resume.hasAttribute("data-umami-event")).toBe(false);
    const block = (event: Event) => event.preventDefault(); // jsdom cannot navigate
    document.addEventListener("click", block);
    fireEvent.click(resume);
    document.removeEventListener("click", block);
    expect(umamiTrack.mock.calls).toEqual([["resume-download", { from: "/" }]]);
  });
});
```

`apps/web/src/app/experience/page.test.tsx`: change the Testing Library import to `import { cleanup, fireEvent, render, screen } from "@testing-library/react";` and add inside `describe("/experience", ...)`:

```tsx
  it("tracks Download full resume as a resume download from /experience", async () => {
    vi.mocked(getExperience).mockResolvedValue([role({ id: 1, company: "Acme Labs" })]);
    const umamiTrack = vi.fn();
    window.umami = { track: umamiTrack };
    window.history.pushState({}, "", "/experience");
    render(await ExperiencePage());

    const block = (event: Event) => event.preventDefault();
    document.addEventListener("click", block);
    fireEvent.click(screen.getByRole("link", { name: /Download full resume/ }));
    document.removeEventListener("click", block);
    expect(umamiTrack.mock.calls).toEqual([["resume-download", { from: "/experience" }]]);

    delete window.umami;
    window.history.pushState({}, "", "/");
  });
```

`apps/web/src/app/resume/page.test.tsx`: change the Testing Library import to `import { cleanup, fireEvent, render, screen } from "@testing-library/react";` and add inside `describe("/resume", ...)`:

```tsx
  it("tracks both PDF links as resume downloads from /resume and keeps the download attribute", async () => {
    vi.mocked(getResume).mockResolvedValue(full);
    const umamiTrack = vi.fn();
    window.umami = { track: umamiTrack };
    window.history.pushState({}, "", "/resume");
    const { container } = render(await ResumePage());

    const download = screen.getByRole("link", { name: /download pdf/i });
    expect(download.getAttribute("download")).toBe("christopher-guzman-resume.pdf");
    const fallback = container.querySelector("object a")!;
    expect(fallback.getAttribute("href")).toBe("/cms-assets/abc-123");

    const block = (event: Event) => event.preventDefault();
    document.addEventListener("click", block);
    fireEvent.click(download);
    fireEvent.click(fallback);
    document.removeEventListener("click", block);
    expect(umamiTrack.mock.calls).toEqual([
      ["resume-download", { from: "/resume" }],
      ["resume-download", { from: "/resume" }],
    ]);

    delete window.umami;
    window.history.pushState({}, "", "/");
  });
```

`apps/web/src/components/layout/site-footer.test.tsx`: add inside `describe("SiteFooter", ...)`:

```tsx
  it("tags GitHub and LinkedIn as outbound clicks but not the RSS feed", () => {
    render(<SiteFooter />);
    const github = screen.getByRole("link", { name: "GitHub" });
    const linkedin = screen.getByRole("link", { name: "LinkedIn" });
    expect(github.getAttribute("data-umami-event")).toBe("outbound-click");
    expect(github.getAttribute("data-umami-event-to")).toBe("github");
    expect(linkedin.getAttribute("data-umami-event")).toBe("outbound-click");
    expect(linkedin.getAttribute("data-umami-event-to")).toBe("linkedin");
    expect(screen.getByRole("link", { name: "RSS feed" }).hasAttribute("data-umami-event")).toBe(
      false,
    );
  });
```

`apps/web/src/app/contact/page.test.tsx`: add inside `describe("/contact", ...)`:

```tsx
  it("tags the LinkedIn and GitHub open buttons as outbound clicks", async () => {
    vi.mocked(getProfile).mockResolvedValue(profile);
    render(await ContactPage());
    const linkedin = screen.getByRole("link", { name: "Open LinkedIn profile" });
    const github = screen.getByRole("link", { name: "Open GitHub profile" });
    expect(linkedin.getAttribute("data-umami-event")).toBe("outbound-click");
    expect(linkedin.getAttribute("data-umami-event-to")).toBe("linkedin");
    expect(github.getAttribute("data-umami-event")).toBe("outbound-click");
    expect(github.getAttribute("data-umami-event-to")).toBe("github");
  });
```

`apps/web/src/app/projects/[slug]/page.test.tsx`: add inside `describe("/projects/[slug]", ...)`:

```tsx
  it("tags the source and live links as repo and live outbound clicks", async () => {
    vi.mocked(getProject).mockResolvedValue(full);
    vi.mocked(renderMarkdown).mockResolvedValue({ html: "", headings: [] });
    render(await ProjectPage(params("offres")));

    const repo = screen.getByRole("link", { name: /Source code/ });
    expect(repo.getAttribute("data-umami-event")).toBe("outbound-click");
    expect(repo.getAttribute("data-umami-event-to")).toBe("repo");
    const live = screen.getByRole("link", { name: /Live site/ });
    expect(live.getAttribute("data-umami-event")).toBe("outbound-click");
    expect(live.getAttribute("data-umami-event-to")).toBe("live");
  });
```

`apps/web/src/app/education/page.test.tsx`: add inside `describe("/education", ...)`:

```tsx
  it("tags the credential link as an outbound click to other", async () => {
    vi.mocked(getCertifications).mockResolvedValue([certification]);
    render(await EducationPage());
    const link = screen.getByRole("link", { name: /View credential/ });
    expect(link.getAttribute("data-umami-event")).toBe("outbound-click");
    expect(link.getAttribute("data-umami-event-to")).toBe("other");
  });
```

`apps/web/src/components/content/github-activity.test.tsx`: add inside `describe("GitHubActivity", ...)`:

```tsx
  it("tags the profile link as an outbound click to github", () => {
    render(<GitHubActivity activity={makeActivity()} profileUrl="https://github.com/octo" />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("data-umami-event")).toBe("outbound-click");
    expect(link.getAttribute("data-umami-event-to")).toBe("github");
  });
```

`apps/web/src/components/content/primitives.test.tsx`: add inside `describe("SectionHeading", ...)`:

```tsx
  it("tags external links as outbound clicks by hostname, and internal links not at all", () => {
    render(
      <>
        <SectionHeading number="01" title="A" href="https://github.com/octo" linkLabel="@octo" />
        <SectionHeading number="02" title="B" href="https://example.com/x" linkLabel="elsewhere" />
        <SectionHeading number="03" title="C" href="/projects" linkLabel="all projects" />
      </>,
    );
    const github = screen.getByRole("link", { name: /@octo/ });
    expect(github.getAttribute("data-umami-event")).toBe("outbound-click");
    expect(github.getAttribute("data-umami-event-to")).toBe("github");
    expect(screen.getByRole("link", { name: /elsewhere/ }).getAttribute("data-umami-event-to")).toBe(
      "other",
    );
    expect(
      screen.getByRole("link", { name: /all projects/ }).hasAttribute("data-umami-event"),
    ).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --dir apps/web test`
Expected: FAIL. `analytics.test.ts`, `umami-script.test.tsx` fail to resolve `./analytics` / `./umami-script`; `next-config.test.ts` fails because `nextConfig.rewrites` is undefined; `env.test.ts` fails on the missing `umamiWebsiteId`; every new analytics test in the launcher, terminal, contact form, page, footer, contact, project, education, GitHub activity, and SectionHeading files fails (no `umami.track` calls / no `data-umami-event` attribute). Pre-existing tests still pass.

- [ ] **Step 3: Implement**

`apps/web/src/lib/analytics.ts`:

```ts
export type OutboundTarget = "github" | "linkedin" | "repo" | "live" | "other";

// The only events the site sends. Events mapped to undefined take no data, so free text
// (a chat question) can never be attached by mistake.
type EventData = {
  "resume-download": { from: string };
  "chat-open": undefined;
  "chat-question": undefined;
  "contact-sent": undefined;
  "outbound-click": { to: OutboundTarget };
};

export type AnalyticsEvent = keyof EventData;

declare global {
  interface Window {
    umami?: { track: (name: string, data?: Record<string, string>) => void };
  }
}

/** Sends a custom Umami event. Does nothing when the tracker is not loaded (no UMAMI_WEBSITE_ID, blocked). */
export function track<E extends AnalyticsEvent>(
  name: E,
  ...data: EventData[E] extends undefined ? [] : [EventData[E]]
): void {
  if (!window.umami) return;
  const [payload] = data as [Record<string, string>?];
  if (payload) window.umami.track(name, payload);
  else window.umami.track(name);
}

/** Umami's declarative click attributes for an external (new-tab) link. Safe in server components. */
export function outboundProps(to: OutboundTarget) {
  return { "data-umami-event": "outbound-click", "data-umami-event-to": to } as const;
}

/** For generic external links: github / linkedin by hostname, everything else "other". */
export function outboundTargetFor(href: string): OutboundTarget {
  let host: string;
  try {
    host = new URL(href).hostname;
  } catch {
    return "other";
  }
  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (on("github.com")) return "github";
  if (on("linkedin.com")) return "linkedin";
  return "other";
}
```

`apps/web/src/components/analytics/umami-script.tsx`:

```tsx
import { connection } from "next/server";

import { serverEnv } from "@/lib/env";

// Request-time read: the image is built once with no env, and the website ID only exists
// after Umami's first login. Without it the site loads no tracking code at all.
export async function UmamiScript() {
  await connection();
  const { umamiWebsiteId } = serverEnv();
  if (!umamiWebsiteId) return null;
  return (
    <script
      defer
      src="/stats/script.js"
      data-website-id={umamiWebsiteId}
      data-host-url="/stats"
    />
  );
}
```

`apps/web/src/components/analytics/resume-link.tsx`:

```tsx
"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { track } from "@/lib/analytics";

// Tracked with track() rather than data-umami-event: Umami's declarative handler cancels
// same-tab clicks and sets location.href, which would break `download` and client navigation.
export function ResumeLink({
  kind,
  href,
  download,
  className,
  children,
}: {
  kind: "page" | "file";
  href: string;
  download?: string;
  className?: string;
  children: ReactNode;
}) {
  const onClick = () => track("resume-download", { from: window.location.pathname });
  return kind === "page" ? (
    <Link href={href} className={className} onClick={onClick}>
      {children}
    </Link>
  ) : (
    <a href={href} download={download} className={className} onClick={onClick}>
      {children}
    </a>
  );
}
```

`apps/web/next.config.ts` (full file):

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: { formats: ["image/avif", "image/webp"] },
  // Umami tracker and collector served first-party, so blockers of analytics domains skip them.
  async rewrites() {
    return [
      { source: "/stats/script.js", destination: "http://umami:3000/script.js" },
      { source: "/stats/api/send", destination: "http://umami:3000/api/send" },
    ];
  },
};

export default nextConfig;
```

`apps/web/src/lib/env.ts`: add `umamiWebsiteId: string | undefined;` as the last field of `ServerEnv`, and `umamiWebsiteId: read("UMAMI_WEBSITE_ID"),` as the last key returned by `serverEnv()`.

`apps/web/src/app/layout.tsx`: add `import { UmamiScript } from "@/components/analytics/umami-script";` as the first `@/components` import, and directly after the existing `<Suspense fallback={null}><ChatSlot /></Suspense>` block add:

```tsx
          <Suspense fallback={null}>
            <UmamiScript />
          </Suspense>
```

`apps/web/src/components/chat/chat-launcher.tsx`: add `import { track } from "@/lib/analytics";` above the `@/lib/platform` import, and change `show` to:

```tsx
  const show = useCallback(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setLoaded(true);
    setOpen(true);
    track("chat-open"); // pill and shortcut both open through here
  }, []);
```

`apps/web/src/components/chat/chat-terminal.tsx`: add `import { track } from "@/lib/analytics";` above the `@/lib/chat` import, and in `ask()` replace

```tsx
    push({ kind: "question", text: question });
    setThinking(true);
```

with

```tsx
    push({ kind: "question", text: question });
    track("chat-question"); // never the text: questions can contain personal details
    setThinking(true);
```

`apps/web/src/components/contact/contact-form.tsx`: add `import { track } from "@/lib/analytics";` above the `@/lib/contact` import, and replace

```tsx
    if (result.kind === "sent") {
      setSent(true);
      return;
    }
```

with

```tsx
    if (result.kind === "sent") {
      track("contact-sent");
      setSent(true);
      return;
    }
```

`apps/web/src/app/page.tsx`: add `import { ResumeLink } from "@/components/analytics/resume-link";` as the first `@/components` import and `import { outboundProps } from "@/lib/analytics";` as the first `@/lib` import. In the hero replace

```tsx
              <Link href="/resume" className={primaryButton}>
                Download resume
              </Link>
```

with

```tsx
              <ResumeLink kind="page" href="/resume" className={primaryButton}>
                Download resume
              </ResumeLink>
```

and replace the GitHub/LinkedIn row with:

```tsx
            <div className="mt-2 flex flex-wrap items-center gap-2.5">
              <a
                href={githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={ghostLink}
                {...outboundProps("github")}
              >
                <GitHubIcon className="size-4" aria-hidden="true" />
                GitHub
              </a>
              <a
                href={linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={ghostLink}
                {...outboundProps("linkedin")}
              >
                <LinkedInIcon className="size-4" aria-hidden="true" />
                LinkedIn
              </a>
            </div>
```

(`Link` stays imported: `Get in touch` still uses it.)

`apps/web/src/app/experience/page.tsx`: replace `import Link from "next/link";` with nothing (it becomes unused), add `import { ResumeLink } from "@/components/analytics/resume-link";` as the first `@/components` import, and replace the resume link with:

```tsx
        <ResumeLink kind="page" href="/resume" className={outlineButton}>
          <Download className="size-4" aria-hidden="true" />
          Download full resume
        </ResumeLink>
```

`apps/web/src/app/resume/page.tsx`: add `import { ResumeLink } from "@/components/analytics/resume-link";` as the first `@/components` import. In `ResumeViewer` replace the download anchor with:

```tsx
        <ResumeLink
          kind="file"
          href={src}
          download="christopher-guzman-resume.pdf"
          className="inline-flex items-center gap-2 rounded-md bg-accent-brand px-3.5 py-2 text-sm font-semibold text-accent-brand-foreground transition-opacity hover:opacity-90"
        >
          <Download className="size-4" aria-hidden />
          Download PDF
        </ResumeLink>
```

and the fallback anchor inside `<object>` with:

```tsx
            <ResumeLink
              kind="file"
              href={src}
              className="text-accent-brand underline-offset-4 hover:underline"
            >
              Open the resume PDF
            </ResumeLink>
```

Outbound tags. Each file below gets `import { outboundProps } from "@/lib/analytics";` (or `outboundTargetFor` where noted) in its `@/lib` import group, and the attribute spread goes last on the named `<a>`, after `className`:

- `apps/web/src/components/layout/site-footer.tsx`: GitHub anchor `{...outboundProps("github")}`, LinkedIn anchor `{...outboundProps("linkedin")}`. Leave the RSS anchor unchanged.
- `apps/web/src/app/contact/page.tsx`: the `href={linkedin}` anchor `{...outboundProps("linkedin")}`, the `href={github}` anchor `{...outboundProps("github")}`.
- `apps/web/src/app/projects/[slug]/page.tsx`: the `href={project.repo_url}` anchor `{...outboundProps("repo")}`, the `href={project.live_url}` anchor `{...outboundProps("live")}`.
- `apps/web/src/app/education/page.tsx`: the `href={cert.url}` anchor `{...outboundProps("other")}`.
- `apps/web/src/components/content/github-activity.tsx`: the `href={profileUrl}` anchor `{...outboundProps("github")}`.
- `apps/web/src/components/content/section-heading.tsx`: add `import { outboundProps, outboundTargetFor } from "@/lib/analytics";` below the `next/link` import (separated by a blank line), and change the external branch to:

```tsx
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
            {...outboundProps(outboundTargetFor(href))}
          >
            {linkLabel}
            <span aria-hidden="true"> →</span>
          </a>
```

Check that no external link was missed:

```bash
grep -rn 'target="_blank"' apps/web/src --include='*.tsx' | grep -v '\.test\.'
```

Expected: every hit is one of the anchors tagged above (hero ×2, footer ×2, contact ×2, project ×2, education ×1, GitHub activity ×1, SectionHeading ×1).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --dir apps/web test`
Expected: PASS, all files.

- [ ] **Step 5: Full checks and commit**

```bash
pnpm --dir apps/web format:write
pnpm --dir apps/web lint && pnpm --dir apps/web typecheck && pnpm --dir apps/web format && pnpm --dir apps/web test && pnpm --dir apps/web build
```

Expected: all pass. `build` succeeds with no env vars set; the build output still lists `/` as dynamic (ƒ).

Manual check (dev server, no Umami running): `UMAMI_WEBSITE_ID= pnpm --dir apps/web dev`, open `/`, and confirm that view-source has no `/stats/script.js`. Restart with `UMAMI_WEBSITE_ID=test pnpm --dir apps/web dev`, open `/` again, and confirm that view-source contains `<script defer="" src="/stats/script.js" data-website-id="test" data-host-url="/stats">` and that the page still works when `/stats/script.js` fails (no Umami locally).

```bash
git add -A apps/web
git commit -m "feat(web): Umami tracker behind /stats rewrites and five custom events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Monitoring and analytics services

**Files:**
- Create: `infra/observability/prometheus/prometheus.yml`
- Create: `infra/observability/blackbox/blackbox.yml`
- Create: `infra/observability/grafana/provisioning/datasources/prometheus.yml`
- Create: `infra/observability/grafana/provisioning/dashboards/portfolio.yml`
- Create: `infra/observability/grafana/provisioning/alerting/contact-points.yml`
- Create: `infra/observability/grafana/provisioning/alerting/policies.yml`
- Create: `infra/observability/grafana/provisioning/alerting/rules.yml`
- Create: `infra/observability/grafana/provisioning/plugins/.gitkeep` (empty; stops Grafana logging an error about a missing plugins provisioning dir, since the whole provisioning dir is bind-mounted)
- Create: `infra/observability/grafana/dashboards/portfolio-overview.json`
- Create: `infra/observability/grafana/dashboards/host-containers.json`
- Modify: `infra/compose/compose.yaml` (six services, three volumes, `web` gains `UMAMI_WEBSITE_ID`)
- Modify: `infra/compose/compose.dev.yaml` (`prometheus` + `blackbox-exporter` under profile `monitoring`)
- Modify: `infra/compose/prod.env.example` (`GRAFANA_ADMIN_PASSWORD`, `UMAMI_APP_SECRET`; new "Optional" section with `UMAMI_WEBSITE_ID`)
- Modify: `scripts/secrets-check.sh` (skip the Optional section)
- Modify: `scripts/deploy.sh` (default `SERVICES`)
- Modify: `.github/workflows/ci.yml` (infra job: promtool, blackbox config check, provisioning/dashboard parse)

**Interfaces:**
- Consumes: API metric names exactly as in Global Constraints (served by Task 1 at `api:8000/metrics`; `status` label is the numeric HTTP status as a string, e.g. `"503"`); backup metrics `backup_last_success_timestamp_seconds` / `backup_last_size_bytes` (written by Task 6 into `/textfile/backup.prom` on volume `node-textfile`); existing prod keys `UMAMI_DB_PASSWORD`, `RESEND_API_KEY`, `CONTACT_TO`; the `umami` database and role from `infra/postgres/init/01-init.sh`.
- Produces:
  - Compose services `prometheus` (`http://prometheus:9090`, the API's default `API_PROMETHEUS_URL`), `grafana` (`http://grafana:3000`), `node-exporter`, `cadvisor`, `blackbox-exporter`, `umami` (`http://umami:3000`, target of Task 3/4's `/stats/*` rewrites and of the `analytics.` tunnel hostname). No host ports.
  - Volume `node-textfile`: node-exporter mounts it read-only at `/textfile`. **Task 6** mounts it read-write at `/textfile` in `backup`. The volume is created root-owned (`0755`) because node-exporter's image has no `/textfile`; Task 6's non-root backup user must be able to write there (Task 6 decides how, e.g. its image creates `/textfile` owned by the backup user and the backup service starts first on a fresh volume, or a root `chown` at container start before dropping privileges).
  - `scripts/deploy.sh` default `SERVICES` = `postgres directus api web cloudflared prometheus grafana node-exporter cadvisor blackbox-exporter umami`. `backup` is **not** added here: `compose pull backup` fails with "no such service" until Task 6 defines it. **Task 6 appends ` backup`** to this list.
  - `prod.env.example` layout: Task 6 adds its required backup keys at the end of the "Stored in prod.enc.env" block, **above** the new `# Optional in prod.enc.env` header (keys below that header are not checked by `secrets-check.sh`).
  - Dev: `docker compose -f infra/compose/compose.dev.yaml --profile monitoring up -d prometheus blackbox-exporter` exposes Prometheus on `127.0.0.1:${PROMETHEUS_PORT:-9090}`; inside the dev network it is `http://prometheus:9090`, so the dev API's default `API_PROMETHEUS_URL` reaches it (Task 9).
  - Grafana datasource uid `prometheus`; dashboards uids `portfolio-overview`, `host-containers` in folder `Portfolio`; alert rule uids `disk-filling`, `memory-tight`, `site-down`, `api-errors`, `container-down`, `backup-stale`, `chat-budget`; contact point `email-chris`.

**Image pins (checked 2026-10-03 against Docker Hub, ghcr.io and GitHub releases; all pulled and run locally):**

| Service | Image | Note |
|---|---|---|
| prometheus | `prom/prometheus:v3.15.0` | latest stable (2026-09-25) |
| grafana | `grafana/grafana:13.2.3` | latest stable (2026-09-29). The spec names `grafana/grafana-oss`, but that repository stopped at `13.0.2` (2026-06-02); `grafana/grafana` is the OSS edition (Enterprise is `grafana/grafana-enterprise`). |
| node-exporter | `prom/node-exporter:v1.12.1` | latest stable (2026-07-14) |
| cadvisor | `ghcr.io/google/cadvisor:v0.60.6` | latest release (2026-09-18). The spec names `gcr.io/cadvisor/cadvisor`, which stopped at `v0.55.1`; new releases publish to ghcr.io. |
| blackbox-exporter | `prom/blackbox-exporter:v0.28.0` | latest stable (2025-12-06) |
| umami | `ghcr.io/umami-software/umami:3.4.0` | latest (2026-09-17). Umami 3 is Postgres-only, so the plain tag is the Postgres build (the `postgresql-` prefix ended at 3.0.0). |
| (CI only) yq | `mikefarah/yq:4.54.1` | YAML parse in the infra job |

**Deviation — Grafana `mem_limit` is 384m, not 192m.** Measured locally (2026-10-03, fresh container, this provisioning): at `--memory 192m` Grafana 13.2.3 never answered `/api/health` within 300 s (no OOM kill; it thrashes re-reading its 485 MB binary from page cache); at 256m it took about 5 minutes; at 320m and 384m it was healthy in 30 s, settling at ~110 MiB anon + page cache. 192m would make `deploy.sh`'s `--wait --wait-timeout 180` fail. The `-slim` tag has the same binary. 384m gives headroom over the 320m cliff; actual anonymous memory stays ~110 MiB, the rest is reclaimable cache. Umami 3.4.0 under `--memory 256m` reaches healthy in ~20 s and settles at ~150 MiB (anon ~128 MiB), so 256m stands.

- [ ] **Step 1: Prometheus and blackbox configs**

`infra/observability/prometheus/prometheus.yml`:

```yaml
# Scrape config for the production stack (also used by the dev `monitoring`
# profile, where only api and site resolve). Alert rules live in Grafana, not here.
global:
  scrape_interval: 30s
  scrape_timeout: 10s
  evaluation_interval: 30s

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: ["localhost:9090"]

  - job_name: api
    metrics_path: /metrics
    static_configs:
      - targets: ["api:8000"]

  - job_name: node
    static_configs:
      - targets: ["node-exporter:9100"]

  - job_name: cadvisor
    static_configs:
      - targets: ["cadvisor:8080"]

  # Out through Cloudflare and back in through the tunnel: fails whenever a
  # visitor would see a failure (tunnel down, fallback Worker serving 503).
  - job_name: site
    metrics_path: /probe
    params:
      module: [http_2xx]
    scrape_timeout: 15s
    static_configs:
      - targets: ["https://christopherguzman.me/api/healthz"]
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: blackbox-exporter:9115
```

`infra/observability/blackbox/blackbox.yml`:

```yaml
modules:
  http_2xx:
    prober: http
    timeout: 10s
    http:
      method: GET
      valid_status_codes: [] # empty means any 2xx
      follow_redirects: true
      fail_if_not_ssl: true
      preferred_ip_protocol: ip4
      ip_protocol_fallback: true
```

Run:

```bash
docker run --rm --entrypoint promtool \
  -v "$PWD/infra/observability/prometheus:/etc/prometheus:ro" \
  prom/prometheus:v3.15.0 check config /etc/prometheus/prometheus.yml
docker run --rm -v "$PWD/infra/observability/blackbox:/etc/blackbox:ro" \
  prom/blackbox-exporter:v0.28.0 --config.file=/etc/blackbox/blackbox.yml --config.check
```

Expected: `SUCCESS: /etc/prometheus/prometheus.yml is valid prometheus config file syntax`, then blackbox logs `msg="Config file is ok exiting..."` and exits 0.

- [ ] **Step 2: Grafana provisioning (datasource, dashboard provider, contact point, policy, alert rules)**

Grafana expands `$VAR` / `${VAR}` from its environment in every provisioning file. `contact-points.yml` uses that on purpose for `${CONTACT_TO}`; nothing else in the provisioning tree may contain a `$` (Go templates in annotations use `index .Labels "..."` instead of `$labels`, and the thresholds are separate expressions instead of `$A > 0.8` math). CI enforces this for `rules.yml`.

`infra/observability/grafana/provisioning/datasources/prometheus.yml`:

```yaml
apiVersion: 1

datasources:
  - name: Prometheus
    uid: prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false
    jsonData:
      timeInterval: 30s
      httpMethod: POST
```

`infra/observability/grafana/provisioning/dashboards/portfolio.yml`:

```yaml
apiVersion: 1

providers:
  - name: portfolio
    orgId: 1
    folder: Portfolio
    type: file
    disableDeletion: true
    allowUiUpdates: false
    updateIntervalSeconds: 60
    options:
      path: /etc/grafana/dashboards
```

`infra/observability/grafana/provisioning/alerting/contact-points.yml`:

```yaml
# Grafana fills CONTACT_TO from its environment (set in compose.yaml). No other
# dollar sign may appear in this file.
apiVersion: 1

contactPoints:
  - orgId: 1
    name: email-chris
    receivers:
      - uid: email-chris
        type: email
        settings:
          addresses: ${CONTACT_TO}
          singleEmail: true
        disableResolveMessage: false
```

`infra/observability/grafana/provisioning/alerting/policies.yml`:

```yaml
apiVersion: 1

policies:
  - orgId: 1
    receiver: email-chris
    group_by: ["grafana_folder", "alertname"]
    group_wait: 30s
    group_interval: 5m
    repeat_interval: 4h
```

`infra/observability/grafana/provisioning/plugins/.gitkeep`: empty file.

`infra/observability/grafana/provisioning/alerting/rules.yml` — how each alert maps to Global Constraints:

| Alert | Query A (instant) | Threshold C | For | No data |
|---|---|---|---|---|
| Disk filling | root fs used % | `> 80` | 10m | OK |
| Memory tight | `1 - MemAvailable/MemTotal` % | `> 90` | 10m | OK |
| Site down | `probe_success{job="site"}` | `< 1` (values are 0/1, so this is `== 0`) | 5m | Alerting |
| API errors | 5xx share over 5m, `and on()` total ≥ 20 | `> 0.05` | 10m | OK (fewer than 20 requests yields no series) |
| Container down | `(up == bool 0) or (time() - max by (name) (max_over_time(container_last_seen{name=~"portfolio-(postgres\|directus\|api\|web\|cloudflared\|umami)-1"}[24h])) > bool 60)` — 1 per broken target/container | `> 0` | 5m | OK |
| Backup stale | `(time() - max(backup_last_success_timestamp_seconds)) or vector(1e12)` (absent counts as never) | `> 129600` (36 h) | 15m | Alerting |
| Chat budget | `max(chat_budget_used_ratio)` | `> 0.8` | 0s | OK |

`max_over_time(...[24h])` in Container down is a deliberate superset of the spec's expression: when a container stops, cAdvisor drops its series and plain `container_last_seen` goes stale within 5 minutes, so the literal expression would stop matching exactly when the container is gone. Taking the last value over 24 h keeps `time() - last_seen` growing. `execErrState: Error` everywhere: if Prometheus is unreachable, Grafana raises `DatasourceError` alerts, grouped into one email by the policy.

`infra/observability/grafana/provisioning/alerting/rules.yml`:

```yaml
# The seven Phase 6 alerts. Each rule is an instant PromQL query (A) and a
# threshold (C) on it. Grafana expands environment variables in provisioning
# files, so no expression or template here may contain a dollar sign (CI checks).
#
# noDataState: Alerting for Site down and Backup stale (silence there is itself
# a problem; Backup stale already maps an absent metric to a huge age), OK for
# the rest (an empty result means no traffic yet or the condition is not met,
# and a missing exporter is caught by Container down). execErrState: Error, so a dead
# Prometheus raises one grouped DatasourceError email.
apiVersion: 1

groups:
  - orgId: 1
    name: portfolio
    folder: Portfolio
    interval: 1m
    rules:
      - uid: disk-filling
        title: Disk filling
        condition: C
        data:
          - refId: A
            relativeTimeRange: { from: 600, to: 0 }
            datasourceUid: prometheus
            model:
              refId: A
              instant: true
              expr: 100 * (1 - node_filesystem_avail_bytes{mountpoint="/", fstype!="rootfs"} / node_filesystem_size_bytes{mountpoint="/", fstype!="rootfs"})
          - refId: C
            datasourceUid: __expr__
            model:
              refId: C
              type: threshold
              expression: A
              conditions:
                - evaluator: { type: gt, params: [80] }
        noDataState: OK
        execErrState: Error
        for: 10m
        annotations:
          summary: Root filesystem on the VM is more than 80% full.
        labels:
          severity: warning

      - uid: memory-tight
        title: Memory tight
        condition: C
        data:
          - refId: A
            relativeTimeRange: { from: 600, to: 0 }
            datasourceUid: prometheus
            model:
              refId: A
              instant: true
              expr: 100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)
          - refId: C
            datasourceUid: __expr__
            model:
              refId: C
              type: threshold
              expression: A
              conditions:
                - evaluator: { type: gt, params: [90] }
        noDataState: OK
        execErrState: Error
        for: 10m
        annotations:
          summary: VM memory use is above 90%. Check per-container memory on the Host and containers dashboard.
        labels:
          severity: warning

      - uid: site-down
        title: Site down
        condition: C
        data:
          - refId: A
            relativeTimeRange: { from: 600, to: 0 }
            datasourceUid: prometheus
            model:
              refId: A
              instant: true
              expr: probe_success{job="site"}
          - refId: C
            datasourceUid: __expr__
            model:
              refId: C
              type: threshold
              expression: A
              conditions:
                # probe_success is 0 or 1, so "< 1" is "== 0".
                - evaluator: { type: lt, params: [1] }
        noDataState: Alerting
        execErrState: Error
        for: 5m
        annotations:
          summary: The public probe of https://christopherguzman.me/api/healthz is failing.
        labels:
          severity: critical

      - uid: api-errors
        title: API errors
        condition: C
        data:
          - refId: A
            relativeTimeRange: { from: 600, to: 0 }
            datasourceUid: prometheus
            model:
              refId: A
              instant: true
              # 5xx share over 5 minutes, only when there were at least 20 requests.
              expr: (sum(increase(http_requests_total{status=~"5.."}[5m])) or vector(0)) / sum(increase(http_requests_total[5m])) and on() sum(increase(http_requests_total[5m])) >= 20
          - refId: C
            datasourceUid: __expr__
            model:
              refId: C
              type: threshold
              expression: A
              conditions:
                - evaluator: { type: gt, params: [0.05] }
        noDataState: OK
        execErrState: Error
        for: 10m
        annotations:
          summary: More than 5% of API requests are returning 5xx.
        labels:
          severity: critical

      - uid: container-down
        title: Container down
        condition: C
        data:
          - refId: A
            relativeTimeRange: { from: 600, to: 0 }
            datasourceUid: prometheus
            model:
              refId: A
              instant: true
              # 1 per broken target or container, 0 per healthy one. max_over_time
              # keeps a container's last-seen time after cAdvisor stops reporting it.
              expr: (up == bool 0) or (time() - max by (name) (max_over_time(container_last_seen{name=~"portfolio-(postgres|directus|api|web|cloudflared|umami)-1"}[24h])) > bool 60)
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
        for: 5m
        annotations:
          summary: 'Down: {{ index .Labels "job" }}{{ index .Labels "name" }}'
        labels:
          severity: critical

      - uid: backup-stale
        title: Backup stale
        condition: C
        data:
          - refId: A
            relativeTimeRange: { from: 600, to: 0 }
            datasourceUid: prometheus
            model:
              refId: A
              instant: true
              # Seconds since the last successful backup; absent metric counts as never.
              expr: (time() - max(backup_last_success_timestamp_seconds)) or vector(1e12)
          - refId: C
            datasourceUid: __expr__
            model:
              refId: C
              type: threshold
              expression: A
              conditions:
                # 36 hours
                - evaluator: { type: gt, params: [129600] }
        noDataState: Alerting
        execErrState: Error
        for: 15m
        annotations:
          summary: No successful backup in the last 36 hours (or the backup metric is missing).
        labels:
          severity: critical

      - uid: chat-budget
        title: Chat budget
        condition: C
        data:
          - refId: A
            relativeTimeRange: { from: 600, to: 0 }
            datasourceUid: prometheus
            model:
              refId: A
              instant: true
              expr: max(chat_budget_used_ratio)
          - refId: C
            datasourceUid: __expr__
            model:
              refId: C
              type: threshold
              expression: A
              conditions:
                - evaluator: { type: gt, params: [0.8] }
        noDataState: OK
        execErrState: Error
        for: 0s
        annotations:
          summary: The chat has used more than 80% of today's Groq token budget.
        labels:
          severity: warning
```

Run (YAML parse + rule count; same commands CI uses in Step 7):

```bash
for f in infra/observability/grafana/provisioning/*/*.yml; do
  docker run --rm -i -v "$PWD:/w" -w /w mikefarah/yq:4.54.1 -e '.apiVersion == 1' "$f" >/dev/null || echo "BAD $f"
done
docker run --rm -v "$PWD:/w" -w /w mikefarah/yq:4.54.1 '[.groups[].rules[]] | length' infra/observability/grafana/provisioning/alerting/rules.yml
grep -c '\$' infra/observability/grafana/provisioning/alerting/rules.yml
```

Expected: no `BAD` lines, then `7`, then `0`.

- [ ] **Step 3: Dashboards**

Two dashboards. Panels per the spec: **Portfolio overview** — site up/down, 30-day uptime, last backup age, chat questions (stat over the range), site probe history, API request rate by route, 5xx share, p95/p99 latency by route, chat questions by outcome, chat budget used, chat tokens by kind, contact submissions by result, chat index syncs per hour by result. Resume downloads live in Umami (`resume-download` event): the API never serves the PDF. **Host & containers** — VM CPU, memory and swap, root disk gauge, swap gauge, network, per-container CPU, per-container memory as a share of `mem_limit`, per-container working set.

Network note: node-exporter runs on the compose network (no host networking, no host port), so its `node_network_*` series describe its own network namespace, not the VM. The network panel therefore sums cAdvisor's per-container `container_network_*` counters, which covers all real traffic on this VM (it all flows through containers, mainly `cloudflared`). The panel title says so.

`$__range` in the resume-downloads stat is a Grafana dashboard variable; dashboard JSON files are not env-expanded (only provisioning YAML is), so it is safe here.

`infra/observability/grafana/dashboards/portfolio-overview.json`:

```json
{
  "uid": "portfolio-overview",
  "title": "Portfolio overview",
  "tags": ["portfolio"],
  "timezone": "America/New_York",
  "schemaVersion": 41,
  "version": 1,
  "editable": false,
  "refresh": "1m",
  "time": { "from": "now-24h", "to": "now" },
  "panels": [
    {
      "id": 1,
      "type": "stat",
      "title": "Site",
      "gridPos": { "h": 4, "w": 6, "x": 0, "y": 0 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "probe_success{job=\"site\"}", "instant": true }],
      "fieldConfig": {
        "defaults": {
          "mappings": [{ "type": "value", "options": { "0": { "text": "DOWN", "color": "red" }, "1": { "text": "UP", "color": "green" } } }],
          "color": { "mode": "thresholds" },
          "thresholds": { "mode": "absolute", "steps": [{ "color": "red", "value": null }, { "color": "green", "value": 1 }] }
        },
        "overrides": []
      },
      "options": { "colorMode": "background", "graphMode": "none", "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 2,
      "type": "stat",
      "title": "Uptime (30d)",
      "gridPos": { "h": 4, "w": 6, "x": 6, "y": 0 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "avg_over_time(probe_success{job=\"site\"}[30d])", "instant": true }],
      "fieldConfig": { "defaults": { "unit": "percentunit", "decimals": 3 }, "overrides": [] },
      "options": { "colorMode": "none", "graphMode": "none", "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 3,
      "type": "stat",
      "title": "Last backup age",
      "gridPos": { "h": 4, "w": 6, "x": 12, "y": 0 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "time() - max(backup_last_success_timestamp_seconds)", "instant": true }],
      "fieldConfig": {
        "defaults": {
          "unit": "s",
          "color": { "mode": "thresholds" },
          "thresholds": { "mode": "absolute", "steps": [{ "color": "green", "value": null }, { "color": "red", "value": 129600 }] }
        },
        "overrides": []
      },
      "options": { "colorMode": "value", "graphMode": "none", "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 4,
      "type": "stat",
      "title": "Chat questions (range)",
      "gridPos": { "h": 4, "w": 6, "x": 18, "y": 0 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "sum(increase(chat_questions_total[$__range]))", "instant": true }],
      "fieldConfig": { "defaults": { "unit": "short", "decimals": 0 }, "overrides": [] },
      "options": { "colorMode": "none", "graphMode": "none", "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 5,
      "type": "timeseries",
      "title": "Site probe",
      "gridPos": { "h": 6, "w": 24, "x": 0, "y": 4 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "probe_success{job=\"site\"}", "legendFormat": "up" }],
      "fieldConfig": { "defaults": { "min": 0, "max": 1, "custom": { "drawStyle": "line", "lineInterpolation": "stepAfter" } }, "overrides": [] },
      "options": { "legend": { "showLegend": false } }
    },
    {
      "id": 6,
      "type": "timeseries",
      "title": "API request rate by route",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 10 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "sum by (route) (rate(http_requests_total[5m]))", "legendFormat": "{{route}}" }],
      "fieldConfig": { "defaults": { "unit": "reqps" }, "overrides": [] },
      "options": { "legend": { "showLegend": true, "displayMode": "list" } }
    },
    {
      "id": 7,
      "type": "timeseries",
      "title": "API 5xx share",
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 10 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "(sum(rate(http_requests_total{status=~\"5..\"}[5m])) or vector(0)) / sum(rate(http_requests_total[5m]))", "legendFormat": "5xx" }],
      "fieldConfig": { "defaults": { "unit": "percentunit", "min": 0 }, "overrides": [] },
      "options": { "legend": { "showLegend": false } }
    },
    {
      "id": 8,
      "type": "timeseries",
      "title": "API latency p95 / p99 by route",
      "gridPos": { "h": 8, "w": 24, "x": 0, "y": 18 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [
        { "refId": "A", "expr": "histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))", "legendFormat": "p95 {{route}}" },
        { "refId": "B", "expr": "histogram_quantile(0.99, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))", "legendFormat": "p99 {{route}}" }
      ],
      "fieldConfig": { "defaults": { "unit": "s" }, "overrides": [] },
      "options": { "legend": { "showLegend": true, "displayMode": "list" } }
    },
    {
      "id": 9,
      "type": "timeseries",
      "title": "Chat questions by outcome (per hour)",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 26 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "sum by (outcome) (increase(chat_questions_total[1h]))", "legendFormat": "{{outcome}}" }],
      "fieldConfig": { "defaults": { "unit": "short", "custom": { "drawStyle": "bars", "stacking": { "mode": "normal" } } }, "overrides": [] },
      "options": { "legend": { "showLegend": true, "displayMode": "list" } }
    },
    {
      "id": 10,
      "type": "timeseries",
      "title": "Chat budget used today",
      "gridPos": { "h": 8, "w": 6, "x": 12, "y": 26 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "max(chat_budget_used_ratio)", "legendFormat": "used" }],
      "fieldConfig": {
        "defaults": {
          "unit": "percentunit",
          "min": 0,
          "max": 1,
          "custom": { "thresholdsStyle": { "mode": "line" } },
          "thresholds": { "mode": "absolute", "steps": [{ "color": "green", "value": null }, { "color": "red", "value": 0.8 }] }
        },
        "overrides": []
      },
      "options": { "legend": { "showLegend": false } }
    },
    {
      "id": 11,
      "type": "timeseries",
      "title": "Chat tokens (per hour)",
      "gridPos": { "h": 8, "w": 6, "x": 18, "y": 26 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "sum by (kind) (increase(chat_tokens_total[1h]))", "legendFormat": "{{kind}}" }],
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "options": { "legend": { "showLegend": true, "displayMode": "list" } }
    },
    {
      "id": 12,
      "type": "timeseries",
      "title": "Contact submissions (per hour)",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 34 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "sum by (result) (increase(contact_submissions_total[1h]))", "legendFormat": "{{result}}" }],
      "fieldConfig": { "defaults": { "unit": "short", "custom": { "drawStyle": "bars" } }, "overrides": [] },
      "options": { "legend": { "showLegend": true, "displayMode": "list" } }
    },
    {
      "id": 13,
      "type": "timeseries",
      "title": "Chat index syncs (per hour)",
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 34 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "sum by (result) (increase(rag_sync_runs_total[1h]))", "legendFormat": "{{result}}" }],
      "fieldConfig": { "defaults": { "unit": "short", "custom": { "drawStyle": "bars" } }, "overrides": [] },
      "options": { "legend": { "showLegend": true, "displayMode": "list" } }
    }
  ]
}
```

`infra/observability/grafana/dashboards/host-containers.json`:

```json
{
  "uid": "host-containers",
  "title": "Host & containers",
  "tags": ["portfolio"],
  "timezone": "America/New_York",
  "schemaVersion": 41,
  "version": 1,
  "editable": false,
  "refresh": "1m",
  "time": { "from": "now-6h", "to": "now" },
  "panels": [
    {
      "id": 1,
      "type": "timeseries",
      "title": "VM CPU",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 0 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "100 * (1 - avg(rate(node_cpu_seconds_total{mode=\"idle\"}[5m])))", "legendFormat": "busy" }],
      "fieldConfig": { "defaults": { "unit": "percent", "min": 0, "max": 100 }, "overrides": [] },
      "options": { "legend": { "showLegend": false } }
    },
    {
      "id": 2,
      "type": "timeseries",
      "title": "VM memory and swap",
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 0 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [
        { "refId": "A", "expr": "node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes", "legendFormat": "memory used" },
        { "refId": "B", "expr": "node_memory_MemTotal_bytes", "legendFormat": "memory total" },
        { "refId": "C", "expr": "node_memory_SwapTotal_bytes - node_memory_SwapFree_bytes", "legendFormat": "swap used" }
      ],
      "fieldConfig": { "defaults": { "unit": "bytes", "min": 0 }, "overrides": [] },
      "options": { "legend": { "showLegend": true, "displayMode": "list" } }
    },
    {
      "id": 3,
      "type": "gauge",
      "title": "Root disk used",
      "gridPos": { "h": 8, "w": 6, "x": 0, "y": 8 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "100 * (1 - node_filesystem_avail_bytes{mountpoint=\"/\", fstype!=\"rootfs\"} / node_filesystem_size_bytes{mountpoint=\"/\", fstype!=\"rootfs\"})", "instant": true }],
      "fieldConfig": {
        "defaults": {
          "unit": "percent",
          "min": 0,
          "max": 100,
          "thresholds": { "mode": "absolute", "steps": [{ "color": "green", "value": null }, { "color": "orange", "value": 70 }, { "color": "red", "value": 80 }] }
        },
        "overrides": []
      },
      "options": { "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 4,
      "type": "gauge",
      "title": "Swap used",
      "gridPos": { "h": 8, "w": 6, "x": 6, "y": 8 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "(node_memory_SwapTotal_bytes - node_memory_SwapFree_bytes) / (node_memory_SwapTotal_bytes > 0)", "instant": true }],
      "fieldConfig": {
        "defaults": {
          "unit": "percentunit",
          "min": 0,
          "max": 1,
          "thresholds": { "mode": "absolute", "steps": [{ "color": "green", "value": null }, { "color": "orange", "value": 0.5 }, { "color": "red", "value": 0.8 }] }
        },
        "overrides": []
      },
      "options": { "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 5,
      "type": "timeseries",
      "title": "Network (all containers, cAdvisor)",
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 8 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [
        { "refId": "A", "expr": "sum(rate(container_network_receive_bytes_total{name=~\"portfolio-.+\"}[5m]))", "legendFormat": "receive" },
        { "refId": "B", "expr": "sum(rate(container_network_transmit_bytes_total{name=~\"portfolio-.+\"}[5m]))", "legendFormat": "transmit" }
      ],
      "fieldConfig": { "defaults": { "unit": "Bps", "min": 0 }, "overrides": [] },
      "options": { "legend": { "showLegend": true, "displayMode": "list" } }
    },
    {
      "id": 6,
      "type": "timeseries",
      "title": "Container CPU",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 16 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "sum by (name) (rate(container_cpu_usage_seconds_total{name=~\"portfolio-.+\"}[5m]))", "legendFormat": "{{name}}" }],
      "fieldConfig": { "defaults": { "unit": "short", "min": 0 }, "overrides": [] },
      "options": { "legend": { "showLegend": true, "displayMode": "list" } }
    },
    {
      "id": 7,
      "type": "timeseries",
      "title": "Container memory vs mem_limit",
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 16 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "max by (name) (container_memory_working_set_bytes{name=~\"portfolio-.+\"}) / max by (name) (container_spec_memory_limit_bytes{name=~\"portfolio-.+\"} > 0)", "legendFormat": "{{name}}" }],
      "fieldConfig": {
        "defaults": {
          "unit": "percentunit",
          "min": 0,
          "max": 1,
          "custom": { "thresholdsStyle": { "mode": "line" } },
          "thresholds": { "mode": "absolute", "steps": [{ "color": "green", "value": null }, { "color": "red", "value": 0.9 }] }
        },
        "overrides": []
      },
      "options": { "legend": { "showLegend": true, "displayMode": "list" } }
    },
    {
      "id": 8,
      "type": "timeseries",
      "title": "Container memory (working set)",
      "gridPos": { "h": 8, "w": 24, "x": 0, "y": 24 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "targets": [{ "refId": "A", "expr": "max by (name) (container_memory_working_set_bytes{name=~\"portfolio-.+\"})", "legendFormat": "{{name}}" }],
      "fieldConfig": { "defaults": { "unit": "bytes", "min": 0 }, "overrides": [] },
      "options": { "legend": { "showLegend": true, "displayMode": "list" } }
    }
  ]
}
```

Run:

```bash
for f in infra/observability/grafana/dashboards/*.json; do jq -e '(.uid | type == "string") and (.panels | length > 0)' "$f"; done
```

Expected: `true` twice.

- [ ] **Step 4: Production compose services**

In `infra/compose/compose.yaml`, insert this block after the `cloudflared` service and before the `# Ephemeral deploy runner.` comment (all six use the `x-service` anchor, publish no ports, and have exact tags):

```yaml
  # --- Phase 6: monitoring and analytics. Private: Grafana and Umami are
  # reached only through the tunnel behind Cloudflare Access; the rest are
  # scraped by Prometheus over this network. Alert rules live in Grafana.
  prometheus:
    <<: *service
    image: prom/prometheus:v3.15.0
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      - --storage.tsdb.path=/prometheus
      - --storage.tsdb.retention.time=35d
      - --storage.tsdb.retention.size=2GB
    volumes:
      - prometheus-data:/prometheus
      - ../observability/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:9090/-/healthy"]
      interval: 15s
      timeout: 3s
      retries: 10
      start_period: 20s
    mem_limit: 320m

  grafana:
    <<: *service
    image: grafana/grafana:13.2.3
    depends_on: [prometheus]
    environment:
      GF_SECURITY_ADMIN_USER: admin
      # Applied only when grafana-data is first created; later changes go
      # through `grafana cli admin reset-admin-password` (see the runbook).
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:?}
      GF_SERVER_ROOT_URL: https://grafana.christopherguzman.me
      GF_AUTH_ANONYMOUS_ENABLED: "false"
      GF_USERS_ALLOW_SIGN_UP: "false"
      GF_ANALYTICS_REPORTING_ENABLED: "false"
      GF_ANALYTICS_CHECK_FOR_UPDATES: "false"
      GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES: "false"
      GF_NEWS_NEWS_FEED_ENABLED: "false"
      GF_PLUGINS_PREINSTALL_DISABLED: "true"
      GF_SMTP_ENABLED: "true"
      GF_SMTP_HOST: smtp.resend.com:465
      GF_SMTP_USER: resend
      GF_SMTP_PASSWORD: ${RESEND_API_KEY:?}
      GF_SMTP_FROM_ADDRESS: alerts@christopherguzman.me
      GF_SMTP_FROM_NAME: Portfolio alerts
      # Read by provisioning/alerting/contact-points.yml.
      CONTACT_TO: ${CONTACT_TO:?}
    volumes:
      - grafana-data:/var/lib/grafana
      - ../observability/grafana/provisioning:/etc/grafana/provisioning:ro
      - ../observability/grafana/dashboards:/etc/grafana/dashboards:ro
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 15s
      timeout: 3s
      retries: 10
      start_period: 30s
    # Not 192m: Grafana 13 needs ~330 MiB (heap + its 485 MB binary in page
    # cache) or startup stalls for minutes and deploy --wait times out.
    mem_limit: 384m

  node-exporter:
    <<: *service
    image: prom/node-exporter:v1.12.1
    command:
      - --path.procfs=/host/proc
      - --path.sysfs=/host/sys
      - --path.rootfs=/rootfs
      - --collector.textfile.directory=/textfile
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro,rslave
      - node-textfile:/textfile:ro
    mem_limit: 64m

  # Mounts follow cAdvisor's documented Docker setup. /var/run carries the
  # Docker socket, so like the runner this is root-equivalent on the VM.
  cadvisor:
    <<: *service
    image: ghcr.io/google/cadvisor:v0.60.6
    command:
      - --docker_only=true
      - --housekeeping_interval=30s
      # Only what the dashboards and alerts use; container_last_seen and the
      # container_spec_* series are always exported.
      - --enable_metrics=cpu,memory,network,diskIO
      - --store_container_labels=false
    privileged: true
    devices: ["/dev/kmsg"]
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
      - /dev/disk/:/dev/disk:ro
    mem_limit: 128m

  blackbox-exporter:
    <<: *service
    image: prom/blackbox-exporter:v0.28.0
    command: ["--config.file=/etc/blackbox/blackbox.yml"]
    volumes:
      - ../observability/blackbox/blackbox.yml:/etc/blackbox/blackbox.yml:ro
    mem_limit: 32m

  umami:
    <<: *service
    image: ghcr.io/umami-software/umami:3.4.0
    depends_on:
      postgres: { condition: service_healthy }
    environment:
      DATABASE_URL: postgresql://umami:${UMAMI_DB_PASSWORD:?}@postgres:5432/umami
      APP_SECRET: ${UMAMI_APP_SECRET:?}
      DISABLE_TELEMETRY: "1"
      DISABLE_UPDATES: "1"
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:3000/api/heartbeat"]
      interval: 15s
      timeout: 3s
      retries: 10
      start_period: 60s
    mem_limit: 256m
```

Notes on choices in that block:
- node-exporter: host `/proc`, `/sys`, and `/` (with `rslave`, per node-exporter's Docker guidance, so later host mounts propagate) are read-only, and `--path.rootfs=/rootfs` makes the root filesystem report as `mountpoint="/"`, which the Disk filling alert and gauge select. The default filesystem excludes already drop `/dev`, `/proc`, `/sys` and Docker's overlay mounts.
- cadvisor: `--enable_metrics=cpu,memory,network,diskIO` overrides the default disable list with an allow list (cAdvisor's flag help: "If set, overrides 'disable_metrics'"), dropping disk usage, process, tcp/udp, perf, hugetlb, etc. `container_last_seen` and `container_spec_memory_limit_bytes` are base series emitted regardless (confirmed in a local run). `--store_container_labels=false` keeps only `id`, `image`, `name` labels. cAdvisor 0.60's Docker factory also talks to containerd; `/run/containerd/containerd.sock` is inside the `/var/run` mount on the Debian VM. Local Docker Desktop cannot exercise this path (its `/var/run` is the Mac's), so Task 10 checks it after deploy with `docker exec portfolio-cadvisor-1 wget -qO- http://127.0.0.1:8080/metrics | grep -c '^container_last_seen{.*name="portfolio-api-1"'` (expected `1`; `0` means the Docker factory failed: check `docker logs portfolio-cadvisor-1 | grep factory`).
- grafana: `mem_limit: 384m` (deviation, see the measurements above the steps). `RESEND_API_KEY` and `CONTACT_TO` are already in `prod.env.example` and set in production since Phase 4, so `:?` is safe and makes a missing alert channel fail loudly at deploy. Admin user `admin`.
- umami: `curl` and `/api/heartbeat` exist in the 3.4.0 image (checked); `start_period: 60s` covers Prisma migrations on first boot. `DISABLE_TELEMETRY` and `DISABLE_UPDATES` stop outbound calls.

In the `web` service, after `PUBLIC_API_URL: https://api.christopherguzman.me`, add:

```yaml
      # Phase 6: analytics stays off until the Umami website exists.
      UMAMI_WEBSITE_ID: ${UMAMI_WEBSITE_ID:-}
```

Replace the top-level `volumes:` block with:

```yaml
volumes:
  postgres-data:
  directus-uploads:
  prometheus-data:
  grafana-data:
  node-textfile:
```

- [ ] **Step 5: Secrets example and secrets-check**

In `infra/compose/prod.env.example`, after `CHAT_HASH_SALT=change-me` (the last line), append:

```dotenv
GRAFANA_ADMIN_PASSWORD=change-me
UMAMI_APP_SECRET=change-me

# Optional in prod.enc.env (empty or absent keeps the feature off; not checked by secrets-check.sh)
UMAMI_WEBSITE_ID=
```

`secrets-check.sh` treats every key below `# Stored in prod.enc.env` as required and non-placeholder, and its awk skips every other comment line without leaving the section, so without a change `UMAMI_WEBSITE_ID` would be reported missing until Umami's first login (rollout step 4 comes after step 3's `make secrets-check`). In `scripts/secrets-check.sh`:

1. Replace the header line `# present, and none may still be the change-me placeholder.` with:

```bash
# present, and none may still be the change-me placeholder. Keys under
# "Optional in prod.enc.env" are not checked.
```

2. Replace the `required=` line with:

```bash
required="$(awk '/^# Stored in prod.enc.env/{f=1; next} /^# Optional in prod.enc.env/{f=0; next} /^#/{next} f && /^[A-Z_]+=/{sub(/=.*/, ""); print}' "${EXAMPLE}" | sort -u)"
```

Run:

```bash
awk '/^# Stored in prod.enc.env/{f=1; next} /^# Optional in prod.enc.env/{f=0; next} /^#/{next} f && /^[A-Z_]+=/{sub(/=.*/, ""); print}' infra/compose/prod.env.example | tail -3
docker compose -f infra/compose/compose.yaml --env-file infra/compose/prod.env.example config -q && echo PROD_OK
docker compose -f infra/compose/compose.yaml --env-file infra/compose/prod.env.example config | grep -E 'UMAMI_WEBSITE_ID|GF_SMTP_HOST|APP_SECRET'
```

Expected: `CHAT_HASH_SALT`, `GRAFANA_ADMIN_PASSWORD`, `UMAMI_APP_SECRET` (no `UMAMI_WEBSITE_ID`); `PROD_OK`; then `APP_SECRET: change-me`, `GF_SMTP_HOST: smtp.resend.com:465`, `UMAMI_WEBSITE_ID: ""`.

- [ ] **Step 6: Dev monitoring profile and deploy services**

In `infra/compose/compose.dev.yaml`, insert before the top-level `volumes:` key:

```yaml
  # Opt-in: `docker compose -f infra/compose/compose.dev.yaml --profile monitoring up -d prometheus blackbox-exporter`.
  # Reuses the production scrape config, so only the api and site jobs are up in dev.
  prometheus:
    image: prom/prometheus:v3.15.0
    profiles: [monitoring]
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      - --storage.tsdb.retention.time=2d
    volumes:
      - ../observability/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
    ports:
      - "127.0.0.1:${PROMETHEUS_PORT:-9090}:9090"

  blackbox-exporter:
    image: prom/blackbox-exporter:v0.28.0
    profiles: [monitoring]
    command: ["--config.file=/etc/blackbox/blackbox.yml"]
    volumes:
      - ../observability/blackbox/blackbox.yml:/etc/blackbox/blackbox.yml:ro
```

In `scripts/deploy.sh`, replace the `SERVICES=` line with:

```bash
SERVICES="${SERVICES:-postgres directus api web cloudflared prometheus grafana node-exporter cadvisor blackbox-exporter umami}"
```

(`backup` is appended by Task 6; see Interfaces.) No Makefile change: the dev profile command is one line and documented in the compose comment.

Run:

```bash
docker compose -f infra/compose/compose.dev.yaml config -q && echo DEV_OK
docker compose -f infra/compose/compose.dev.yaml --profile monitoring config --services | sort | tr '\n' ' '
docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:stable scripts/deploy.sh scripts/secrets-check.sh && echo SC_OK
```

Expected: `DEV_OK`; `api blackbox-exporter directus postgres prometheus web`; `SC_OK`. (Without `--profile monitoring`, `config --services` still lists only the original four, so `make up` is unchanged.)

- [ ] **Step 7: CI checks**

In `.github/workflows/ci.yml`, infra job, insert after the `Validate compose files` step:

```yaml
      - name: Prometheus and blackbox configs
        run: |
          docker run --rm --entrypoint promtool \
            -v "$PWD/infra/observability/prometheus:/etc/prometheus:ro" \
            prom/prometheus:v3.15.0 check config /etc/prometheus/prometheus.yml
          docker run --rm -v "$PWD/infra/observability/blackbox:/etc/blackbox:ro" \
            prom/blackbox-exporter:v0.28.0 --config.file=/etc/blackbox/blackbox.yml --config.check
      - name: Grafana provisioning and dashboards parse
        run: |
          yq() { docker run --rm -i -v "$PWD:/w" -w /w mikefarah/yq:4.54.1 "$@"; }
          for f in infra/observability/grafana/provisioning/*/*.yml; do
            yq -e '.apiVersion == 1' "$f" >/dev/null || { echo "bad provisioning file: $f"; exit 1; }
          done
          rules="$(yq '[.groups[].rules[]] | length' infra/observability/grafana/provisioning/alerting/rules.yml)"
          [[ "${rules}" == 7 ]] || { echo "expected 7 alert rules, found ${rules}"; exit 1; }
          if grep -n '\$' infra/observability/grafana/provisioning/alerting/rules.yml; then
            echo "rules.yml must not contain a dollar sign (Grafana expands it as an env var)"; exit 1
          fi
          for f in infra/observability/grafana/dashboards/*.json; do
            jq -e '(.uid | type == "string") and (.panels | length > 0)' "$f" >/dev/null || { echo "bad dashboard: $f"; exit 1; }
          done
          echo "grafana provisioning ok"
```

There are no Prometheus rule files (all alerting is in Grafana, per the spec's Alerts section), so `promtool check rules` has nothing to check and is not added. The existing `Validate compose files` step already runs both `config -q` commands; Steps 5 and 6 showed they pass with the new keys. The `infra/**` path filter already covers `infra/observability/`.

Run the new steps locally exactly as written (paste each `run:` body into `bash -euo pipefail`):

Expected: promtool `SUCCESS`, blackbox `Config file is ok exiting...`, then `grafana provisioning ok`.

- [ ] **Step 8: Local boot — probe, Prometheus, Grafana provisioning**

Uses a separate compose project (`p6t5`) and port 19090 so it never touches a running dev stack:

```bash
PROMETHEUS_PORT=19090 docker compose -p p6t5 -f infra/compose/compose.dev.yaml --profile monitoring up -d prometheus blackbox-exporter
sleep 45
curl -s 'localhost:19090/api/v1/query?query=probe_success' | jq -c '.data.result[] | {job: .metric.job, instance: .metric.instance, v: .value[1]}'
curl -s 'localhost:19090/api/v1/query?query=up' | jq -c '[.data.result[] | {(.metric.job): .value[1]}] | add'
```

Expected:

```
{"job":"site","instance":"https://christopherguzman.me/api/healthz","v":"1"}
{"prometheus":"1","api":"0","cadvisor":"0","node":"0","site":"1"}
```

(key order may differ; `api` is `0` because only these two services run in `p6t5`, and `node`/`cadvisor` do not exist in dev.)

Now Grafana alone against that Prometheus, with the provisioning dir, dummy secrets and the production memory cap (384m):

```bash
docker run -d --name p6t5-grafana --memory 384m --network p6t5_default -p 127.0.0.1:3300:3000 \
  -e GF_SECURITY_ADMIN_PASSWORD=test-admin -e CONTACT_TO=owner@example.com \
  -e GF_PLUGINS_PREINSTALL_DISABLED=true \
  -e GF_SMTP_ENABLED=true -e GF_SMTP_HOST=smtp.resend.com:465 -e GF_SMTP_USER=resend -e GF_SMTP_PASSWORD=dummy \
  -e GF_SMTP_FROM_ADDRESS=alerts@christopherguzman.me -e "GF_SMTP_FROM_NAME=Portfolio alerts" \
  -v "$PWD/infra/observability/grafana/provisioning:/etc/grafana/provisioning:ro" \
  -v "$PWD/infra/observability/grafana/dashboards:/etc/grafana/dashboards:ro" \
  grafana/grafana:13.2.3
sleep 90
docker logs p6t5-grafana 2>&1 | grep -E 'finished to provision|level=error'
curl -s -u admin:test-admin localhost:3300/api/v1/provisioning/alert-rules | jq 'length'
curl -s -u admin:test-admin 'localhost:3300/api/search?type=dash-db' | jq -c '[.[].title]'
curl -s -u admin:test-admin localhost:3300/api/v1/provisioning/contact-points | jq -c '.[] | {name, addresses: .settings.addresses}'
curl -s -u admin:test-admin localhost:3300/api/prometheus/grafana/api/v1/rules | jq -c '.data.groups[].rules[] | {name, health}'
docker inspect p6t5-grafana --format 'oom={{.State.OOMKilled}} status={{.State.Status}}'
```

Expected:
- logs: `finished to provision alerting` and `finished to provision dashboards`, no `level=error` lines;
- `7`;
- `["Host & containers","Portfolio overview"]`;
- `{"name":"email-chris","addresses":"owner@example.com"}` (proves `${CONTACT_TO}` expansion);
- seven lines, each `"health":"ok"` (every PromQL expression parsed and ran against the real Prometheus; states will be `inactive` or `pending` — Container down and Backup stale go pending because node/cadvisor/backup do not exist in this test);
- `oom=false status=running`.

Clean up:

```bash
docker rm -f p6t5-grafana
docker compose -p p6t5 -f infra/compose/compose.dev.yaml --profile monitoring down -v
```

- [ ] **Step 9: Commit**

```bash
git add infra/observability infra/compose/compose.yaml infra/compose/compose.dev.yaml infra/compose/prod.env.example \
  scripts/deploy.sh scripts/secrets-check.sh .github/workflows/ci.yml
git commit -m "$(cat <<'MSG'
feat(infra): Prometheus, Grafana, exporters and Umami services

Six memory-capped compose services with no host ports: Prometheus
(35d/2GB retention) scraping the API, node-exporter, cAdvisor and a
blackbox probe of the public site; Grafana with a provisioned datasource,
two dashboards, an email contact point via Resend and the seven Phase 6
alerts; Umami on its own database. Dev gets an opt-in monitoring profile,
deploy.sh starts the new services, secrets-check skips optional keys, and
CI runs promtool and parses the Grafana provisioning.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: Backup container (backup.sh, restore.sh, verify.sql), compose, release, CI round trip

Track C, runs after Task 5 in the `p6-infra` worktree. Task 5 already added the `node-textfile` named volume, node-exporter's read-only mount of it, the Task 5 services in `deploy.sh`'s `SERVICES`, and the Task 5 keys in `prod.env.example`; this task appends to those files.

**Files:**
- Create: `infra/backup/Dockerfile`, `infra/backup/crontab`, `infra/backup/backup.sh`, `infra/backup/restore.sh`, `infra/backup/verify.sql`, `infra/backup/test-roundtrip.sh`
- Modify: `infra/compose/compose.yaml` (new `backup` service), `infra/compose/prod.env.example` (backup keys)
- Modify: `scripts/deploy.sh` (`SERVICES` gains `backup`)
- Modify: `.github/workflows/release.yml` (matrix gains `backup`), `.github/workflows/ci.yml` (round-trip step, timeout)
- Modify: `.github/dependabot.yml` (docker updates for `/infra/backup`, same as `/infra/runner`)
- Modify: `Makefile` (`backup-now`)

**Interfaces:**
- Consumes: compose services `postgres` (superuser `postgres`, `POSTGRES_PASSWORD`; databases `directus`, `portfolio`, `umami` owned by same-named roles from `infra/postgres/init/01-init.sh`), volumes `directus-uploads` and `node-textfile` (Task 5), `IMAGE_TAG` from `deploy.sh`.
- Produces:
  - Image `ghcr.io/chrisguzman77/chris-guzman-portfolio/backup:<sha>` (non-root uid 10001, `TZ=America/New_York`, scripts and `verify.sql` in `/opt/backup` on `PATH`, CMD `supercronic`).
  - Object `r2:${R2_BUCKET}/backups/YYYY/MM/DD/portfolio-YYYYMMDDTHHMMSSZ.tar.age` (UTC): age-encrypted tar of `manifest.json`, `globals.sql`, `directus.dump`, `portfolio.dump`, `umami.dump`, `uploads.tar`. `manifest.json` = `{created_at, image_tag, files: [{name, size, sha256}]}`.
  - `/textfile/backup.prom` with `backup_last_success_timestamp_seconds` and `backup_last_size_bytes` (gauges), written via `backup.prom.tmp` + rename (node-exporter reads only `*.prom`).
  - `restore.sh <backup.tar.age> <age identity file>` with env `PGHOST`, `PGUSER`, `PGPASSWORD` (falls back to `POSTGRES_PASSWORD`), optional `RESTORE_REPLACE=1`, `RESTORE_UPLOADS_DIR`, `VERIFY_SQL`. Runs `verify.sql` last; exit 0 only when everything checks out. Used by Task 7 and the Task 8 runbook.
  - `make backup-now` (VM).
  - New required compose keys: `BACKUP_AGE_RECIPIENT`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `BACKUP_HEARTBEAT_URL`.

Design notes (already decided; do not re-litigate):
- **Heartbeat stays strict.** `backup.sh` requires `BACKUP_HEARTBEAT_URL` (`:?`) everywhere. The round-trip test points it at a `busybox httpd` stub on the test network and asserts on the stub's request log, so tests exercise the real ping code. A failed *success* ping only logs a warning (the backup itself succeeded; Better Stack notices the missing ping); a failed run pings `/fail` and exits 1.
- **rclone is configured only from env.** Compose derives `RCLONE_CONFIG_R2_*` from the `R2_*` secrets; the image sets `RCLONE_CONFIG=/dev/null`, so no config file is read or written. Tests set `RCLONE_CONFIG_R2_TYPE=local` and `R2_BUCKET=/out`, so the destination becomes `r2:/out/backups/...` on a local volume.
- **Restore never touches the connecting superuser's role.** `globals.sql` carries production password hashes; restoring `ALTER ROLE postgres ... PASSWORD` would lock the restore session out of the target, so lines creating or altering `${PGUSER}` are filtered out. "role already exists" errors are tolerated; any other error fails the restore.
- **Restore refuses to overwrite** existing `directus`/`portfolio`/`umami` databases unless `RESTORE_REPLACE=1` (checked before anything changes). The weekly check restores into an empty server; the disaster runbook restores onto a freshly deployed stack (where `01-init.sh` created empty databases) with `RESTORE_REPLACE=1`.
- **apk packages are not version-pinned** (`# hadolint ignore=DL3018`, with the reason in the Dockerfile): Alpine keeps only the newest build of each package per branch, so exact pins break the release build on every Alpine security fix. The base image is pinned to `alpine:3.24.2`, supercronic is pinned by version and sha256, and Trivy scans every release image. This was checked locally: hadolint clean, Trivy 0 HIGH/CRITICAL.
- **The textfile volume's ownership comes from the image.** `/textfile` is created in the image owned by uid 10001. On a fresh named volume Docker copies that ownership into the volume when the backup container first mounts it, even if node-exporter (no `/textfile` in its image) mounted it read-only first. The round-trip test reproduces that ordering.
- **supercronic is the amd64 build** (the VM is amd64). Building the image on an arm64 Mac works and the round-trip test passes there (the test never runs supercronic), but `docker run` of the default CMD only works on amd64.

- [ ] **Step 1: Write the round-trip test first**

`infra/backup/test-roundtrip.sh` (mode 0755: `chmod +x infra/backup/test-roundtrip.sh`):

```bash
#!/usr/bin/env bash
# Backup round trip. CI runs it in the infra job; locally: infra/backup/test-roundtrip.sh
#
# Seeds a throwaway Postgres the way production is initialised, runs backup.sh
# against it with a throwaway age key and a local rclone remote, then restores
# into a second Postgres with restore.sh (which runs verify.sql). Also checks the
# object name, the textfile metric, the heartbeat pings, that restore.sh refuses
# to overwrite without RESTORE_REPLACE=1, and that a failed upload pings /fail.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_IMAGE=pgvector/pgvector:0.8.6-pg17
HB_IMAGE=busybox:1.38.0
IMAGE="${BACKUP_TEST_IMAGE:-ci-backup}"
id="backup-rt-$$"
net="${id}"
src="${id}-src"
dst="${id}-dst"
hb="${id}-hb"
vols=("${id}-uploads" "${id}-textfile" "${id}-out" "${id}-keys" "${id}-restored")

cleanup() {
  docker rm -f "${src}" "${dst}" "${hb}" >/dev/null 2>&1 || true
  docker volume rm "${vols[@]}" >/dev/null 2>&1 || true
  docker network rm "${net}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "FAIL  $*" >&2
  exit 1
}
ok() { echo "ok    $*"; }

# Runs a command in the backup image as root (fixture setup and inspection only).
as_root() { docker run --rm --user 0 --entrypoint sh "$@"; }

wait_for_pg() {
  for _ in $(seq 1 60); do
    # TCP only answers after the image's init scripts finish and the server restarts.
    docker exec "$1" pg_isready -q -h 127.0.0.1 -U postgres && return 0
    sleep 1
  done
  fail "postgres $1 did not become ready"
}

echo "==> Building the backup image"
docker build -q -t "${IMAGE}" "${ROOT}/infra/backup" >/dev/null

echo "==> Starting source Postgres, restore target and heartbeat stub"
docker network create "${net}" >/dev/null
docker run -d --name "${src}" --network "${net}" --network-alias postgres \
  -e POSTGRES_PASSWORD=src-pass -e DIRECTUS_DB_PASSWORD=directus-pass \
  -e PORTFOLIO_DB_PASSWORD=portfolio-pass -e UMAMI_DB_PASSWORD=umami-pass \
  -v "${ROOT}/infra/postgres/init:/docker-entrypoint-initdb.d:ro" \
  "${PG_IMAGE}" >/dev/null
docker run -d --name "${dst}" --network "${net}" --network-alias restore-db \
  -e POSTGRES_PASSWORD=dst-pass "${PG_IMAGE}" >/dev/null
docker run -d --name "${hb}" --network "${net}" --network-alias heartbeat "${HB_IMAGE}" \
  sh -c 'mkdir -p /www/ping && echo ok >/www/ping/index.html && echo ok >/www/ping/fail && exec httpd -f -vv -p 8080 -h /www' >/dev/null
wait_for_pg "${src}"
wait_for_pg "${dst}"

echo "==> Seeding fixtures"
docker exec -i "${src}" psql -q -v ON_ERROR_STOP=1 -U postgres -d directus >/dev/null <<'SQL'
SET ROLE directus;
CREATE TABLE directus_collections (collection varchar(64) PRIMARY KEY);
CREATE TABLE profile (id serial PRIMARY KEY, full_name text);
CREATE TABLE experience (id serial PRIMARY KEY, title text);
CREATE TABLE projects (id serial PRIMARY KEY, title text);
INSERT INTO directus_collections VALUES ('profile'), ('experience'), ('projects');
INSERT INTO profile (full_name) VALUES ('Fixture Person');
INSERT INTO experience (title) VALUES ('Fixture role');
INSERT INTO projects (title) VALUES ('Fixture project');
SQL
docker exec -i "${src}" psql -q -v ON_ERROR_STOP=1 -U postgres -d portfolio >/dev/null <<'SQL'
SET ROLE portfolio;
CREATE TABLE alembic_version (version_num varchar(32) PRIMARY KEY);
INSERT INTO alembic_version VALUES ('fixture');
CREATE TABLE chunks (id serial PRIMARY KEY, embedding vector(3));
INSERT INTO chunks (embedding) VALUES ('[1,2,3]');
SQL
as_root -v "${id}-uploads:/u" "${IMAGE}" -c \
  'mkdir -p /u/sub && echo fixture >/u/sub/fixture.txt && chown -R 1000:1000 /u'
as_root -v "${id}-out:/out" -v "${id}-restored:/restored" "${IMAGE}" -c 'chown 10001:10001 /out /restored'
key="$(docker run --rm --entrypoint age-keygen "${IMAGE}" 2>/dev/null)"
recipient="$(printf '%s\n' "${key}" | docker run --rm -i --entrypoint age-keygen "${IMAGE}" -y)"
printf '%s\n' "${key}" | as_root -i -v "${id}-keys:/keys" "${IMAGE}" -c \
  'cat >/keys/key.txt && chown 10001:10001 /keys/key.txt && chmod 0400 /keys/key.txt'
unset key
# Production's node-exporter mounts the empty textfile volume read-only before
# the backup container may have started; reproduce that ordering.
docker run --rm -v "${id}-textfile:/textfile:ro" "${HB_IMAGE}" true

run_backup() {
  docker run --rm --network "${net}" \
    -e POSTGRES_PASSWORD=src-pass -e BACKUP_AGE_RECIPIENT="${recipient}" \
    -e BACKUP_HEARTBEAT_URL=http://heartbeat:8080/ping -e IMAGE_TAG=ci \
    -e R2_BUCKET=/out -e RCLONE_CONFIG_R2_TYPE=local \
    -v "${id}-uploads:/uploads:ro" -v "${id}-textfile:/textfile" "$@" \
    "${IMAGE}" backup.sh
}

restore() {
  docker run --rm --network "${net}" \
    -e PGHOST=restore-db -e PGUSER=postgres -e PGPASSWORD=dst-pass \
    -v "${id}-out:/out:ro" -v "${id}-keys:/keys:ro" -v "${id}-restored:/restored" "$@" \
    "${IMAGE}" restore.sh "/out/${object}" /keys/key.txt
}

echo "==> backup.sh"
run_backup -v "${id}-out:/out" || fail "backup.sh exited non-zero"
ok "backup.sh succeeded"

object="$(as_root -v "${id}-out:/out:ro" "${IMAGE}" -c 'cd /out && find backups -type f')"
re='^backups/([0-9]{4})/([0-9]{2})/([0-9]{2})/portfolio-([0-9]{4})([0-9]{2})([0-9]{2})T[0-9]{6}Z\.tar\.age$'
[[ "${object}" =~ ${re} ]] || fail "unexpected object name: ${object}"
[[ "${BASH_REMATCH[1]}${BASH_REMATCH[2]}${BASH_REMATCH[3]}" == "${BASH_REMATCH[4]}${BASH_REMATCH[5]}${BASH_REMATCH[6]}" ]] \
  || fail "object date path does not match its timestamp: ${object}"
ok "object name ${object}"
magic="$(as_root -v "${id}-out:/out:ro" "${IMAGE}" -c "head -c 21 '/out/${object}'")"
[[ "${magic}" == "age-encryption.org/v1" ]] || fail "object is not age-encrypted"
ok "object is age-encrypted"

metric="$(as_root -v "${id}-textfile:/textfile:ro" "${IMAGE}" -c 'cat /textfile/backup.prom; ls /textfile')"
grep -Eq '^backup_last_success_timestamp_seconds [0-9]{10}$' <<<"${metric}" || fail "timestamp metric missing"
grep -Eq '^backup_last_size_bytes [1-9][0-9]*$' <<<"${metric}" || fail "size metric missing"
grep -q 'backup.prom.tmp' <<<"${metric}" && fail "temp metric file left behind"
ok "textfile metric written"

docker logs "${hb}" 2>&1 | grep -q 'GET /ping$' || fail "success heartbeat not pinged"
docker logs "${hb}" 2>&1 | grep -q 'GET /ping/fail' && fail "failure heartbeat pinged on success"
ok "success heartbeat pinged"

echo "==> restore.sh into an empty server"
restore || fail "restore.sh into an empty server failed"
ok "restored and verified"

echo "==> restore.sh refuses to overwrite"
if restore 2>/dev/null; then fail "restore.sh overwrote existing databases without RESTORE_REPLACE=1"; fi
ok "refused without RESTORE_REPLACE=1"

echo "==> restore.sh with RESTORE_REPLACE=1 and uploads"
restore -e RESTORE_REPLACE=1 -e RESTORE_UPLOADS_DIR=/restored || fail "restore.sh with RESTORE_REPLACE=1 failed"
as_root -v "${id}-restored:/restored:ro" "${IMAGE}" -c 'grep -qx fixture /restored/sub/fixture.txt' \
  || fail "uploads not extracted"
ok "replaced, verified, uploads extracted"

echo "==> backup.sh failure path (read-only remote)"
before="$(as_root -v "${id}-textfile:/textfile:ro" "${IMAGE}" -c 'cat /textfile/backup.prom')"
if run_backup -v "${id}-out:/out:ro" 2>/dev/null; then fail "backup.sh succeeded with a read-only remote"; fi
docker logs "${hb}" 2>&1 | grep -q 'GET /ping/fail' || fail "failure heartbeat not pinged"
after="$(as_root -v "${id}-textfile:/textfile:ro" "${IMAGE}" -c 'cat /textfile/backup.prom')"
[[ "${before}" == "${after}" ]] || fail "metric changed after a failed backup"
ok "failure exits non-zero, pings /fail, keeps the last metric"

echo "backup round trip: all checks passed"
```

Run: `chmod +x infra/backup/test-roundtrip.sh && infra/backup/test-roundtrip.sh`
Expected: FAIL at `==> Building the backup image` (`infra/backup` has no Dockerfile yet).

- [ ] **Step 2: Dockerfile and crontab**

`infra/backup/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7
# Nightly backup job (infra/backup/backup.sh) scheduled by supercronic.
FROM alpine:3.24.2

ARG SUPERCRONIC_VERSION=v0.2.49
ARG SUPERCRONIC_SHA256=a53ae236602c7338aba3fbaff40bda6300eae3b9fedb8261eb06cfe3724430c1

SHELL ["/bin/ash", "-eo", "pipefail", "-c"]
# Package versions come from the pinned Alpine release (exact apk pins break the
# build whenever Alpine ships a security fix); Trivy scans every release image.
# hadolint ignore=DL3018
RUN apk add --no-cache age bash curl jq postgresql17-client rclone tar tzdata \
 && curl -fsSLo /usr/local/bin/supercronic \
      "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-amd64" \
 && echo "${SUPERCRONIC_SHA256}  /usr/local/bin/supercronic" | sha256sum -c - \
 && chmod 0755 /usr/local/bin/supercronic \
 && addgroup -g 10001 -S backup \
 && adduser -u 10001 -S -D -G backup -h /home/backup backup \
 && install -d -o 10001 -g 10001 -m 0755 /textfile

COPY --chmod=0755 backup.sh restore.sh /opt/backup/
COPY --chmod=0644 verify.sql crontab /opt/backup/

# The crontab schedule is local time; backup object names are UTC. rclone is
# configured only from RCLONE_CONFIG_R2_* environment variables.
ENV TZ=America/New_York \
    RCLONE_CONFIG=/dev/null \
    PATH="/opt/backup:${PATH}"
USER 10001:10001
WORKDIR /home/backup
CMD ["supercronic", "-passthrough-logs", "/opt/backup/crontab"]
```

`infra/backup/crontab`:

```
# Times are America/New_York (TZ is set in the image). Run by supercronic.
30 3 * * * /opt/backup/backup.sh
```

Run: `docker run --rm -i hadolint/hadolint < infra/backup/Dockerfile && echo hadolint-ok`
Expected: `hadolint-ok` with no findings.

- [ ] **Step 3: verify.sql**

The real Directus tables are `projects`, `experience`, `profile` (a singleton collection is still a table with one row) and `directus_collections` (`infra/directus/schema.mjs`); Alembic's table is `alembic_version` in `portfolio`.

`infra/backup/verify.sql`:

```sql
-- Checks that a restored backup holds real data. restore.sh runs it with
-- ON_ERROR_STOP, so any RAISE EXCEPTION fails the restore. Prints row counts only.
\connect directus
DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects', 'experience', 'profile', 'directus_collections'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n = 0 THEN
      RAISE EXCEPTION 'verify: directus.% has no rows', t;
    END IF;
    RAISE NOTICE 'verify: directus.% has % rows', t, n;
  END LOOP;
END $$;

\connect portfolio
DO $$
BEGIN
  IF to_regclass('public.alembic_version') IS NULL THEN
    RAISE EXCEPTION 'verify: portfolio.alembic_version is missing';
  END IF;
  RAISE NOTICE 'verify: portfolio.alembic_version exists';
END $$;
```

- [ ] **Step 4: backup.sh**

`infra/backup/backup.sh` (mode 0755):

```bash
#!/usr/bin/env bash
# Nightly off-site backup. Dumps Postgres (roles plus the directus, portfolio and
# umami databases) and the Directus uploads into a private temp dir, then streams
# one tar through age (public key only) to R2 via rclone. Runs from supercronic
# at 03:30 America/New_York, or by hand: `make backup-now` on the VM.
#
# Required env: POSTGRES_PASSWORD, BACKUP_AGE_RECIPIENT, R2_BUCKET,
# BACKUP_HEARTBEAT_URL, and an rclone remote named r2 (RCLONE_CONFIG_R2_*).
# Overridable (tests): PGHOST, PGUSER, UPLOADS_DIR, TEXTFILE_DIR, IMAGE_TAG.
#
# Success: writes backup.prom for node-exporter and pings the heartbeat.
# Failure: pings ${BACKUP_HEARTBEAT_URL}/fail and exits 1.
set -Eeuo pipefail

: "${POSTGRES_PASSWORD:?}" "${BACKUP_AGE_RECIPIENT:?}" "${R2_BUCKET:?}" "${BACKUP_HEARTBEAT_URL:?}"
export PGHOST="${PGHOST:-postgres}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${POSTGRES_PASSWORD}"
UPLOADS_DIR="${UPLOADS_DIR:-/uploads}"
TEXTFILE_DIR="${TEXTFILE_DIR:-/textfile}"
DATABASES=(directus portfolio umami)

ping_heartbeat() { curl -fsS -m 10 --retry 3 -o /dev/null "$1"; }

on_error() {
  echo "backup: FAILED at line $1" >&2
  ping_heartbeat "${BACKUP_HEARTBEAT_URL}/fail" || echo "backup: failure ping failed" >&2
  exit 1
}
trap 'on_error ${LINENO}' ERR

# Plaintext dumps exist only in this 0700 dir, which is removed on every exit.
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

read -r epoch iso yyyy mm dd stamp < <(date -u +'%s %Y-%m-%dT%H:%M:%SZ %Y %m %d %Y%m%dT%H%M%SZ')
dest="r2:${R2_BUCKET}/backups/${yyyy}/${mm}/${dd}/portfolio-${stamp}.tar.age"

echo "backup: dumping roles and databases from ${PGHOST}"
pg_dumpall --globals-only --file "${work}/globals.sql"
files=(globals.sql)
for db in "${DATABASES[@]}"; do
  pg_dump --format=custom --dbname "${db}" --file "${work}/${db}.dump"
  files+=("${db}.dump")
done

echo "backup: archiving uploads from ${UPLOADS_DIR}"
tar -cf "${work}/uploads.tar" -C "${UPLOADS_DIR}" .
files+=(uploads.tar)

for f in "${files[@]}"; do
  printf '%s\t%s\t%s\n' "${f}" "$(stat -c %s "${work}/${f}")" "$(sha256sum "${work}/${f}" | cut -d ' ' -f 1)"
done >"${work}/files.tsv"
jq -n --arg created_at "${iso}" --arg image_tag "${IMAGE_TAG:-unknown}" --rawfile rows "${work}/files.tsv" '{
  created_at: $created_at,
  image_tag: $image_tag,
  files: ($rows | split("\n") | map(select(length > 0) | split("\t")
    | {name: .[0], size: (.[1] | tonumber), sha256: .[2]}))
}' >"${work}/manifest.json"

echo "backup: encrypting and uploading to ${dest}"
tar -cf - -C "${work}" manifest.json "${files[@]}" \
  | age --encrypt --recipient "${BACKUP_AGE_RECIPIENT}" \
  | rclone rcat "${dest}"
size="$(rclone size --json "${dest}" | jq -r '.bytes')"

cat >"${TEXTFILE_DIR}/backup.prom.tmp" <<METRICS
# HELP backup_last_success_timestamp_seconds Unix time of the last successful backup.
# TYPE backup_last_success_timestamp_seconds gauge
backup_last_success_timestamp_seconds ${epoch}
# HELP backup_last_size_bytes Size in bytes of the last successful encrypted backup.
# TYPE backup_last_size_bytes gauge
backup_last_size_bytes ${size}
METRICS
mv -f "${TEXTFILE_DIR}/backup.prom.tmp" "${TEXTFILE_DIR}/backup.prom"

ping_heartbeat "${BACKUP_HEARTBEAT_URL}" || echo "backup: heartbeat ping failed (backup itself succeeded)" >&2
echo "backup: ok, ${size} bytes"
```

- [ ] **Step 5: restore.sh**

`infra/backup/restore.sh` (mode 0755). It must work both in the Alpine image (busybox `tar`, `sha256sum`, `readlink`) and on an Ubuntu runner (GNU tools), which is why it sticks to `sha256sum -c -`, `tar -tf`/`-xf`, `readlink -f` and `jq`.

```bash
#!/usr/bin/env bash
# Restores a backup made by backup.sh into the Postgres server named by PGHOST
# and PGUSER (a superuser; PGPASSWORD, or POSTGRES_PASSWORD), then runs
# verify.sql. Used by the weekly backup-verify workflow and the runbook's
# disaster procedure.
#
#   restore.sh <backup.tar.age> <age identity file>
#
# RESTORE_REPLACE=1          drop and recreate databases that already exist
#                            (restoring onto a freshly deployed stack). Without it
#                            the script refuses before changing anything.
# RESTORE_UPLOADS_DIR=<dir>  also extract the Directus uploads into <dir>.
# VERIFY_SQL=<file>          defaults to verify.sql next to this script.
#
# Never prints decrypted content: only file names, checksum results and counts.
set -euo pipefail

usage="usage: restore.sh <backup.tar.age> <age identity file>"
archive="${1:?${usage}}"
identity="${2:?${usage}}"
: "${PGHOST:?}" "${PGUSER:?}"
export PGPASSWORD="${PGPASSWORD:-${POSTGRES_PASSWORD:?set PGPASSWORD or POSTGRES_PASSWORD}}"
VERIFY_SQL="${VERIFY_SQL:-$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/verify.sql}"
DATABASES=(directus portfolio umami)

psql_admin() { psql -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }

existing=()
for db in "${DATABASES[@]}"; do
  if [[ -n "$(psql_admin -At -c "SELECT 1 FROM pg_database WHERE datname = '${db}'")" ]]; then
    existing+=("${db}")
  fi
done
if [[ ${#existing[@]} -gt 0 && "${RESTORE_REPLACE:-0}" != 1 ]]; then
  echo "restore: databases already exist (${existing[*]}); set RESTORE_REPLACE=1 to replace them" >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

echo "restore: decrypting"
age --decrypt --identity "${identity}" "${archive}" | tar -xf - -C "${work}"

echo "restore: checking manifest checksums"
for f in globals.sql "${DATABASES[@]/%/.dump}" uploads.tar; do
  jq -e --arg f "${f}" 'any(.files[]; .name == $f)' "${work}/manifest.json" >/dev/null \
    || { echo "restore: ${f} missing from manifest" >&2; exit 1; }
done
(cd "${work}" && jq -r '.files[] | "\(.sha256)  \(.name)"' manifest.json | sha256sum -c -)

echo "restore: roles"
# Leave the connecting superuser alone: restoring its production password hash
# would lock this session out of the target server.
grep -vE "^(CREATE|ALTER) ROLE \"?${PGUSER}\"?[ ;]" "${work}/globals.sql" >"${work}/globals.restore.sql"
psql -X -q -d postgres -f "${work}/globals.restore.sql" >/dev/null 2>"${work}/globals.err" || true
if grep -i 'error' "${work}/globals.err" | grep -vq 'already exists'; then
  echo "restore: restoring roles failed:" >&2
  grep -i 'error' "${work}/globals.err" | grep -v 'already exists' >&2
  exit 1
fi

for db in "${DATABASES[@]}"; do
  echo "restore: database ${db}"
  if [[ " ${existing[*]} " == *" ${db} "* ]]; then
    psql_admin -c "DROP DATABASE \"${db}\" WITH (FORCE)"
  fi
  psql_admin -c "CREATE DATABASE \"${db}\" OWNER \"${db}\""
  pg_restore --exit-on-error --dbname "${db}" "${work}/${db}.dump"
done

echo "restore: uploads"
count="$(tar -tf "${work}/uploads.tar" | grep -cv '/$' || true)"
if [[ "${count}" -lt 1 ]]; then
  echo "restore: uploads archive has no files" >&2
  exit 1
fi
echo "restore: uploads archive has ${count} files"
if [[ -n "${RESTORE_UPLOADS_DIR:-}" ]]; then
  tar -xf "${work}/uploads.tar" -C "${RESTORE_UPLOADS_DIR}"
  echo "restore: uploads extracted to ${RESTORE_UPLOADS_DIR}"
fi

echo "restore: verifying"
psql_admin -f "${VERIFY_SQL}"
echo "restore: ok"
```

Run:

```bash
chmod +x infra/backup/backup.sh infra/backup/restore.sh
docker run --rm -v "$PWD/infra/backup:/mnt" koalaman/shellcheck:stable /mnt/backup.sh /mnt/restore.sh /mnt/test-roundtrip.sh && echo shellcheck-ok
infra/backup/test-roundtrip.sh
```

Expected: `shellcheck-ok`, then the test ends with these lines (timestamps differ; the first run pulls `pgvector/pgvector:0.8.6-pg17` and `busybox:1.38.0`, ~40 s total afterwards):

```
ok    backup.sh succeeded
ok    object name backups/2026/10/03/portfolio-20261003T221651Z.tar.age
ok    object is age-encrypted
ok    textfile metric written
ok    success heartbeat pinged
ok    restored and verified
ok    refused without RESTORE_REPLACE=1
ok    replaced, verified, uploads extracted
ok    failure exits non-zero, pings /fail, keeps the last metric
backup round trip: all checks passed
```

The restore output in between shows `globals.sql: OK` … `uploads.tar: OK` and `NOTICE:  verify: directus.projects has 1 rows` etc. It must never show dump or SQL contents.

- [ ] **Step 6: Compose service and env example**

`infra/compose/compose.yaml`: add this service after the Task 5 services (before the `runner` comment block), and keep Task 5's `node-textfile:` entry under the top-level `volumes:`:

```yaml
  # Nightly encrypted backup to R2 (infra/backup). Holds only the age public key.
  backup:
    <<: *service
    image: ghcr.io/chrisguzman77/chris-guzman-portfolio/backup:${IMAGE_TAG:?}
    depends_on:
      postgres: { condition: service_healthy }
    environment:
      IMAGE_TAG: ${IMAGE_TAG:?}
      PGHOST: postgres
      PGUSER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?}
      BACKUP_AGE_RECIPIENT: ${BACKUP_AGE_RECIPIENT:?}
      BACKUP_HEARTBEAT_URL: ${BACKUP_HEARTBEAT_URL:?}
      R2_BUCKET: ${R2_BUCKET:?}
      RCLONE_CONFIG_R2_TYPE: s3
      RCLONE_CONFIG_R2_PROVIDER: Cloudflare
      RCLONE_CONFIG_R2_ACCESS_KEY_ID: ${R2_ACCESS_KEY_ID:?}
      RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: ${R2_SECRET_ACCESS_KEY:?}
      RCLONE_CONFIG_R2_ENDPOINT: https://${R2_ACCOUNT_ID:?}.r2.cloudflarestorage.com
      RCLONE_CONFIG_R2_NO_CHECK_BUCKET: "true"
    volumes:
      - directus-uploads:/uploads:ro
      - node-textfile:/textfile
    mem_limit: 256m
```

`infra/compose/prod.env.example`: append at the end of the "Stored in prod.enc.env" section (after Task 5's keys):

```
BACKUP_AGE_RECIPIENT=change-me
R2_ACCOUNT_ID=change-me
R2_BUCKET=change-me
R2_ACCESS_KEY_ID=change-me
R2_SECRET_ACCESS_KEY=change-me
BACKUP_HEARTBEAT_URL=change-me
```

Run:

```bash
docker compose -f infra/compose/compose.yaml --env-file infra/compose/prod.env.example config -q && echo config-ok
docker compose -f infra/compose/compose.yaml --env-file infra/compose/prod.env.example config | grep -E 'RCLONE_CONFIG_R2_ENDPOINT|backup:'
```

Expected: `config-ok`; the second command prints the `backup:` service key (plus the image line containing `backup:latest`) and `RCLONE_CONFIG_R2_ENDPOINT: https://change-me.r2.cloudflarestorage.com`.

- [ ] **Step 7: deploy.sh**

In `scripts/deploy.sh`, append ` backup` to the end of the default `SERVICES` list Task 5 left. With Task 5's list that line becomes:

```bash
SERVICES="${SERVICES:-postgres directus api web cloudflared prometheus grafana node-exporter cadvisor blackbox-exporter umami backup}"
```

(If Task 5's order differs, keep its order and only append `backup`.) Nothing else changes: `--remove-orphans` keeps working because every compose service except `runner` is now listed.

Run: `grep -n '^SERVICES=' scripts/deploy.sh`
Expected: one line ending in `umami backup}"` (or Task 5's last service followed by `backup}"`).

- [ ] **Step 8: release.yml, ci.yml, dependabot**

`.github/workflows/release.yml`, in `jobs.build.strategy.matrix.include`, add after the runner entry:

```yaml
          - { app: backup, context: infra/backup }
```

The existing steps then build, Trivy-scan (CRITICAL, `ignore-unfixed`) and push `…/backup:<sha>` and `…/backup:latest` exactly like web, api and runner. The `NEXT_PUBLIC_APP_VERSION` build arg is ignored by this Dockerfile (an unused `--build-arg` is only a warning).

`.github/workflows/ci.yml`, `infra` job:
- The existing hadolint step (`recursive: true`, `dockerfile: "**/Dockerfile"`) already lints `infra/backup/Dockerfile`, and the existing shellcheck step (`scandir: .`) already covers `infra/backup/*.sh`; the `infra` path filter (`infra/**`) already triggers on `infra/backup` changes. No change to those.
- Add after the `Build runner image` step:

```yaml
      - name: Backup round trip (backup.sh, restore.sh, verify.sql)
        run: infra/backup/test-roundtrip.sh
```

- Raise the job's `timeout-minutes` to `20` if it is lower (pulls of two images plus two image builds and Task 5's promtool step).

`.github/dependabot.yml`, add after the `/infra/runner` docker entry:

```yaml
  - package-ecosystem: docker
    directory: /infra/backup
    schedule: { interval: weekly }
    ignore:
      - dependency-name: "*"
        update-types: ["version-update:semver-major"]
```

Run:

```bash
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12 -no-color .github/workflows/ci.yml && echo actionlint-ok
grep -n 'app: backup' .github/workflows/release.yml
```

Expected: `actionlint-ok` (do not lint `release.yml` with actionlint: it flags the pre-existing `portfolio-deploy` self-hosted label); one matrix line for backup.

- [ ] **Step 9: Makefile**

Add `backup-now` to `.PHONY`, and add after the `chat-eval` target:

```make
BACKUP_CONTAINER = $$(docker ps -q --filter label=com.docker.compose.project=portfolio --filter label=com.docker.compose.service=backup | head -n 1)

backup-now:    ## (VM) Back up to R2 now (the nightly job: dumps, encrypts, uploads, pings Better Stack)
	docker exec $(BACKUP_CONTAINER) backup.sh
```

Run: `make help | grep backup-now && make -n backup-now`
Expected: the help line, then `docker exec $(docker ps -q --filter label=com.docker.compose.project=portfolio --filter label=com.docker.compose.service=backup | head -n 1) backup.sh`.

- [ ] **Step 10: Commit**

```bash
infra/backup/test-roundtrip.sh
docker compose -f infra/compose/compose.yaml --env-file infra/compose/prod.env.example config -q
git add infra/backup infra/compose/compose.yaml infra/compose/prod.env.example scripts/deploy.sh \
  .github/workflows/release.yml .github/workflows/ci.yml .github/dependabot.yml Makefile
git commit -m "feat(infra): nightly encrypted backup container to R2 with restore script and CI round trip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Weekly restore check workflow

Track C, after Task 6 (it runs `infra/backup/restore.sh` and `verify.sql`).

**Files:**
- Create: `.github/workflows/backup-verify.yml`

**Interfaces:**
- Consumes: `infra/backup/restore.sh <backup.tar.age> <identity>` with `PGHOST`/`PGUSER`/`PGPASSWORD` (runs `verify.sql` itself); object names `backups/YYYY/MM/DD/portfolio-YYYYMMDDTHHMMSSZ.tar.age`; GitHub environment `backup-verify` secrets `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_READ_ACCESS_KEY_ID`, `R2_READ_SECRET_ACCESS_KEY`, `BACKUP_AGE_KEY` (created by Chris, Task 10 / `docs/setup.md`).
- Produces: a red or green weekly run (GitHub emails Chris on failure).

Design notes (decided):
- **The age check uses the timestamp in the object name**, not R2's modification time. Objects are sorted by path (the dated layout sorts chronologically) and the newest must be under 36 h old.
- **PostgreSQL 17 client from PGDG.** The runner's preinstalled client is older and `pg_restore` cannot read pg_dump 17 archives. The step installs `postgresql-client-17` through the official `apt.postgresql.org.sh` helper (preinstalled with `postgresql-common` on GitHub's Ubuntu images) and puts `/usr/lib/postgresql/17/bin` first on `PATH`, so Ubuntu's version-picking wrapper cannot pick the old client.
- **Version env vars are named `PIN_*`.** rclone reads every `RCLONE_*` environment variable as a flag (`RCLONE_VERSION=v1.75.1` makes rclone abort with `invalid value ... for "--version"`; seen while drafting).
- **Secrets are scoped to the steps that need them**: the R2 read token only on the download step, `BACKUP_AGE_KEY` only on the restore step. The key goes to a `mktemp` file (mode 0600) under `$RUNNER_TEMP`, and an `if: always()` step shreds it and deletes the downloaded backup.
- Actions are pinned by SHA like the existing workflows (`actions/checkout@3d3c42e5…` v7.0.1). CI does not run actionlint, so this task does not add it to CI; run it locally in Step 2.
- Drafted and dry-run in an `ubuntu:24.04` container: same install commands, `rclone lsjson` against a local remote, `restore.sh` into a pgvector 17 server: `restore: ok`.

- [ ] **Step 1: Workflow**

`.github/workflows/backup-verify.yml`:

```yaml
name: backup-verify

# Weekly proof that the newest off-site backup restores: download it from R2
# with a read-only token, decrypt it, restore it into a throwaway Postgres and
# run infra/backup/verify.sql. Nothing decrypted is ever printed.
on:
  schedule:
    - cron: "0 9 * * 0" # Sundays 09:00 UTC
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: backup-verify
  cancel-in-progress: false

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    environment: backup-verify
    services:
      postgres:
        image: pgvector/pgvector:0.8.6-pg17
        env:
          POSTGRES_PASSWORD: verify
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
    env:
      # Not RCLONE_*: rclone reads every RCLONE_* variable as a flag.
      PIN_AGE_VERSION: v1.3.2
      PIN_AGE_SHA256: cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10
      PIN_RCLONE_VERSION: v1.75.1
      PIN_RCLONE_SHA256: 982b5aa772841168f8e380f139e9e787b2a105403e32b94da8676a0e1c0a13ab
      MAX_AGE_HOURS: "36"
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1

      - name: Install age, rclone and the PostgreSQL 17 client
        run: |
          set -euo pipefail
          curl -fsSLo /tmp/age.tgz \
            "https://github.com/FiloSottile/age/releases/download/${PIN_AGE_VERSION}/age-${PIN_AGE_VERSION}-linux-amd64.tar.gz"
          echo "${PIN_AGE_SHA256}  /tmp/age.tgz" | sha256sum -c -
          sudo tar -xzf /tmp/age.tgz -C /usr/local/bin --strip-components=1 age/age
          curl -fsSLo /tmp/rclone.zip \
            "https://downloads.rclone.org/${PIN_RCLONE_VERSION}/rclone-${PIN_RCLONE_VERSION}-linux-amd64.zip"
          echo "${PIN_RCLONE_SHA256}  /tmp/rclone.zip" | sha256sum -c -
          unzip -q -j -d /tmp/rclone /tmp/rclone.zip "rclone-${PIN_RCLONE_VERSION}-linux-amd64/rclone"
          sudo install -m 0755 /tmp/rclone/rclone /usr/local/bin/rclone
          # Backups are pg_dump 17 archives; older pg_restore cannot read them.
          sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
          sudo apt-get install -y -q postgresql-client-17
          echo /usr/lib/postgresql/17/bin >>"${GITHUB_PATH}"

      - name: Find and download the newest backup
        env:
          RCLONE_CONFIG: /dev/null
          RCLONE_CONFIG_R2_TYPE: s3
          RCLONE_CONFIG_R2_PROVIDER: Cloudflare
          RCLONE_CONFIG_R2_ACCESS_KEY_ID: ${{ secrets.R2_READ_ACCESS_KEY_ID }}
          RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: ${{ secrets.R2_READ_SECRET_ACCESS_KEY }}
          RCLONE_CONFIG_R2_ENDPOINT: https://${{ secrets.R2_ACCOUNT_ID }}.r2.cloudflarestorage.com
          RCLONE_CONFIG_R2_NO_CHECK_BUCKET: "true"
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
        run: |
          set -euo pipefail
          pg_restore --version
          newest="$(rclone lsjson --recursive --files-only "r2:${R2_BUCKET}/backups" \
            | jq -r 'sort_by(.Path) | last | .Path // empty')"
          if [[ -z "${newest}" ]]; then
            echo "::error::no backups found in the bucket"
            exit 1
          fi
          re='portfolio-([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z\.tar\.age$'
          if [[ ! "${newest}" =~ ${re} ]]; then
            echo "::error::unexpected object name ${newest}"
            exit 1
          fi
          m=("${BASH_REMATCH[@]}")
          taken="$(date -u -d "${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z" +%s)"
          hours=$(( ($(date -u +%s) - taken) / 3600 ))
          echo "newest backup: ${newest} (${hours} h old)"
          if (( hours >= MAX_AGE_HOURS )); then
            echo "::error::newest backup is ${hours} h old (limit ${MAX_AGE_HOURS} h); nightly backups have stopped"
            exit 1
          fi
          rclone copyto "r2:${R2_BUCKET}/backups/${newest}" "${RUNNER_TEMP}/backup.tar.age"

      - name: Restore into a throwaway Postgres and verify
        env:
          BACKUP_AGE_KEY: ${{ secrets.BACKUP_AGE_KEY }}
          PGHOST: localhost
          PGUSER: postgres
          PGPASSWORD: verify
        run: |
          set -euo pipefail
          key_file="$(mktemp "${RUNNER_TEMP}/age-key.XXXXXX")" # mode 0600
          printf '%s\n' "${BACKUP_AGE_KEY}" >"${key_file}"
          infra/backup/restore.sh "${RUNNER_TEMP}/backup.tar.age" "${key_file}"

      - name: Remove the key and the backup
        if: always()
        run: |
          shopt -s nullglob
          for f in "${RUNNER_TEMP}"/age-key.*; do shred -u "${f}"; done
          rm -f "${RUNNER_TEMP}/backup.tar.age"
```

- [ ] **Step 2: Lint**

Run:

```bash
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12 -no-color .github/workflows/backup-verify.yml && echo actionlint-ok
```

Expected: `actionlint-ok` (actionlint also shellchecks the `run:` blocks).

The first real run happens after the code PR merges and the first backup exists: Chris runs it from Actions → backup-verify → Run workflow (Task 10). Scheduled runs only fire from the default branch.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/backup-verify.yml
git commit -m "ci: weekly backup restore check against the newest R2 backup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: VM swapfile, smoke checks, ADRs 0009–0010, runbook, setup, architecture

Track C, after Task 7. Docs describe what Tasks 1–7 built; use the names exactly as written here (they match the spec and Global Constraints).

**Files:**
- Modify: `infra/vm/bootstrap.sh` (swapfile), `infra/vm/README.md` (one line)
- Modify: `scripts/smoke.sh` (`/v1/status`, public `/metrics` 404, `SKIP_STATUS_SMOKE`)
- Create: `docs/adr/0009-monitoring-without-loki.md`, `docs/adr/0010-backup-encryption-and-bucket-lock.md`; Modify: `docs/adr/README.md`
- Modify: `docs/runbook.md`, `docs/setup.md`, `docs/architecture.md`, `infra/cloudflare/README.md`

**Interfaces:**
- Consumes: `GET /v1/status` (Task 2) → 200 JSON with `status`; `/metrics` → 404 with `CF-Connecting-IP` (Task 1; Cloudflare always adds that header, so through the tunnel it is always 404); `make backup-now`, `restore.sh` env and flags (Task 6); `backup-verify` workflow (Task 7); Grafana dashboards "Portfolio overview" and "Host & containers" and the seven alert names (Task 5).
- Produces: `SKIP_STATUS_SMOKE=1` and `SMOKE_PUBLIC_API_URL` for `scripts/smoke.sh`; a re-runnable swap step in `bootstrap.sh`.

- [ ] **Step 1: Swapfile in bootstrap.sh**

In `infra/vm/bootstrap.sh`, change the last header comment line to:

```bash
# and age; creates the VM's age key; hands /opt/portfolio to the runner's uid;
# adds a 2 GB swapfile.
```

and insert this block immediately before `step "Done"`:

```bash
step "Swap: 2 GB /swapfile, vm.swappiness=10"
# Safety net for memory spikes; every container also has a mem_limit.
if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 0600 /swapfile
  mkswap /swapfile >/dev/null
fi
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  swapon /swapfile
fi
if ! grep -qE '^/swapfile[[:space:]]' /etc/fstab; then
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi
echo 'vm.swappiness=10' >/etc/sysctl.d/99-portfolio-swap.conf
sysctl -q -p /etc/sysctl.d/99-portfolio-swap.conf
```

Every step checks before acting, so a re-run changes nothing (the sysctl file is rewritten with the same content). It cannot be exercised in a container (overlayfs refuses `swapon`); Chris runs it on the VM in Task 10 and checks `swapon --show` (one `/swapfile` row, 2G) and `cat /proc/sys/vm/swappiness` (`10`).

In `infra/vm/README.md`, change "Re-running it is safe." to "Re-running it is safe (Phase 6 added a 2 GB swapfile; re-run it once to get it)."

- [ ] **Step 2: Smoke checks**

In `scripts/smoke.sh`:

1. Extend the header comment, after the `POST /v1/chat/sessions` line:

```bash
# GET /v1/status must return 200 JSON with a "status" key (SKIP_STATUS_SMOKE=1 skips it when rolling
# back to an image older than Phase 6). With SMOKE_PUBLIC_URL set, the API's /metrics must be 404
# through the public API hostname (SMOKE_PUBLIC_API_URL, default https://api.<SMOKE_PUBLIC_URL host>).
```

2. Add this helper after `in_service()` and before `status=0`:

```bash
# shellcheck disable=SC2329 # invoked indirectly through check "$@"
http_status_is() {
  [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$2")" == "$1" ]]
}
```

3. Add before the `check "directus /server/ping"` line:

```bash
if [[ "${SKIP_STATUS_SMOKE:-0}" == 1 ]]; then
  echo "skip  api /v1/status (SKIP_STATUS_SMOKE=1)"
else
  check "api /v1/status returns JSON with a status" in_service api python -c "
import json, sys, urllib.request
with urllib.request.urlopen('http://127.0.0.1:8000/v1/status', timeout=5) as resp:
    sys.exit(resp.status != 200 or 'status' not in json.load(resp))" || status=1
fi
```

4. Inside the existing `if [[ -n "${SMOKE_PUBLIC_URL:-}" ]]; then` block, after the public healthz check:

```bash
  public_api="${SMOKE_PUBLIC_API_URL:-https://api.${SMOKE_PUBLIC_URL#https://}}"
  check "public ${public_api}/metrics is hidden (404)" http_status_is 404 "${public_api}/metrics" || status=1
```

(`deploy` in `release.yml` sets `SMOKE_PUBLIC_URL=https://christopherguzman.me`, so the check probes `https://api.christopherguzman.me/metrics`.)

Run:

```bash
docker run --rm -v "$PWD:/mnt" koalaman/shellcheck:stable /mnt/scripts/smoke.sh /mnt/infra/vm/bootstrap.sh && echo shellcheck-ok
```

Expected: `shellcheck-ok`. The checks themselves run against the dev stack in Task 9 and on the VM at deploy.

- [ ] **Step 3: ADRs**

`docs/adr/0009-monitoring-without-loki.md`:

```markdown
# 0009 — Monitoring with Prometheus and Grafana, no Loki; public status served through the API

Status: accepted · 2026-10-03

## Context
Phase 6 needs an email when something breaks and an honest status card on the homepage. The VM has 4 GiB of RAM with about 2.8 GiB free, one maintainer, and little log volume. Better Stack already checks the site from outside.

## Decision
- Prometheus (30 s scrapes, 35 days or 2 GB), node-exporter, cAdvisor and blackbox-exporter, with Grafana for dashboards and alerts. Alerts are Grafana-managed and go out as email through Resend's SMTP. Every container has a memory limit.
- No Loki or Alloy. `docker logs` with the existing rotation (3 × 10 MB per container) stays the log tool. Log search would cost several hundred MB of RAM for little benefit at this size.
- No Uptime Kuma. Better Stack checks from outside the home network, and a blackbox probe of the public URL covers it from inside.
- Grafana stays private, behind Cloudflare Access and its own login. The public status card gets its numbers from `GET /v1/status`. The API runs fixed PromQL queries (2 s timeout), caches the result for 60 s, and returns `degraded` with null values when Prometheus fails. Nothing from the request reaches Prometheus, and Prometheus has no public hostname.
- The API's `/metrics` returns 404 when the request carries `CF-Connecting-IP`, the same rule as `/internal/*`, so only containers on the VM can scrape it.

## Consequences
- Searching logs means SSH and `docker logs`; old logs rotate away.
- Directus and cloudflared are not scraped. Their failures show up through cAdvisor's `container_last_seen` and the site probe.
- Grafana cannot report a dead VM or a home-internet outage; Better Stack covers those.
- The card counts time with no probe samples as downtime, so its uptime figure errs low rather than high.
- Prometheus and Grafana data are not backed up. Losing them resets graphs and the card's 30-day history.
```

`docs/adr/0010-backup-encryption-and-bucket-lock.md`:

```markdown
# 0010 — Backups encrypted to a dedicated age key, stored in R2 with a 30-day bucket lock

Status: accepted · 2026-10-03

## Context
The only copy of the site's content (Directus database and uploads), contact messages and chat logs lives on one VM on a home Proxmox host, and the Proxmox snapshot backups sit on the same host. Backups need to be off-site, unreadable to the storage provider, safe from a compromised VM or a bad script, proven restorable, and free.

## Decision
- Every night at 03:30 America/New_York: `pg_dumpall --globals-only`, `pg_dump -Fc` of `directus`, `portfolio` and `umami`, and a tar of the uploads volume, with a checksum manifest. One tar stream goes through `age` to Cloudflare R2 with `rclone`; no plaintext leaves a temp dir that is deleted on exit.
- A dedicated age key pair. The VM holds only the public key (`BACKUP_AGE_RECIPIENT`). The private key lives in Chris's password manager and in the GitHub secret `BACKUP_AGE_KEY`. It is not the SOPS key: that key lives on the VM, so it would give a compromised VM access to every old backup and would be lost along with the VM.
- R2 bucket lock for 30 days and a lifecycle rule that deletes after 31 days. The VM's token can read and write that one bucket; the lock stops it from deleting or overwriting the last 30 days. GitHub's token is read-only.
- Proof that backups work: a Better Stack heartbeat on every success (and a `/fail` ping on failure), a Grafana "Backup stale" alert after 36 h, and a weekly GitHub Actions job that restores the newest backup into a throwaway Postgres and runs `infra/backup/verify.sql`. The same `restore.sh` is the runbook's disaster procedure.

## Consequences
- Losing the private key makes every backup unreadable. GitHub secrets cannot be read back, so the password manager copy is the one that matters.
- At most one day of data is lost in a disaster, and nothing older than 31 days can be restored.
- A locked object cannot be deleted early, even by mistake. The cost is negligible at this size (well inside R2's free 10 GB, and R2 has no egress fees).
- Rotating the key means keeping the old private key for 31 days, until the last backup encrypted to it expires.
- Prometheus and Grafana data are not backed up.
```

`docs/adr/README.md`, add two rows after 0008:

```markdown
| [0009](0009-monitoring-without-loki.md) | Monitoring with Prometheus and Grafana, no Loki; public status served through the API |
| [0010](0010-backup-encryption-and-bucket-lock.md) | Backups encrypted to a dedicated age key, stored in R2 with a 30-day bucket lock |
```

- [ ] **Step 4: Runbook**

`docs/runbook.md`:

1. "## First deploy", step 1: change "(so web, api and runner images exist), and all three GHCR packages — web, api, runner — are public" to "(so web, api, runner and backup images exist), and all four GHCR packages — web, api, runner, backup — are public".

2. "## Roll back": add after the pre-Phase-3 paragraph and its code block:

~~~~markdown
Rolling back to an image from before Phase 6 needs `SKIP_STATUS_SMOKE=1` (older APIs have no `/v1/status`) and a service list without `backup`, whose image did not exist yet. The backup container keeps running its current image:

```bash
sudo IMAGE_TAG=<pre-Phase-6 sha> SKIP_STATUS_SMOKE=1 \
  SERVICES="postgres directus api web cloudflared prometheus grafana node-exporter cadvisor blackbox-exporter umami" \
  /opt/portfolio/scripts/deploy.sh
```
~~~~

3. Add these three sections before "## Rotate secrets":

~~~~markdown
## Monitoring and analytics

- **Dashboards:** https://grafana.christopherguzman.me (Cloudflare Access, then the Grafana login `admin` / `GRAFANA_ADMIN_PASSWORD`). Dashboards → "Portfolio overview" (site, API, chat, contact, last backup; resume downloads are in Umami) and "Host & containers" (VM CPU, memory, swap, disk; each container against its limit). Prometheus has no hostname; query it from Grafana → Explore.
- **Alerts** email `CONTACT_TO` from `alerts@christopherguzman.me`: Disk filling, Memory tight, Site down, API errors, Container down, Backup stale, Chat budget. They are provisioned from `infra/observability/grafana/provisioning/`; change them there, not in the UI.
- **Silence an alert** (planned work or a known issue): Grafana → Alerting → Silences → New silence. Add the matcher `alertname` = the alert's name (for example `Site down`), pick a duration, write a comment, save. It ends on its own; to end it early, open Alerting → Silences and expire it. A silence only stops the emails; the rule keeps evaluating.
- **Test alert email:** Grafana → Alerting → Contact points → the email contact point → Test.
- **Analytics:** https://analytics.christopherguzman.me (Access, then the Umami login). Custom events: `resume-download`, `chat-open`, `chat-question`, `contact-sent`, `outbound-click`. Without `UMAMI_WEBSITE_ID` the site loads no tracker.
- **Status card:** the homepage card reads `GET /v1/status` (`curl -s https://api.christopherguzman.me/v1/status`). If it shows `degraded` with every value `—`, Prometheus is usually down: `docker logs --tail 50 portfolio-prometheus-1`.

## Backups

- Every night at 03:30 (America/New_York) the `backup` container dumps the roles and the `directus`, `portfolio` and `umami` databases plus the Directus uploads, encrypts them with the backup age public key, and uploads one file to R2: `backups/YYYY/MM/DD/portfolio-<UTC time>.tar.age`. R2 locks each file for 30 days and deletes it after 31.
- **Run a backup now:** `make backup-now` on the VM. It ends with `backup: ok, <size> bytes`. Better Stack's `portfolio backup` heartbeat turns green, and Grafana's last-backup panel updates within a minute.
- **Nightly logs:** `docker logs --tail 50 portfolio-backup-1`.
- **When a backup fails:** Better Stack emails (from the `/fail` ping, or when no ping arrives within a day plus 2 hours), and Grafana's Backup stale alert fires after 36 hours. Run `make backup-now` to see the error. Usual causes: an expired or revoked R2 token (rclone reports 403), Postgres down, a full disk.
- **Weekly proof:** the `backup-verify` workflow (Sundays 09:00 UTC) restores the newest backup into a throwaway Postgres and runs `infra/backup/verify.sql`. Run it by hand after any backup change: Actions → backup-verify → Run workflow.
- The decryption key is not on the VM. It is in the password manager (`portfolio backup age key`) and the GitHub secret `BACKUP_AGE_KEY`.

## Restore after disaster

Use this when the VM or its disk is lost, or the databases are damaged. It replaces the three databases and puts the backup's uploads back. Prometheus and Grafana history are not in backups and start empty.

1. If the VM is gone, rebuild and bootstrap it ([`infra/vm/README.md`](../infra/vm/README.md)), add its new age public key to `.sops.yaml` and run `sops updatekeys infra/compose/prod.enc.env`, then follow "First deploy" above. The site comes up with seed content.
2. Stop everything that writes to Postgres:

   ```bash
   docker stop portfolio-web-1 portfolio-api-1 portfolio-directus-1 portfolio-umami-1
   ```

3. Open a throwaway shell in the backup image. It gets the backup container's Postgres and R2 settings without printing them, and the uploads volume mounted writable as uid 1000 (Directus's user, which owns the uploads):

   ```bash
   docker run --rm -it --user 1000:1000 --network portfolio_default \
     --env-file <(docker exec portfolio-backup-1 env | grep -E '^(PGHOST|PGUSER|POSTGRES_PASSWORD|R2_BUCKET|RCLONE_CONFIG_R2_[A-Z_]+)=') \
     -v portfolio_directus-uploads:/uploads-restore \
     --entrypoint bash "$(docker inspect -f '{{.Config.Image}}' portfolio-backup-1)"
   ```

4. In that shell, list the newest backups and download one (use a path from the list):

   ```bash
   rclone lsf --recursive --files-only "r2:${R2_BUCKET}/backups" | sort | tail -n 5
   rclone copyto "r2:${R2_BUCKET}/backups/2026/10/03/portfolio-20261003T073012Z.tar.age" /tmp/backup.tar.age
   ```

5. Paste the private key from the password manager (the whole key file, or just its `AGE-SECRET-KEY-…` line), press Enter, then Ctrl-D:

   ```bash
   (umask 077; cat >/tmp/age.key)
   ```

6. Restore, then leave the shell:

   ```bash
   RESTORE_REPLACE=1 RESTORE_UPLOADS_DIR=/uploads-restore restore.sh /tmp/backup.tar.age /tmp/age.key
   exit
   ```

   It checks the manifest checksums, restores the roles and the three databases, extracts the uploads, runs `verify.sql`, and ends with `restore: ok`. If it stops early, fix the cause and run the same command again; `RESTORE_REPLACE=1` makes re-runs safe. Leaving the shell deletes the container, the key and the download.
7. Start the apps and check them:

   ```bash
   docker start portfolio-directus-1 portfolio-api-1 portfolio-web-1 portfolio-umami-1
   scripts/smoke.sh
   make backup-now
   ```
~~~~

4. "## Rotate secrets": add these bullets after the Turnstile bullet:

```markdown
- **Backup age key:** `age-keygen -o backup-age.key` on the laptop. Set the new public key as `BACKUP_AGE_RECIPIENT` (`make secrets-edit`, merge), and replace `BACKUP_AGE_KEY` in the GitHub `backup-verify` environment. Keep the old private key in the password manager for 31 days after the switch: backups made before it still need it.
- **R2 tokens:** create a new token with the same scope. For the VM token, update `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` with `make secrets-edit`, merge, then `make backup-now`. For the read token, update `R2_READ_ACCESS_KEY_ID` and `R2_READ_SECRET_ACCESS_KEY` in the `backup-verify` environment and run the workflow. Then delete the old token.
- **Grafana admin password:** Grafana reads `GRAFANA_ADMIN_PASSWORD` only when its database is first created. Change it in Grafana (avatar → Profile → Change password), then set the same value with `make secrets-edit` so the record matches.
- **Better Stack heartbeat:** set the new URL as `BACKUP_HEARTBEAT_URL` with `make secrets-edit`, merge.
```

- [ ] **Step 5: Setup**

`docs/setup.md`: replace the whole "## Cloudflare R2 (Phase 6)" section (heading and its one bullet) with:

~~~~markdown
## Backups, monitoring and analytics (Phase 6)

Steps 1–6 happen before the Phase 6 code PR merges: the new compose services refuse to start without these secrets. Steps 7–9 come after it deploys.

1. **R2 bucket.** Cloudflare dashboard → R2 → Create bucket `portfolio-backups` (location Automatic). In the bucket's Settings:
   - Bucket lock rules → Add rule: prefix `backups/`, retain for 30 days.
   - Object lifecycle rules → Add rule: prefix `backups/`, delete objects 31 days after upload; abort incomplete multipart uploads after 1 day.
   Note the Account ID from the R2 overview page.
2. **Two R2 tokens.** R2 → Manage API tokens → Create API token, twice, each applied to `portfolio-backups` only:
   - `portfolio-backup-vm`, permission Object Read & Write: its Access Key ID and Secret Access Key become `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.
   - `portfolio-backup-verify`, permission Object Read only: for GitHub (step 5).
3. **Backup key.** On the Mac: `age-keygen -o backup-age.key`. It prints `Public key: age1…`, which becomes `BACKUP_AGE_RECIPIENT`. Save the whole file in the password manager as `portfolio backup age key` and as the GitHub secret `BACKUP_AGE_KEY` (step 5), then `rm backup-age.key`. The private key never goes on the VM or into `prod.enc.env`; losing it makes every backup unreadable.
4. **Better Stack heartbeat.** Better Stack → Heartbeats → Create: name `portfolio backup`, expected every 1 day, grace period 2 hours, email alerts. Its URL becomes `BACKUP_HEARTBEAT_URL` (the backup adds `/fail` itself when a run fails).
5. **GitHub environment.** Settings → Environments → New environment `backup-verify`. Add secrets `R2_ACCOUNT_ID`, `R2_BUCKET` (`portfolio-backups`), `R2_READ_ACCESS_KEY_ID`, `R2_READ_SECRET_ACCESS_KEY` (the read-only token) and `BACKUP_AGE_KEY`.
6. **Tunnel and Access.** Zero Trust → Networks → Tunnels → `portfolio` → Public hostnames: add `grafana.christopherguzman.me` → `http://grafana:3000` and `analytics.christopherguzman.me` → `http://umami:3000`. Access → Applications: add self-hosted apps `Grafana` and `Umami` for those hostnames with the `Chris only` policy (one-time PIN), as for `cms.`. The record is in [`infra/cloudflare/README.md`](../infra/cloudflare/README.md).
7. **Secrets.** Generate `GRAFANA_ADMIN_PASSWORD` and `UMAMI_APP_SECRET` with `openssl rand -hex 32` (once each). `make secrets-edit`, add those two and `BACKUP_AGE_RECIPIENT`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `BACKUP_HEARTBEAT_URL`; commit and push. This deploys unchanged code; the current compose file ignores the new keys.
8. **After the code PR deploys.**
   - The release creates a new GHCR package, `backup`, which starts private, so the first deploy stops at `compose pull` (nothing changes on the VM). GitHub → Packages → backup → Package settings → Change visibility → Public, then re-run the failed deploy job.
   - `make secrets-check` on the laptop reports `secrets look ready`.
   - On the VM: `make backup-now` ends with `backup: ok`. Better Stack shows the heartbeat.
   - Actions → backup-verify → Run workflow: green.
   - Grafana → Alerting → Contact points → email → Test: the email arrives.
9. **Umami.** Open https://analytics.christopherguzman.me and log in as `admin` / `umami`, then change the password at once (Settings → Profile). Settings → Websites → Add website: name `portfolio`, domain `christopherguzman.me`. Copy its Website ID, add it as `UMAMI_WEBSITE_ID` with `make secrets-edit`, commit and push. The tracker appears after that deploy.
10. **Swap.** On the VM: `cd /opt/portfolio && sudo ./infra/vm/bootstrap.sh`, then `swapon --show` lists `/swapfile` (2G).
~~~~

- [ ] **Step 6: Architecture and Cloudflare record**

`docs/architecture.md`:

1. In "Boundaries that matter", replace the bullet "Only `api` and `directus` hold Postgres credentials, each for its own database." with:

```markdown
- Only `api`, `directus` and `umami` hold Postgres credentials, each for its own database. The `backup` container holds the superuser password so it can dump everything.
```

2. Add this section after "## Chat (Phase 5)" (before "## Notes"):

~~~~markdown
## Monitoring, analytics and backups (Phase 6)

```mermaid
flowchart LR
  subgraph VM [Proxmox VM · Docker Compose]
    PR[prometheus] -->|scrape every 30 s| A[api /metrics]
    PR --> NE[node-exporter]
    PR --> CA[cadvisor]
    PR --> BB[blackbox-exporter]
    G[grafana] --> PR
    A -->|/v1/status, fixed PromQL| PR
    W[web] -->|/stats/* rewrite| UM[umami]
    UM --> P[(postgres)]
    BK[backup] -->|pg_dump| P
    BK -->|backup.prom| NE
  end
  BB -->|probe| S[public site /api/healthz]
  BK -->|age-encrypted tar| R2[(Cloudflare R2, 30-day lock)]
  G -->|email via Resend| C[Chris]
  GH[GitHub Actions, weekly] -->|download, restore, verify| R2
```

- **Prometheus** scrapes every 30 s and keeps 35 days (at most 2 GB). It has no hostname. **Grafana** (`grafana.`, behind Access) has the dashboards and sends alert emails.
- **Status card:** web reads `/v1/status` from the API, which queries Prometheus with fixed queries and caches the result for 60 s. Prometheus is never public ([ADR 0009](adr/0009-monitoring-without-loki.md)).
- **Umami** (`analytics.`, behind Access) stores cookieless analytics in its own `umami` database. Browsers reach it only through web's `/stats/*` rewrites.
- **Backups** run nightly, encrypted to a key the VM does not hold, into R2 with a 30-day lock, and a weekly GitHub Actions run proves they restore ([ADR 0010](adr/0010-backup-encryption-and-bucket-lock.md)).
- Every container has a memory limit, and the VM has 2 GB of swap as a safety net.
~~~~

`infra/cloudflare/README.md`:

1. In the tunnel table, add before the `anything else` row:

```markdown
| `grafana.christopherguzman.me` | `http://grafana:3000` |
| `analytics.christopherguzman.me` | `http://umami:3000` |
```

2. In "## Access", add after the first paragraph:

```markdown
Applications `Grafana` (`grafana.christopherguzman.me`) and `Umami` (`analytics.christopherguzman.me`) use the same `Chris only` policy and one-time-PIN login. Both apps also have their own login behind Access.
```

3. In "## External uptime monitor", add:

```markdown
A second Better Stack check, a heartbeat named `portfolio backup` (expected daily, 2 h grace), is pinged by every successful nightly backup and by `<url>/fail` when one fails.
```

Run:

```bash
grep -c '0009\|0010' docs/adr/README.md
grep -n '^## ' docs/runbook.md
```

Expected: `2`; the runbook headings include "Monitoring and analytics", "Backups", "Restore after disaster" before "Rotate secrets".

- [ ] **Step 7: Commit**

```bash
git add infra/vm scripts/smoke.sh docs/adr docs/runbook.md docs/setup.md docs/architecture.md infra/cloudflare/README.md
git commit -m "feat(infra): VM swapfile, status and metrics smoke checks, Phase 6 docs and ADRs 0009-0010

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 9: Integration, dev-stack check, PR

**Files:** none new; merges `p6-api`, `p6-web`, `p6-infra` into `phase-6` and fixes any integration issue found.

- [ ] **Step 1: Merge the three tracks**

```bash
git checkout phase-6
git merge --no-ff p6-api -m "Merge p6-api"
git merge --no-ff p6-infra -m "Merge p6-infra"
git merge --no-ff p6-web -m "Merge p6-web"
```

Expected: no conflicts (tracks own disjoint files).

- [ ] **Step 2: Every suite**

```bash
POSTGRES_PORT=55432 docker compose -f infra/compose/compose.dev.yaml up -d postgres
(cd apps/api && API_DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@localhost:55432/portfolio \
  sh -c 'uv run alembic upgrade head && uv run alembic check && uv run ruff check . && uv run ruff format --check . && uv run pyright && uv run pytest')
(cd apps/web && pnpm lint && pnpm typecheck && pnpm format && pnpm test && pnpm build)
node --test infra/cloudflare/worker-fallback.test.mjs infra/directus/lib.test.mjs
docker compose -f infra/compose/compose.yaml --env-file infra/compose/prod.env.example config -q
shellcheck infra/backup/*.sh scripts/*.sh infra/vm/bootstrap.sh
bash infra/backup/test-roundtrip.sh
docker build -t p6-api apps/api && docker build --build-arg NEXT_PUBLIC_APP_VERSION=ci -t p6-web apps/web && docker build -t p6-backup infra/backup
```

Plus the promtool and provisioning-parse commands Task 5 added to `ci.yml` (run them exactly as the workflow does). Expected: all green. Record test counts.

- [ ] **Step 3: Dev stack end to end**

```bash
POSTGRES_PORT=55432 make up
make migrate
docker compose -f infra/compose/compose.dev.yaml --profile monitoring up -d prometheus blackbox-exporter
```

Verify, recording each result:
1. `curl -s localhost:8000/metrics | grep -c '^http_requests_total'` is > 0 after loading `http://localhost:3000` once; `curl -s -o /dev/null -w '%{http_code}' localhost:8000/metrics -H 'CF-Connecting-IP: 1.2.3.4'` prints `404`.
2. After ~2 minutes: `curl -s 'localhost:9090/api/v1/query?query=probe_success' ` (use the port the monitoring profile exposes; if Task 5 exposes none in dev, use `docker compose … exec prometheus wget -qO- …`) shows `job="site"` with value `1`, and `up{job="api"}` is `1`.
3. Point the dev API at it if needed (`API_PROMETHEUS_URL=http://prometheus:9090` is the default inside the dev network) and `curl -s localhost:8000/v1/status | python3 -m json.tool` shows `status: "operational"`, 30 `daily` entries with the last one non-null and earlier ones null (no history yet), `p95_ms` an integer or null, `requests_today` ≥ 0, `last_backup_at: null`. Response has `Cache-Control: public, max-age=60`.
4. Stop Prometheus (`docker compose -f infra/compose/compose.dev.yaml --profile monitoring stop prometheus`), wait 61 s: `/v1/status` returns `degraded` with null stats. `http://localhost:3000` shows the degraded card with `—` values; restart Prometheus, wait 61 s, reload: operational card with today's bar green.
5. Homepage hero order is name, intro, buttons, social links, card; at 400px wide the card is full width; light and dark themes both readable.
6. With `UMAMI_WEBSITE_ID` unset, the page source has no `/stats/script.js`. Then run `UMAMI_WEBSITE_ID=00000000-0000-0000-0000-000000000000 pnpm --dir apps/web dev` against the dev stack: the script tag is present (the request to `/stats/script.js` fails in dev since there is no umami service; that is expected and must not break the page).

- [ ] **Step 4: Final whole-branch review, fixes, PR**

Run the final review (controller), apply fixes in one pass, re-run Step 2, then:

```bash
git push -u origin phase-6
gh pr create --base main --head phase-6 --title "Phase 6: Monitoring, analytics, and backups" --body-file <body>
```

The PR body summarizes the feature, lists the new prod secrets and GitHub `backup-verify` environment secrets (names only), and states in bold that **Chris's secrets PR must merge before this one** (compose requires the new keys). It ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Wait for CI green; do not merge until Chris says so.

---

### Task 10: Chris's setup, deploy, and checks

Done by Chris with step-by-step guidance; no code. Never paste secret values into chat. Order matters: steps 1–3 happen **before** the code PR merges.

- [ ] **Step 1: Cloudflare and Better Stack (follow `docs/setup.md` from the PR branch)**
  - R2: create the bucket, enable a 30-day bucket lock rule, add a lifecycle rule deleting objects after 31 days, create a write token (Object Read & Write, this bucket only) and a read token (Object Read only, this bucket only).
  - `age-keygen -o backup.key` on the laptop: the private key goes into the password manager and the GitHub environment `backup-verify` secret `BACKUP_AGE_KEY`, then `backup.key` is deleted from disk; the printed public key is `BACKUP_AGE_RECIPIENT`.
  - Better Stack heartbeat: daily, 2 h grace; its URL is `BACKUP_HEARTBEAT_URL`.
  - Tunnel public hostnames `grafana.christopherguzman.me → http://grafana:3000` and `analytics.christopherguzman.me → http://umami:3000`, each with a Cloudflare Access app using the same policy as `cms.`.
  - GitHub: create environment `backup-verify` with `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_READ_ACCESS_KEY_ID`, `R2_READ_SECRET_ACCESS_KEY`, `BACKUP_AGE_KEY`.
- [ ] **Step 2: Secrets PR (before the code PR).** `openssl rand -hex 32` for `UMAMI_APP_SECRET` and a strong `GRAFANA_ADMIN_PASSWORD` (also saved in the password manager); `make secrets-edit` to add `GRAFANA_ADMIN_PASSWORD`, `UMAMI_APP_SECRET`, `BACKUP_AGE_RECIPIENT`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `BACKUP_HEARTBEAT_URL` (leave `UMAMI_WEBSITE_ID` out for now); commit on a branch, PR, merge (deploys unchanged code).
- [ ] **Step 3: Merge the code PR** (Chris says so). The first release pushes the new `backup` GHCR package as private, so its deploy stops at `compose pull` before touching the VM: Chris sets the package to public (GitHub → Packages → backup → Package settings → Change visibility), then `gh run rerun <run-id> --failed`. Confirm the deploy: smoke passes including `/v1/status` and the public `/metrics` 404; `docker ps` shows the seven new containers; `free -h` on the VM shows swap after Step 6.
- [ ] **Step 4: First backup and restore proof.** On the VM: `make backup-now`; the R2 bucket shows today's object; Better Stack heartbeat turns Up; then `gh workflow run backup-verify.yml` and wait for green.
- [ ] **Step 5: Grafana and alerts.** Open `grafana.christopherguzman.me` (Access, then the admin password); both dashboards show data; Alerting → Contact points → Test sends an email that arrives.
- [ ] **Step 6: Swapfile.** On the VM: `cd /opt/portfolio && sudo ./infra/vm/bootstrap.sh`; `swapon --show` lists `/swapfile` 2G.
- [ ] **Step 7: Umami.** Open `analytics.christopherguzman.me`, log in with `admin` / `umami`, change the password immediately (save it in the password manager), add website `christopherguzman.me`, copy its website ID; `make secrets-edit` to add `UMAMI_WEBSITE_ID`, commit, push (deploy). Visit the site with an ad blocker on; the visit and a `resume-download` event show up in Umami.
- [ ] **Step 8: Status card live.** The homepage card shows operational, today's bar, p95, requests, and the last backup time.
