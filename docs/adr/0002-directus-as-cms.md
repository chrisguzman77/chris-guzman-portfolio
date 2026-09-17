# 0002 — Directus as the self-hosted content system of record

Status: accepted · 2026-09-16

## Context
Posts, projects, experience, and the resume file need an editing UI. Options: MDX in the repo, a hosted CMS (Sanity), or a self-hosted CMS (Directus, Payload, Strapi).

## Decision
Directus, self-hosted in the same Compose stack, on its own database inside the shared Postgres instance. Content is read by `web` and `api` over the Docker network using read-only static tokens. Schema snapshot, roles/policies, and flows are committed under `infra/directus/` and applied idempotently on deploy.

## Consequences
- No vendor account; content lives with the rest of the system and is covered by the same backups.
- Directus is never publicly exposed except its admin UI behind Cloudflare Access; asset URLs are rewritten to a `web` proxy route.
- A schema change is a PR (snapshot diff), not a click in production.
