# Phase 6: Monitoring, analytics, and backups

Approved by Chris in brainstorming on 2026-10-03. Supersedes the Phase 6 section of `2026-09-16-portfolio-design.md` where they differ.

## Goal

Keep the site's data safe off-site, know when something breaks, see whether people visit, and show a real, honest status card on the homepage.

## Scope

In:

- Nightly encrypted backups to Cloudflare R2 with a deletion lock, a Better Stack heartbeat, and a weekly automated restore check.
- Prometheus + Grafana with node-exporter, cAdvisor, and blackbox-exporter; API metrics; provisioned dashboards; email alerts.
- A public status card on the homepage fed by a new `GET /v1/status` API endpoint.
- Umami analytics proxied through the site, with five custom events.
- A 2 GB swapfile on the VM.

Out (decided in brainstorming):

- Loki/Alloy (log search). `docker logs` stays the log tool.
- Uptime Kuma. Better Stack already monitors from outside.
- Directus and cloudflared metrics.
- A public Grafana dashboard. Grafana stays private.
- Raising the VM above 4 GiB. Measured use is 1.1 GiB with 2.8 GiB available; the new stack adds roughly 0.7–1 GB.

## Decisions

| Area | Decision |
|---|---|
| Monitoring stack | Prometheus, Grafana, node-exporter, cAdvisor, blackbox-exporter. No Loki. |
| Alerts | Grafana unified alerting, email through Resend SMTP using the existing `RESEND_API_KEY`, sent to `CONTACT_TO`. |
| Status card | Public, always open, on the homepage below the CTA and social-link rows. Data from `GET /v1/status` (API queries Prometheus). |
| Analytics | Umami, own `umami` database (already created by `01-init.sh`), tracker and collect proxied at `/stats/*`. Events: resume download, chat open, chat question, contact sent, outbound click. |
| Backup scope | `pg_dumpall --globals-only`, `pg_dump -Fc` of `directus`, `portfolio`, `umami`, and a tar of the `directus-uploads` volume. Prometheus and Grafana data are not backed up. |
| Backup encryption | A dedicated age key pair. The VM holds only the public key (`BACKUP_AGE_RECIPIENT`); the private key lives in Chris's password manager and the GitHub secret `BACKUP_AGE_KEY`. Never the SOPS VM key. |
| Backup storage | R2 bucket, bucket lock 30 days, lifecycle delete after 31 days. VM token: Object Read & Write on that bucket only. GitHub token: Object Read only. |
| Backup proof | Better Stack heartbeat on every success; weekly GitHub Actions restore check; runbook restore procedure. |
| Memory | Every new service has a `mem_limit`; a 2 GB swapfile is the safety net. |

## Services

All new services join the existing compose network, use the shared `x-service` anchor (restart policy and log rotation), publish no host ports, and have pinned image tags.

| Service | Image | `mem_limit` | Notes |
|---|---|---|---|
| `prometheus` | `prom/prometheus` | 320m | `--storage.tsdb.retention.time=35d`, `--storage.tsdb.retention.size=2GB`, scrape interval 30 s, volume `prometheus-data` |
| `grafana` | `grafana/grafana-oss` | 192m | provisioned datasource, dashboards, alert rules, contact point; volume `grafana-data`; anonymous access off; admin password from `GRAFANA_ADMIN_PASSWORD`; `GF_SERVER_ROOT_URL=https://grafana.christopherguzman.me` |
| `node-exporter` | `prom/node-exporter` | 64m | host `/proc`, `/sys`, `/` mounted read-only; textfile collector reads volume `node-textfile` |
| `cadvisor` | `gcr.io/cadvisor/cadvisor` | 128m | `--docker_only=true`, `--housekeeping_interval=30s`, reduced metric set |
| `blackbox-exporter` | `prom/blackbox-exporter` | 32m | one `http_2xx` module |
| `umami` | `ghcr.io/umami-software/umami` (Postgres build) | 256m | `DATABASE_URL` to the `umami` DB with `UMAMI_DB_PASSWORD`; `APP_SECRET` from `UMAMI_APP_SECRET` |
| `backup` | `ghcr.io/chrisguzman77/chris-guzman-portfolio/backup:${IMAGE_TAG}` | 256m | built in CI like web/api; Trivy-scanned |

