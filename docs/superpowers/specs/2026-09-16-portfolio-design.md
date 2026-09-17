# Portfolio Website — Design Spec

_Approved 2026-09-16. Source of truth for architecture and phasing; each phase gets its own implementation plan in `docs/superpowers/plans/`._


## Context

Chris (Augusta University, B.S. CS + B.S. Cyber Operations, Math minor, graduating May 2027; GitHub `chrisguzman77`) wants a recruiter-facing portfolio: experience, education, projects, blog, contact, downloadable resume. It must also demonstrate deliberate engineering across UI, frontend, backend, object design, system design, infrastructure, and CI/CD, for full-stack, backend, frontend, and ML/data roles.

Chris has already shipped the ACM@AU site (SvelteKit + FastAPI/Postgres, Docker, Alembic, Cloudflare Tunnel on Oracle Cloud, 600+ tests, ruff/pyright). This site reuses those conventions and differentiates with: a RAG chat grounded in his content, a real observability stack, a documented security posture, and a self-hosted Proxmox deployment pipeline.

The repo is empty (LICENSE + README). Everything is greenfield.

## Decisions (made by Chris)

| Area | Decision |
|---|---|
| Architecture | Next.js frontend + separate FastAPI service + Directus headless CMS |
| Hosting | Self-hosted: one Ubuntu VM on Proxmox running Docker Compose |
| Exposure | Cloudflare Tunnel; Cloudflare Access gates admin hostnames |
| API | Python 3.12, FastAPI, uv, Pydantic v2, SQLAlchemy 2, Alembic, ruff, pyright |
| CMS | Directus, self-hosted, same Postgres instance |
| Resume | PDF uploaded to Directus; API streams it and counts downloads |
| Extras | "Ask about Chris" RAG chat on **Claude Sonnet 5**; Prometheus/Grafana/Loki; Umami; live GitHub activity |
| Visual style | Clean editorial, light + dark |
| Pages | `/`, `/experience`, `/education`, `/projects`, `/projects/[slug]`, `/blog`, `/blog/[slug]`, `/contact`, `/resume` |
| Chat UI | Floating widget on every page |
| Domain | Placeholder `example.com`; single config point (`SITE_DOMAIN`) to change |
| Assumed missing | Domain, VM, runner, email account, Cloudflare/Anthropic/GitHub tokens — setup steps included |

## Decisions I made (each becomes an ADR in Phase 1)

- **No Caddy/Traefik.** `cloudflared` ingress rules route hostnames to containers.
- **Directus is never public** except its admin UI behind Cloudflare Access. Next.js reads it over the Docker network with a read-only static token. Assets are served through a Next.js route `/cms-assets/[id]` (immutable cache) and `next/image` pointed at the internal host; markdown bodies get `/assets/` rewritten to `/cms-assets/`.
- **No CMS fetch at build time.** CI has no route to Directus. Content routes use `revalidate = 3600`, `generateStaticParams` returns `[]`, all fetches carry cache tags, and a Directus Flow webhook hits `POST /api/revalidate` with a shared secret to `revalidateTag`. Nightly full revalidation as a backstop.
- **Secrets**: SOPS + age. Encrypted env files committed; the VM age key (`/etc/portfolio/age.key`, 0400) is the only secret on the box. Pre-commit blocks plaintext `.env`.
- **No Redis.** Single API instance; in-process token-bucket rate limiting keyed by `CF-Connecting-IP` plus one Cloudflare rate-limit rule at the edge.
- **Embeddings run locally** via `fastembed` (`BAAI/bge-small-en-v1.5`, 384 dims, ONNX on CPU, baked into the API image). pgvector HNSW index. No second AI vendor.
- **Deploys** run on an ephemeral, repo-scoped GitHub Actions self-hosted runner inside the VM (no inbound ports). Repo setting "require approval for all outside collaborators"; deploy job only on `push` to `main`.
- **Hero photo** lives in the repo at `apps/web/public/images/chris.jpg` (copied from `~/Downloads/IMG_7832.JPG`, 788×1107, cropped to 4:5 to remove the top-right crop artifact, served via `next/image` as AVIF/WebP). Kept as-is with the studio backdrop in a rounded frame with a soft border. Alternative if wanted later: background-removed cutout.
- **Resume file**: `~/Desktop/Resumes/CHRISTOPHER_GUZMAN_RESUME.pdf` copied to `infra/directus/seed/resume.pdf` and uploaded by the seed script. **Flag for Chris:** the PDF shows a phone number; consider a web version without it, since the site is public and the file is linked from the resume page.
- **Monorepo**, this repo.

