# 0011 — Static failover: a crawled snapshot in R2, served by the existing Worker

Status: accepted · 2026-10-12

## Context
The whole site runs on one VM on a home Proxmox host behind a home internet connection. When either is down, visitors only saw a "Back shortly" page, which is honest but shows nothing of the portfolio, and a recruiter who clicks during an outage sees nothing. The pages are dynamic (server-rendered with a per-request nonce CSP), so there is no ready-made static copy to host.

## Decision
- A GitHub Actions workflow (`snapshot.yml`) crawls the live public site from outside the home network and uploads the result to the R2 bucket `portfolio-snapshot` under `snapshots/<run id>/`. A pointer object, `current.json`, is written last, so a half-finished upload is never served. It runs after each successful release, nightly at 08:15 UTC, and on demand. It keeps the newest 3 snapshots.
- The existing `portfolio-fallback` Worker reads the snapshot through an R2 binding named `SNAPSHOT` when the origin is unreachable. With no binding, or for a URL not in the snapshot, it still returns the old 503 "Back shortly" page.
- The Worker hides the live features (chat launcher, contact form, newsletter form, status card, marked `data-live-feature`) with an injected style and appends a sticky bottom banner before `</body>`. It deletes nothing. The GitHub heatmap stays.
- `/api/`, `/stats/`, `/newsletter/`, `/admin` and `_rsc` requests are refused by the Worker itself, so `/api/healthz` stays 503 during failover and Better Stack keeps alerting.
- A failed crawl fails the job and nothing is published, so the previous snapshot stays live.

## Alternatives considered
- **Cloudflare Pages:** a second deployment target to keep in sync with a site that is not a static export.
- **Always Online / the Wayback Machine:** depends on the Internet Archive crawling the site and is unreliable.
- **A second VM:** costs money and adds a second thing to patch, for a portfolio.
- **Next.js static export:** not possible, because the pages are dynamic and the CSP uses a per-request nonce.
- **Deleting or prepending DOM in the Worker:** removing live-feature elements or inserting the banner as the first child of `<body>` made React hydration fail (error #418). Hiding with CSS and appending at the end hydrates cleanly.

## Consequences
- The snapshot is as old as the last run: up to a day for content edited in Directus.
- RSC client navigation requests (`_rsc`) are refused, so Next falls back to full page loads between pages during failover.
- The Worker cannot tell a healthy origin from a snapshot to monitoring, because it refuses `/api/healthz`; this is deliberate.
- Cloudflare bot protection can block the GitHub runner's crawl. The workflow then fails visibly instead of publishing a bad snapshot; the fix is a WAF skip rule (see `infra/cloudflare/README.md`).
- The Worker deploy is still manual (paste into the dashboard), as is the R2 setup.
- R2 storage for 3 small snapshots is far inside the free tier.