`scripts/deploy.sh` adds the new services to its default `SERVICES` list (its `--remove-orphans` would otherwise never start them). `release.yml` builds, scans, and pushes the `backup` image.

Tunnel public hostnames (configured by Chris in the Cloudflare dashboard, since the tunnel is remotely managed): `grafana.christopherguzman.me → http://grafana:3000` and `analytics.christopherguzman.me → http://umami:3000`, each behind a Cloudflare Access app with the same one-time-PIN policy as `cms.`.

## Metrics

### Scrape targets (`infra/observability/prometheus/prometheus.yml`)

| Job | Target |
|---|---|
| `api` | `api:8000/metrics` |
| `node` | `node-exporter:9100` |
| `cadvisor` | `cadvisor:8080` |
| `site` | blackbox `http_2xx` probe of `https://christopherguzman.me/api/healthz`, every 30 s |
| `prometheus` | itself |

The `site` probe goes out to the internet and back through Cloudflare and the tunnel, so it fails when visitors would see a failure (home internet down, tunnel down, fallback Worker serving 503).

### API metrics

The API exposes `GET /metrics` (Prometheus text format, `prometheus-client`).

- It returns 404 when a `CF-Connecting-IP` header is present, the same rule `/internal/*` uses, so it is unreachable through the tunnel. No secret is needed: only containers on the compose network can reach it without that header.
- Request metrics, recorded by middleware: `http_requests_total{method, route, status}` and `http_request_duration_seconds{method, route}` histogram. `route` is the matched route template (for example `/v1/chat/sessions/{session_id}/messages`), never the raw path. Unmatched paths use `route="unmatched"`. `/metrics` and `/health` are excluded.
- Feature metrics:
  - `chat_questions_total{outcome}`: the outcome values the chat service already returns.
  - `chat_tokens_total{kind="input"|"output"}`
  - `chat_budget_used_ratio`: gauge, today's tokens divided by the daily budget, updated whenever usage is recorded and on startup.
  - `contact_submissions_total{result="sent"|"failed"}`
  - `resume_downloads_total`
  - `rag_sync_runs_total{result="ok"|"error"}`
- Counters reset when the API restarts; every query uses `increase()`/`rate()`, which handles resets.

### Backup metric

After a successful run, the backup writes `backup_last_success_timestamp_seconds` and `backup_last_size_bytes` to `node-textfile/backup.prom` (write to a temp file, then rename). node-exporter exposes it.

## Public status

### `GET /v1/status`

Always returns 200 with this shape. It is cached in process for 60 s and sends `Cache-Control: public, max-age=60`.

```json
{
  "status": "operational",
  "uptime_30d": 0.9998,
  "daily": [{ "date": "2026-09-04", "uptime": 1.0 }, "... 30 entries, oldest first, last is today"],
  "p95_ms": 84,
  "requests_today": 1204,
  "last_backup_at": "2026-10-03T07:31:12Z"
}
```

- `status` is `"operational"` only when Prometheus answered, the database check passes, and the latest `site` probe succeeded. Otherwise it is `"degraded"`.
- If Prometheus is unreachable or a query fails (2 s timeout), every metric field is `null` and `daily` entries have `uptime: null`. The API never serves a stale cached value as fresh past the 60 s memo.
- `daily`: 30 days (America/New_York calendar days, same boundary as `requests_today`) ending today. A day's uptime is successful probes divided by expected probes (`seconds covered / 30`), so time with no samples (VM or Prometheus down) counts as downtime. Days entirely before the first recorded probe are `null`. Today counts only the elapsed part of the day.
- `uptime_30d`: the same calculation over the whole window, starting at the first recorded probe if that is later.
- `p95_ms`: 95th percentile of `http_request_duration_seconds` over the last 24 h, all routes except `/v1/chat/*` (model latency would swamp it), rounded to whole ms.
- `requests_today`: `increase(http_requests_total[…])` since 00:00 America/New_York, rounded.
- `last_backup_at`: from `backup_last_success_timestamp_seconds`, ISO 8601 UTC.
- The PromQL is fixed in code. Nothing from the request reaches Prometheus.
- Rate limit: the existing per-IP limiter, 60/min.

