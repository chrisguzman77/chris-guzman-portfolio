# 0001 — Single repository for web, api, and infra

Status: accepted · 2026-09-16

## Context
The site is three deployables (Next.js, FastAPI, Directus config) plus Compose/CI that change together. It is maintained by one person and reviewed by recruiters who will open exactly one repo.

## Decision
One repository: `apps/web`, `apps/api`, `infra/`, `docs/`. Each app keeps its own toolchain (pnpm, uv) and Dockerfile; there is no cross-app build orchestration (no Turborepo/Nx).

## Consequences
- One PR can change an API contract and its consumer atomically.
- CI uses path filters so an API change does not rebuild the web app.
- Versioning is by git SHA; images are tagged with the commit that built them.