## System overview

```
Internet ──> Cloudflare (DNS, WAF, rate limits, cache rules, Access, Turnstile, fallback Worker)
                │  Tunnel (outbound-only from VM)
                ▼
  Proxmox VM (Ubuntu 24.04, 4 vCPU / 8 GB / 60 GB, Docker Compose, one internal network)
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ cloudflared ─┬─> web (Next.js :3000)     ── reads ──> directus (:8055)  │
  │              ├─> api (FastAPI :8000)     ── reads ──> directus          │
  │              ├─> cms.*      → directus admin   (Access)                 │
  │              ├─> grafana.*  → grafana          (Access)                 │
  │              ├─> status.*   → uptime-kuma      (Access)                 │
  │              └─> analytics.*→ umami dashboard  (Access)                 │
  │ postgres 16 + pgvector — DBs: directus | portfolio | umami (own roles)  │
  │ prometheus, loki, alloy, node-exporter, cadvisor, grafana, uptime-kuma  │
  │ umami, backup (pg_dump + uploads → age → rclone → R2), gh-runner        │
  └─────────────────────────────────────────────────────────────────────────┘
```

Boundaries:
- **web**: presentation. Server components read Directus; browser calls `api.<domain>` directly for interactions (SSE needs this). Umami collect proxied through Next.js rewrites at `/stats/*`.
- **api**: interactions + intelligence. Owns the `portfolio` DB. Contact, views/reactions, resume download, GitHub cache, RAG chat, internal reindex.
- **directus**: content system of record. Schema snapshot + roles/policies/flows committed and applied idempotently on deploy.

Resilience for home-hosting outages: Cloudflare cache rules for static assets and the resume; a tiny Cloudflare Worker on the web hostname that returns a branded "back shortly" page on 52x/530; an **external** uptime monitor (Better Stack free tier) on `/api/healthz`, since Uptime Kuma inside the VM can't report the VM being down.

## Repo layout

```
.github/workflows/   ci-web, ci-api, ci-infra (path-filtered PR checks); release (build → trivy → deploy); backup-verify (weekly)
.github/             dependabot.yml, CODEOWNERS, PR template
apps/web/            Next.js 15, React 19, TS strict, Tailwind v4, shadcn/ui, next-themes, vitest, playwright
  src/app/           layout, page, (site)/{experience,education,projects,blog,contact,resume}, api/{revalidate,healthz}, cms-assets/[id]
  src/components/    ui/ layout/ content/ interactive/ chat/
  src/lib/           directus/{client,queries,schema}, api/client, markdown, cache-tags, env (zod)
apps/api/            FastAPI (uv), src/portfolio_api/{main,config,db,models,schemas,routers,services,middleware,observability,cli}, alembic/, tests/
infra/compose/       compose.yaml (prod), compose.dev.yaml, .env.sops, env.example
infra/cloudflared/   config.yml ingress
infra/postgres/init/ 01-init.sh (3 DBs, 3 roles, pgvector only in portfolio)
infra/directus/      snapshot.yaml, access.json (roles/policies/permissions), flows.json, seed.sh, seed/resume.pdf
infra/observability/ prometheus/, grafana/provisioning + dashboards/, loki/, alloy/
infra/backup/        Dockerfile, backup.sh, crontab
infra/runner/        Dockerfile, entrypoint.sh (ephemeral runner)
infra/vm/            cloud-init.yaml, bootstrap.sh, README.md (Proxmox steps)
infra/cloudflare/    worker-fallback.js, cache-rules.md, access-apps.md
docs/                architecture.md, setup.md, runbook.md, security.md, content-model.md, adr/000N-*.md
scripts/             gen-directus-types.ts, smoke.sh
Makefile, .sops.yaml, .pre-commit-config.yaml, .editorconfig
```

## Data model