### Status card (web)

Replaces the hero's current one-line `LiveStatus`.

- Hero order: name, intro, Download resume + Get in touch, GitHub + LinkedIn, then the card.
- Card (mono, `--card` background, `--border` border, max width about 380px; full width on phones):
  - Header: dot + `all systems operational · self-hosted on Proxmox`, or amber dot + `degraded · self-hosted on Proxmox`.
  - `uptime (30d)` value, then 30 bars (green at 99.5% or more for the day, amber below, muted grey for `null`), with `30 days ago` / `today` labels. Each bar has a `title`/accessible label like `Oct 3: 99.97%`.
  - Rows: `api response (p95)`, `requests today`, `last backup` (`3h ago · encrypted · R2`), `stack` (`Proxmox · Docker · Cloudflare Tunnel`).
  - Any `null` value shows `—`.
- Data: a server component reads `${API_INTERNAL_URL}/v1/status` with a 60 s in-process memo, the same pattern as today's `LiveStatus`. It streams inside Suspense with a skeleton card (`checking status`, no claims). If the API is unreachable, it renders the degraded card with every value `—`.
- The old `LiveStatus` health check is removed. The card covers it.

## Analytics

- Umami runs at `analytics.christopherguzman.me` behind Access.
- `next.config.ts` rewrites `/stats/script.js` to `http://umami:3000/script.js` and `/stats/api/send` to `http://umami:3000/api/send`. The tracker loads from `/stats/script.js` with `data-host-url="/stats"`, so ad blockers that block third-party analytics domains do not block it.
- The script tag renders only when `UMAMI_WEBSITE_ID` (runtime env) is set. Without it the site loads no tracking code.
- Cookieless; Umami does not store IP addresses. No consent banner is needed.
- Custom events (no personal data, never chat question text):

| Event | When | Data |
|---|---|---|
| `resume-download` | click on any resume download link | `{ from: <pathname> }` |
| `chat-open` | the terminal opens (pill or ⌘K) | none |
| `chat-question` | a question is sent | none |
| `contact-sent` | the contact API returned success | none |
| `outbound-click` | click on an external link | `{ to: "github" \| "linkedin" \| "repo" \| "live" \| "other" }` |

- Events go through a `track(name, data?)` helper that does nothing when `window.umami` is absent. Declarative events use `data-umami-event` attributes where possible.

## Alerts

Provisioned under `infra/observability/grafana/provisioning/`. One contact point: email to `CONTACT_TO`, SMTP `smtp.resend.com:465`, user `resend`, password `RESEND_API_KEY`, from `Portfolio alerts <alerts@christopherguzman.me>`.

| Alert | Condition | For |
|---|---|---|
| Disk filling | root filesystem used > 80% | 10m |
| Memory tight | VM memory used > 90% | 10m |
| Site down | `probe_success{job="site"} == 0` | 5m |
| API errors | 5xx share of API requests > 5% (and at least 20 requests in the window) | 10m |
| Container down | any scrape target has `up == 0`, or `time() - container_last_seen{name=~"portfolio-(postgres|directus|api|web|cloudflared|umami)-1"} > 60` | 5m |
| Backup stale | `time() - backup_last_success_timestamp_seconds > 36h`, or the metric is absent | 15m |
| Chat budget | `chat_budget_used_ratio > 0.8` | 0m |

Better Stack keeps watching `/api/healthz` independently, and its heartbeat catches a dead VM, which Grafana cannot report.

