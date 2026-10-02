# 0007 — In-process rate limits and background jobs

Status: accepted · 2026-10-02

## Context
The API runs as one container. Phase 4 needs per-IP rate limits on the contact endpoint and two periodic jobs: contact email retries and the GitHub activity refresh.

## Decision
An in-memory sliding-window limiter and asyncio tasks started in the FastAPI lifespan. No Redis, Celery or cron container.

## Consequences
- Limits reset when the API restarts. That is acceptable: Turnstile and the Cloudflare edge rule still apply.
- Running two API replicas would double the limits and run each job twice. Scaling out needs Redis (or Postgres advisory locks) first.
- Job failures are logged and retried at the next interval.