### Directus collections
| Collection | Fields |
|---|---|
| `profile` (singleton) | name, headline, bio_md, location, email_public, social_links JSON, seo_description, available_for_work |
| `experience` | status, sort, company, role, location, employment_type, start_date, end_date?, summary_md, highlights JSON[], tech M2M skills, company_url, logo |
| `education` | status, sort, institution, degree, field, start_date, end_date, highlights JSON[], logo |
| `projects` | status, sort, featured, slug, title, tagline, body_md, cover, gallery, repo_url, live_url, year, category enum(fullstack/backend/frontend/ml-data/infra/security), tech M2M skills |
| `posts` | status, slug, title, excerpt, body_md, cover, published_at, reading_time_min, tags M2M, canonical_url |
| `tags`, `skills` | slug/name; name/category/icon/sort |
| `resume` (singleton) | file (PDF), version_label, summary_md (for RAG) |
| `site_settings` (singleton) | chat_enabled, chat_suggested_questions JSON[], contact_intro_md, footer_text |

Roles: `web-reader` and `api-reader` (read published + files), each with a static token in SOPS.

Seed content from the resume: education (Augusta University, May 2027, ACM@AU Lead Developer, Delta Chi officer); experience (AU College of Allied Health Professions SWE intern; SteelGate AI/ML intern; Jubilee Farms full-stack contract; ACM@AU Lead Developer; SIEGE CyberOps GRC intern); projects (OFFRes/OFFPay, Cyber Threat Lakehouse, ACM@AU platform, this portfolio); skills as listed on the resume.

`profile.social_links` seed: LinkedIn `https://www.linkedin.com/in/christopher-emmanuel-guzman/`, GitHub `https://github.com/chrisguzman77`. These render in the hero CTAs, the site footer, the contact page, and the JSON-LD `sameAs` array. GitHub username `chrisguzman77` is also the source for the live activity section.

### API tables (`portfolio` DB)
| Table | Purpose |
|---|---|
| `contact_submissions` | persisted before email send; `email_status` enum + retry counters |
| `post_stats`, `post_view_events` | counters + daily dedupe on sha256(ip+ua+daily salt) |
| `post_reactions` | (slug, kind, visitor_hash) unique, toggleable |
| `resume_downloads` | event log |
| `github_activity_cache` | key → jsonb payload, fetched_at, etag |
| `rag_documents`, `rag_chunks` | source_type/source_id/content_hash; chunks with `vector(384)`, `embedding_model`, generated `tsvector`; HNSW + GIN indexes |
| `chat_sessions`, `chat_messages`, `chat_usage_daily` | sessions IP-bound, turn cap, token usage per day for the budget gate |

API object design: routers (HTTP) → services (use cases) → repositories (SQLAlchemy) and clients (Directus, GitHub, Resend, Turnstile, Anthropic) behind `Protocol`s injected via `Depends`, so tests substitute fakes. Pydantic schemas separate from ORM models. Settings via pydantic-settings.

### RAG design
- Each Directus item → canonical markdown via a template with a stable title header; resume PDF → `pypdf` text.
- Chunk on headings, then paragraphs to ≤350 tokens with 50 overlap, chunk prefixed with document title; `content_hash = sha256(model + text)` makes reindex idempotent.
- Retrieval: cosine top-20 ∪ full-text top-20 → reciprocal rank fusion → top 6, max 3 per document → citations `{title,url}`.
- Chat call: `AsyncAnthropic().messages.stream(model="claude-sonnet-5", max_tokens=1024, output_config={"effort": "low"}, system=[grounded persona + rules, cache_control ephemeral], messages=last 6 turns + question)`. Check `stop_reason == "refusal"` and emit a friendly error. Record `usage` into `chat_usage_daily`.
- Abuse limits: Turnstile to open a session, 500-char input cap, 10 turns/session, 5 msg/min and 40/day per IP, hard global daily token budget (503 when exhausted), Cloudflare rate-limit rule on `/v1/chat/*`, cache bypass on that path, SSE heartbeat every 15s.
- Triggers: Directus Flow → `POST /internal/reindex` (secret header, debounced), nightly full, `portfolio-api reindex` CLI.