## Dashboards

Two provisioned dashboards stored as JSON in `infra/observability/grafana/dashboards/`:

- **Portfolio overview**: site up/down and uptime, API request rate, error rate, p95/p99 latency by route, chat questions by outcome, tokens vs. budget, contact sends, resume downloads, last backup age.
- **Host & containers**: VM CPU, memory, swap, disk, network; per-container CPU and memory against limits.

## Backups

### Backup container (`infra/backup/`)

- Alpine image with `postgresql17-client`, `age`, `rclone`, `tar`, `curl`, and `supercronic`. Runs as non-root. Schedule `30 3 * * *` with `TZ=America/New_York`.
- Env: `POSTGRES_PASSWORD`, `BACKUP_AGE_RECIPIENT`, `R2_*`, `BACKUP_HEARTBEAT_URL`.
- `backup.sh` (`set -euo pipefail`), run by cron or manually (`make backup-now` on the VM):
  1. Work in a temp dir; clean up on exit.
  2. `pg_dumpall --globals-only`, then `pg_dump -Fc` for `directus`, `portfolio`, `umami` (as the `postgres` superuser over the network).
  3. Tar the `directus-uploads` volume (mounted read-only).
  4. Write `manifest.json`: timestamp, image tag, file names, sizes, and sha256 of each file.
  5. Tar everything into one stream, `age -r "$BACKUP_AGE_RECIPIENT"`, upload with `rclone rcat` to `r2:${R2_BUCKET}/backups/YYYY/MM/DD/portfolio-YYYYMMDDTHHMMSSZ.tar.age`. No plaintext file touches the disk outside the temp dir.
  6. On success: write the textfile metric and `curl` the `BACKUP_HEARTBEAT_URL`. On failure: `curl` `${BACKUP_HEARTBEAT_URL}/fail` and exit non-zero.
- rclone is configured from env (`RCLONE_CONFIG_R2_*`): S3 provider Cloudflare, endpoint `https://<account>.r2.cloudflarestorage.com`, `no_check_bucket = true`.

### Weekly restore check (`.github/workflows/backup-verify.yml`)

