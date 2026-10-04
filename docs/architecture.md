# Architecture

Three deployables behind one Cloudflare Tunnel, all on a single Docker Compose host.

```mermaid
flowchart LR
  U[Visitor] --> CF[Cloudflare: DNS, WAF, cache, Access, Turnstile]
  CF -- tunnel --> T[cloudflared]
  subgraph VM [Proxmox VM · Docker Compose]
    T --> W[web · Next.js]
    T --> A[api · FastAPI]
    T -. Access-gated .-> D[directus admin]
    W -- read token --> D
    A -- read token --> D
    A --> P[(postgres + pgvector)]
    D --> P
  end
```

| Component | Responsibility | Talks to |
|---|---|---|
| web | Presentation. Server components read Directus per request through a tag-cached fetch; browser calls the API for interactions. | directus (internal), api (public hostname) |
| api | Interactions and intelligence: contact, views/reactions, resume download, GitHub cache, RAG chat. Owns the `portfolio` DB. | postgres, directus (internal), external APIs |
| directus | Content system of record. Schema, roles, and flows are committed and applied on deploy. | postgres |

Boundaries that matter:
- Directus is never publicly reachable except its admin UI behind Cloudflare Access. Assets are proxied through `web`.
- `web` never fetches the CMS at build time; CI has no route to it.
- Only `api`, `directus` and `umami` hold Postgres credentials, each for its own database. The `backup` container holds the superuser password so it can dump everything.
- Production (`infra/compose/compose.yaml`) publishes no host ports; cloudflared reaches services by name. The VM firewall denies all inbound traffic except SSH from the LAN, on IPv4 and IPv6.
- Deploys run on an ephemeral runner inside the stack and are pinned to commit SHAs ([ADR 0006](adr/0006-runner-in-compose.md)); operations are in the [runbook](runbook.md).

Decisions are recorded in [`adr/`](adr/README.md). Phase-by-phase delivery is in the [design spec](superpowers/specs/2026-09-16-portfolio-design.md).

## Content flow

```mermaid
sequenceDiagram
  participant C as Chris (Directus admin)
  participant D as directus
  participant W as web (Next.js)
  participant V as Visitor
  C->>D: save an item (draft or published)
  D->>W: Flow: POST /api/revalidate {collection} with x-revalidate-secret
  W->>W: revalidateTag(collection, { expire: 0 })
  V->>W: GET /projects/lakehouse
  W->>D: GET /items/projects?filter[status][_eq]=published (read-only token, tagged fetch)
  W-->>V: HTML rendered from validated content
```

- **Per-request rendering, cached data.** Every page that reads Directus calls `connection()`, so `next build` never contacts the CMS (CI has no route to it) and nothing is prerendered empty. Each Directus `fetch` uses `cache: "force-cache"` with `next: { tags: [<collection>, ...], revalidate: 86400 }`, so Directus is hit only after an invalidation or once a day. ISR with `generateStaticParams() => []` was rejected because static pages (`/`, `/experience`, ...) would prerender at build with no CMS and serve empty content until revalidated.
- **Invalidation by collection.** The Flow sends only the collection name (no item IDs or slugs), so the revalidate route invalidates the collection tag; list and detail queries both carry it. The route checks `x-revalidate-secret` in constant time and accepts only known collection names.
- **Validation at the boundary.** Responses are parsed with zod; a malformed list item is skipped and logged, a malformed detail item renders the 404 page.
- **Assets.** `/cms-assets/<id>` streams files from Directus with the read-only token (`Cache-Control: public, max-age=31536000, immutable`) and only for IDs referenced by published content or the resume; `cms.christopherguzman.me` stays behind Cloudflare Access.
- **Schema as code.** `infra/directus/bootstrap.mjs` runs inside the Directus container on every deploy: it creates missing collections and fields (never alters or deletes), the read-only `web-reader` policy and token, the revalidation Flow, and seed items for collections that are still empty.

## Interactions (Phase 4)

```mermaid
flowchart LR
  B[Browser] -- POST /v1/contact --> A[api]
  A -- siteverify --> T[Cloudflare Turnstile]
  A --> P[(postgres)]
  A -. background send .-> R[Resend]
  A -. retry job, every 5 min .-> R
  W[web · home page server] -- GET /v1/github/activity --> A
  A -- cached calendar --> P
  A -. refresh when an hour old, checked every 10 min .-> G[GitHub GraphQL]
```

- **Contact:** the browser posts to `api.christopherguzman.me/v1/contact`. The API applies the rate limit, verifies Turnstile, saves the message in Postgres, then sends the email through Resend in the background. A retry job resends failed or stuck messages.
- **GitHub activity:** the home page server reads `http://api:8000/v1/github/activity`, which serves the calendar cached in Postgres. A job refreshes it from GitHub's GraphQL API when it is an hour old (checked every 10 minutes).
- Rate limits and both jobs run inside the API process ([ADR 0007](adr/0007-in-process-rate-limits-and-jobs.md)).

| Failure | Result |
|---|---|
| API down | Contact form shows the email fallback; heatmap hidden; rest of both pages unaffected |
| Resend down / key revoked | Message saved, retried every 5 min up to 5 attempts |
| Turnstile down | `503`; form shows the email fallback |
| GitHub down / token revoked | Last cached heatmap keeps showing |
| Accounts not set up yet | Form shows "coming soon"; heatmap hidden |

## Chat (Phase 5)

```
publish in Directus ─Flow─> web /api/revalidate
                     └────> api /internal/reindex ─(5 s debounce)─> sync: Directus → markdown → chunks → bge-small → pgvector + tsvector
browser ⌘K ─> terminal ─Turnstile─> POST /v1/chat/sessions
                 └─ question ─> POST /v1/chat/sessions/{id}/messages
                                  → limits, budget → hybrid search (RRF) → cutoff
                                  → Groq gpt-oss-120b (ChatModel) → citation check → JSON answer
```

The API owns the index and chat tables in the `portfolio` database; it reads Directus with its own read-only token. `/internal/*` is reachable only from containers on the VM (secret header, and requests through the Cloudflare Tunnel are refused). See ADR 0008.

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

## Notes

- FastAPI's `/docs` and `/openapi.json` are intentionally public (the API contract is part of the showcase).
- `next build` fetches Geist and JetBrains Mono from Google Fonts at build time, so image builds need network access.