## API contract (base `https://api.<domain>`)

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{status, version, db}` |
| GET | `/metrics` | Prometheus; internal network only (not in tunnel ingress) |
| POST | `/v1/contact` | `{name,email,message,turnstile_token,website(honeypot)}` → 202; 5/min, 20/day |
| POST | `/v1/posts/{slug}/view` | dedupe daily; returns `{views}` |
| GET | `/v1/posts/{slug}/stats` · GET `/v1/posts/stats?slugs=` | views + reactions (+ `mine`) |
| POST | `/v1/posts/{slug}/reactions` | `{kind}` toggle |
| GET | `/v1/resume` | streams PDF from Directus with `Content-Disposition`, counts download |
| GET | `/v1/resume/stats` | `{downloads, version_label, updated_at}` |
| GET | `/v1/github/activity` | contributions calendar + recent activity; `max-age=300`; served from cache if GitHub is down |
| POST | `/v1/chat/sessions` | Turnstile → `{session_id, suggested_questions}` |
| POST | `/v1/chat/sessions/{id}/messages` | SSE events: `sources`, `delta`*, `done` / `error` |
| POST | `/internal/reindex`, `/internal/github/refresh` | `X-Internal-Secret`; reachable only on the Docker network |

Errors: `{error: {code, message}}`, `X-Request-ID` echoed, 429 carries `Retry-After`. CORS allowlist = web origin.

Next.js routes: `POST /api/revalidate` (`X-Revalidate-Secret`, `{collection, keys}` → tags), `GET /cms-assets/[id]`, `GET /api/healthz`, rewrites `/stats/*` → Umami.

## Frontend design notes

- Typography: serif display (e.g. Fraunces or Instrument Serif via `next/font`) over a sans body (Inter/Geist), one accent color, generous whitespace, 65ch prose measure, `prefers-reduced-motion` respected.
- Home: hero (name, headline, photo, CTAs: Resume / Contact, icon links to GitHub and LinkedIn), featured projects, latest posts, GitHub activity heatmap, "Ask about Chris" prompt. GitHub and LinkedIn links repeat in the footer and on `/contact`, opening in a new tab with `rel="noopener"`.
- `/experience` and `/education`: timelines; `/projects` filterable by category; `/blog` with tags; `/resume` embeds the PDF and offers download; `/contact` form + social links (no phone number on the site).
- SEO: per-page metadata, `sitemap.ts`, `robots.ts`, generated OG images, JSON-LD Person, RSS feed.
- Security headers via `next.config.ts` `headers()`: CSP (`script-src 'self' challenges.cloudflare.com`, `connect-src 'self' api.<domain>`), HSTS, nosniff. `/.well-known/security.txt`.

## CI/CD

Billing note (confirmed 2026-09-16): the repo is public, so GitHub-hosted runner minutes are free and unlimited and do not draw from Chris's monthly cap; the deploy job runs on the self-hosted runner, which is never billed. If the repo is ever made private, move PR CI to the self-hosted runner.

- **PR**: `ci-web` (pnpm lint, tsc, vitest, `next build` with no network, Playwright smoke against the built app with mocked API), `ci-api` (ruff, pyright, pytest against a pgvector service container, `alembic check`), `ci-infra` (compose config, hadolint, shellcheck, promtool check, sops dry-run). Path-filtered, concurrency cancel-in-progress. Branch protection requires them.
- **main**: `release.yml` builds `web`, `api`, `backup` images → GHCR (`sha` + `latest`) → Trivy (fail on CRITICAL) → `deploy` job on the self-hosted runner: `sops -d` → `docker compose pull` → one-shot `alembic upgrade head` → `directus seed.sh` → `up -d --remove-orphans` → `scripts/smoke.sh` → prune. Rollback: `IMAGE_TAG=<prev sha> docker compose up -d`.
- **Weekly** `backup-verify.yml`: restore the latest R2 dump into a throwaway Postgres and assert row counts.
- Dependabot for npm, pip, docker, actions.

## Phases

Each phase ends with `main` green and deployable. Each phase gets its own detailed implementation plan via `superpowers:writing-plans` before coding; TDD per the user's CLAUDE.md.

### Phase 1 — Foundation, skeleton, CI
1. Write `docs/superpowers/specs/2026-09-16-portfolio-design.md` from this plan; commit.
2. Scaffold `apps/web` (App Router, TS strict, Tailwind v4, shadcn, next-themes, base layout, `/api/healthz`). Add hero photo to `public/images/`.
3. Scaffold `apps/api` (uv, FastAPI app factory, pydantic-settings, structlog JSON, `/health`, Alembic init, pytest smoke test, ruff + pyright config).
4. Dockerfiles (multi-stage, non-root, `output: standalone`), `.dockerignore`s.
5. `compose.dev.yaml` with postgres (pgvector) + `01-init.sh`, directus, web, api; `Makefile` (`up`, `down`, `logs`, `migrate`, `snapshot`, `seed`).
6. Hygiene: `.editorconfig`, pre-commit (ruff, prettier, sops guard), dependabot, CODEOWNERS, PR template.
7. `ci-web`, `ci-api`, `ci-infra`; `release.yml` with build + Trivy and deploy stubbed `if: false`.
8. SOPS/age laptop key, `.sops.yaml`, encrypted `.env.sops` placeholder.
9. `docs/architecture.md`, ADRs 0001–0005, `docs/setup.md` skeleton; branch protection on `main`.

Verify: `make up` then healthz/health return 200; a PR touching only `apps/api` runs only `ci-api`; merge to main pushes `web:<sha>` and `api:<sha>` to GHCR with Trivy green; committing a plaintext `.env` is blocked.

### Phase 2 — Infra to production hello-world
1. Buy domain (Cloudflare Registrar), zone on Cloudflare, Always Use HTTPS. Set `SITE_DOMAIN`.
2. Proxmox VM (Ubuntu 24.04 cloud-init, 4 vCPU/8 GB/60 GB); `bootstrap.sh`: Docker, ufw (SSH from LAN only), unattended-upgrades, clone repo, VM age key.
3. Cloudflare Tunnel + `cloudflared/config.yml` ingress (apex/www → web, api. → api, cms. → directus, later grafana./status./analytics.); Access apps (one-time PIN to Chris's email) for admin hosts.
4. Prod `compose.yaml`: postgres, directus, web, api, cloudflared, runner; healthchecks, `restart: unless-stopped`, log rotation, resource limits.
5. Ephemeral runner container; repo setting "require approval for all outside collaborators"; enable the deploy job.
6. Cloudflare Worker fallback page, cache rules, external uptime monitor.
7. Fill `docs/setup.md` and `docs/runbook.md` (deploy, rollback, rotate age key).

Verify: site and API reachable over HTTPS; `cms.` prompts Access then shows Directus; push to main deploys and smoke passes; stopping `web` serves the fallback page; VM reboot recovers all services; runner re-registers after each job.

### Phase 3 — CMS schema + content pages
1. Model collections in dev Directus; create reader roles + static tokens; export `snapshot.yaml`, `access.json`, `flows.json`; write idempotent `seed.sh` (also uploads `seed/resume.pdf` and seeds resume-derived content for dev).
2. `scripts/gen-directus-types.ts` → typed client; `lib/directus/queries.ts` with tags.
3. Pages: home, experience, education, projects list/detail, blog list/detail/tag, resume, contact (static parts).
4. Markdown pipeline (remark-gfm, rehype-pretty-code/shiki, asset URL rewrite); `/cms-assets/[id]`.
5. `/api/revalidate` + Directus Flows per collection (published only) + nightly full.
6. SEO: metadata, sitemap, robots, OG images, JSON-LD, RSS.
7. Deploy runs `seed.sh`; populate real content in prod; upload resume.

Verify: fresh DB + `seed.sh` renders the whole site with no manual CMS clicks; editing a published post updates the page within seconds, a draft does not; markdown images load from `/cms-assets/` with immutable caching while `cms.<domain>/assets/` is 403 without Access; `next build` succeeds in CI with no Directus; Lighthouse ≥95 on home and a post in both themes.

### Phase 4 — API interactions
1. Migrations for contact, post stats/events/reactions, resume downloads, GitHub cache.
2. Rate-limit middleware (trust `CF-Connecting-IP` only via tunnel); Turnstile client; Resend client with persist-then-send and background retry.
3. Contact, posts, resume, GitHub routers + services; lifespan task refreshes GitHub hourly.
4. Web: ContactForm, ViewCounter, Reactions, ResumeButton, GithubActivity heatmap (all degrade gracefully when the API is down).
5. Setup: Resend account + DKIM/SPF in Cloudflare DNS; Turnstile site; GitHub PAT (`read:user`); Cloudflare rate-limit rule on `api.<domain>/v1/*`.
6. pytest per router with fakes; vitest for form validation.

Verify: contact submit stores a row and delivers email; bad Turnstile → 400; 6th/min → 429; with Resend key revoked the row persists as `failed` and retries later; a post viewed twice counts once; resume downloads increment; GitHub heatmap renders and survives a revoked PAT from cache.

### Phase 5 — AI chat
1. Migrations for `rag_*`, `chat_*`; pgvector HNSW + GIN.
2. Indexer (Directus → canonical markdown → chunk → hash → fastembed → upsert; model baked into the image); `/internal/reindex`; CLI; Directus Flow; nightly.
3. Hybrid retriever with RRF; `tests/rag/golden.yaml` (15 questions → expected source) asserting hit@6 ≥ 0.9.
4. Chat service on Sonnet 5 (streaming, effort low, cached system prompt, refusal handling, budget gate, usage recording); sessions + messages endpoints with SSE.
5. Web ChatDrawer: `useChatStream` over `fetch` + ReadableStream (POST, not EventSource), suggested questions, citation chips, "AI can be wrong" note.
6. ADR 0006 (RAG design); Anthropic key into SOPS.

Verify: reindex twice → second run re-embeds 0 chunks; editing a project makes a new fact answerable within a minute; `curl -N` streams through Cloudflare unbuffered; golden retrieval test passes; 11th turn → 400, IP limit → 429, budget 0 → 503; API RSS stays under 1 GB after 50 chats.

### Phase 6 — Observability, analytics, backups
1. Compose: prometheus (15d/5GB), loki (14d), alloy (Docker logs), node-exporter, cadvisor (`--docker_only`), grafana, uptime-kuma, umami, backup; resource limits everywhere.
2. Scrapes: api `/metrics`, node, cadvisor, directus `/server/metrics`.
3. Grafana provisioning: datasources, dashboards (API, containers, node, logs), alert rules (disk >80%, API 5xx rate, backup age >36h, chat budget 80%) → email via Resend SMTP or Discord.
4. Umami on shared Postgres, `/stats/*` rewrites, dashboard behind Access.
5. Uptime Kuma at `status.<domain>` (Access) plus the external monitor's alerting.
6. Backup container: nightly `pg_dump` per DB + globals + uploads tar → age → rclone → R2 (30-day lifecycle); `backup-verify.yml`; tested restore in runbook.

Verify: Grafana shows API p95 and container CPU; Loki returns API error lines; filling disk to 85% alerts within 5 minutes; R2 holds dated encrypted objects and the verify job is green; a manual restore into dev renders the site; Umami records a view with an ad blocker on; idle VM RAM under 5 GB.

### Phase 7 — Polish and launch
1. Visual pass (type scale, spacing, motion, 404, loading skeletons, print stylesheet for resume).
2. Accessibility audit (axe, keyboard, focus, contrast both themes).
3. Performance (fonts, image sizes, bundle analyzer, cache rules); Playwright e2e for the full visitor journey.
4. Security pass: CSP tightened, dependency audit, Access policies reviewed, secret rotation exercised once, `docs/security.md` with a short threat model.
5. Content: 2–3 posts (including "How I built this site"), project write-ups with architecture images.
6. README: architecture diagram, CI/uptime badges, "how it works" tour linking ADRs.
7. Launch checklist: OG debuggers, Search Console sitemap, Umami goals (resume, chat, contact). Tag `v1.0.0`.

Verify: Lighthouse ≥95 all categories on 5 key pages both themes mobile+desktop; axe 0 serious issues; fresh-browser walkthrough of every feature; `docs/setup.md` reproduces the dev environment on a second machine in under 15 minutes.

## Ideas deferred (not in scope unless Chris asks)
Generated PDF resume from CMS data; k3s migration; static-export failover on Cloudflare Pages; `/uses` and `/now` pages; newsletter.

## Critical files
- `infra/compose/compose.yaml` — every service, network boundary, and volume.
- `.github/workflows/release.yml` — build, scan, deploy, runner gating.
- `infra/directus/seed.sh` — schema + roles + flows; what makes a fresh restore work.
- `apps/web/src/lib/directus/queries.ts` with `src/app/api/revalidate/route.ts` — tagged reads and revalidation.
- `apps/api/src/portfolio_api/services/rag/indexer.py` — the ML showcase.