- Schedule Sunday 09:00 UTC, plus `workflow_dispatch`. GitHub-hosted runner, `environment: backup-verify` holding `R2_READ_ACCESS_KEY_ID`, `R2_READ_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `BACKUP_AGE_KEY`.
- Steps: find the newest object, fail if it is older than 36 h; download; decrypt; verify the manifest checksums; start `pgvector/pgvector:0.8.6-pg17` as a service; restore globals and the three dumps; run `infra/backup/verify.sql`, which asserts the `projects`, `experience`, `profile`, and `directus_collections` tables have rows and that `alembic_version` exists in `portfolio`; check the uploads tar lists at least one file.
- It never prints decrypted content. The decryption key is written to a temp file with `0600` permissions and removed at the end.
- The restore steps live in `infra/backup/restore.sh`. The workflow and the runbook's disaster procedure both use it.

### CI

- `ci.yml` infra job: shellcheck `infra/backup/*.sh`, hadolint the backup Dockerfile, and a backup round-trip test. It runs `backup.sh` against a throwaway Postgres with a throwaway age key and a local rclone remote (`RCLONE_CONFIG_R2_TYPE=local`), then `restore.sh` and `verify.sql` against seeded fixture rows.
- `promtool check config` and `promtool check rules` (the Prometheus image) on the Prometheus config. Grafana provisioning YAML is validated by a parse step.

## VM

`infra/vm/bootstrap.sh` creates `/swapfile` (2 GB, `0600`, `vm.swappiness=10`) if absent and adds it to `/etc/fstab`. Re-running stays safe.

## New secrets (in `prod.enc.env` and `prod.env.example`)

`GRAFANA_ADMIN_PASSWORD`, `UMAMI_APP_SECRET`, `UMAMI_WEBSITE_ID`, `BACKUP_AGE_RECIPIENT`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `BACKUP_HEARTBEAT_URL`.

`UMAMI_WEBSITE_ID` is optional (`:-`). Analytics stays off until it is set, since it only exists after Umami's first login. Every other new key is required in compose (`:?`), and `prod.env.example` gains them, which `secrets-check.sh` reads. Chris's secrets PR therefore merges **before** the code PR: the current compose file ignores keys it does not use, so the secrets land harmlessly, and the code PR's deploy finds them.

GitHub `backup-verify` environment secrets: `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_READ_ACCESS_KEY_ID`, `R2_READ_SECRET_ACCESS_KEY`, `BACKUP_AGE_KEY`.

## Error handling summary

| Failure | Behaviour |
|---|---|
| Prometheus down | `/v1/status` returns `degraded` with `null` stats; the card shows `—`; Grafana shows no data; Better Stack still watches the site. |
| API down | The card renders degraded with `—` (web side); Site down and Container down alerts fire. |
| Umami down | The `/stats/*` rewrites fail silently in the browser; the page is unaffected. |
| Backup fails | Non-zero exit, the heartbeat `/fail` ping emails Chris, and the Backup stale alert fires after 36 h. |
| R2 unreachable | Same as a backup failure; nothing is retried in-run, and the next night tries again. |
| Weekly check fails | The workflow goes red; GitHub emails Chris. |
| Memory pressure | Swap absorbs spikes; the Memory tight alert fires; per-container caps keep one service from starving the rest. |

## Testing

- **API (pytest):**
  - `/metrics` returns 404 with `CF-Connecting-IP` and 200 without it.
  - Route-template labels; `/health` and `/metrics` excluded.
  - Feature counters increment.
  - `/v1/status` against a fake Prometheus client: operational, degraded on Prometheus error, missing-sample days counted as downtime, days before the first probe returned as `null`, p95 rounding, the America/New_York day boundary for `requests_today`, and the 60 s cache.
- **Web (vitest):**
  - Status card: operational, degraded, all-`null`, skeleton, bar colours and labels.
  - The tracker renders only with `UMAMI_WEBSITE_ID` set.
  - `track` is a no-op without `window.umami`.
  - Each of the five events fires from its component.
- **Infra (CI):** promtool, shellcheck, hadolint, the backup round-trip, compose config validation against `prod.env.example`.
- **Smoke (`scripts/smoke.sh`):** `GET /v1/status` returns 200 JSON, and `/metrics` through the public API hostname returns 404.

## Rollout and Chris's setup

1. The code PR is opened and reviewed but not merged.
2. Chris (guided), before the code PR merges:
   - R2: bucket, 30-day bucket lock, 31-day lifecycle rule, write token for the VM and read token for GitHub.
   - `age-keygen` on the laptop; private key to the password manager and the `BACKUP_AGE_KEY` GitHub secret; public key to `BACKUP_AGE_RECIPIENT`.
   - Better Stack heartbeat (daily, 2 h grace).
   - Tunnel hostnames and Access apps for `grafana.` and `analytics.`.
   - `make secrets-edit` for the new keys, commit, push (a deploy of unchanged code).
3. The code PR merges and deploys. Then `make secrets-check` on the new example, and: run `make backup-now` on the VM, run the `backup-verify` workflow manually, and check that the alert contact point delivers a test email.
4. Log in to Umami (behind Access) and change the default `admin`/`umami` password immediately, add the website, then put `UMAMI_WEBSITE_ID` in secrets (one more secrets push).
5. Re-run `bootstrap.sh` on the VM for the swapfile.

## Docs

- ADR 0009: monitoring without Loki, and the status card fed through the API.
- ADR 0010: backup encryption with a separate key, plus R2 bucket lock.
- `docs/runbook.md`: restore after disaster, run a backup now, silence an alert, where the dashboards are.
- `docs/setup.md`: the R2, age, heartbeat, Access, and Umami steps.
- `docs/architecture.md`: the new services.
