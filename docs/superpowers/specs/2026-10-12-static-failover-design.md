# Static failover

Decisions made by Chris on 2026-10-12. Roadmap item 2 (after the CI performance budget).

## Problem

The whole site runs on one VM in Chris's home. When the VM, the home internet or the tunnel is down, the `portfolio-fallback` Worker (`infra/cloudflare/worker-fallback.mjs`) answers every page with a 503 "Back shortly". A recruiter who visits during an outage sees nothing about Chris. The post "How I built this site" names this as the biggest gap.

## Decisions

| Area | Decision |
|---|---|
| Storage | A new private R2 bucket, `portfolio-snapshot`, bound to the existing `portfolio-fallback` Worker as `SNAPSHOT`. |
| Freshness | Refresh after every successful release (code changes) and nightly (content published in Directus). |
| Outage view | Every public page, read-only, with a banner. Features that need the API are hidden. |
| Runner | A GitHub Actions workflow crawls the live public site and uploads to R2. It works whether or not the VM is up, and if the VM is down the previous snapshot stays. |

## Design

### Snapshot job (`.github/workflows/snapshot.yml`)

**Triggers:**
- `workflow_run` of `release` on `main`, when it completes successfully;
- `schedule` nightly at 08:15 UTC (04:15 Eastern, after the 03:30 backup);
- `workflow_dispatch`.

`concurrency: snapshot` with no cancel, so two runs never upload at once.

**Steps:**
1. Run `node scripts/snapshot/crawl.mjs`, a dependency-free Node 24 ESM script with no npm installs.
   - **Pages:** starts from `https://christopherguzman.me/sitemap.xml` and fetches every listed page.
   - **Assets:** collects everything each page references: `src`, `href` for stylesheets/icons/manifest/preload, `srcset`, `<object data>`, CSS `url(...)` in fetched stylesheets, and `/_next/static/**` chunks referenced by scripts already fetched.
   - **Static extras:** also fetches `/rss.xml` (or `/blog/rss.xml`), `/robots.txt`, `/sitemap.xml`, `/icon.svg` and the OG images linked from page meta tags.
   - **Scope:** only same-origin URLs are kept. External scripts (Turnstile) aren't copied.
   - **Output:** writes to `snapshot/<path>` locally. A **manifest** maps each key (pathname plus search string, so `/_next/image?url=…&w=…` keeps its query) to `{ file, status, contentType, csp }`, where `csp` is the response's `Content-Security-Policy`.
2. **Safety checks (abort without uploading):**
   - Any page that isn't 200.
   - Any response carrying `x-served-from: snapshot`, which means the site is already in failover. The crawl must never copy a copy.
   - The homepage missing `Christopher Guzman`.
   - Fewer than 10 pages.
3. **Upload.** Run `aws s3 cp --recursive` to `s3://portfolio-snapshot/snapshots/<run-id>/` using the R2 S3 endpoint. The AWS CLI is preinstalled on ubuntu-latest.
4. **Switch.** Write `current.json` with `{ prefix: "snapshots/<run-id>/", createdAt, commit, pages }`.
5. **Prune.** Delete snapshot prefixes older than the newest 3.
6. **Summary.** Write a step summary: pages, assets, total bytes, prefix.

The pointer is written last, so a half-finished upload is never served.

**Secrets** (GitHub repository secrets that Chris sets; never in chat):
- `R2_SNAPSHOT_ACCESS_KEY_ID` and `R2_SNAPSHOT_SECRET_ACCESS_KEY`, from an R2 API token with Object Read & Write scoped to `portfolio-snapshot` only;
- `CLOUDFLARE_ACCOUNT_ID`, as a repository variable.

### Worker (`infra/cloudflare/worker-fallback.mjs`)

**Unchanged:** www→apex redirect, passing every request to the origin, and the `ORIGIN_DOWN` set.

**When the origin is down:**
1. Normalize the request:
   - HTML navigations use the pathname, with a trailing `/` stripped except for `/`.
   - Other requests use pathname plus search.
2. Read `current.json` from `SNAPSHOT`, cached in module scope for 60 s, and look up `<prefix><manifest-key>`. The manifest is stored as `<prefix>manifest.json` and cached the same way.
3. **Found:** serve the object with its stored content type.
   - **HTML:**
     - Set `Content-Security-Policy` to the CSP captured at crawl time. It names the nonce baked into that HTML.
     - Add `x-served-from: snapshot`, `cache-control: no-store` and `x-robots-tag: noindex`.
     - Use `HTMLRewriter` to:
       - insert a banner as the first child of `<body>`: "This is a backup copy of the site while my server is offline. Chat and the contact form are paused; email me at <the profile email, read from the page's mailto link or a constant>";
       - remove every element with `data-live-feature`.
   - **Static assets:** keep their immutable caching.
   - **Status:** 200 for found objects.
4. **Not found** (including `/api/*`, RSC requests with `_rsc` and `/stats/*`): return the existing 503 "Back shortly".

`/api/healthz` is deliberately never in the snapshot, so the external uptime monitor still reports the outage.

**Client-side navigation during failover:** Next's RSC fetches get a 503, and Next falls back to a full page load, which the snapshot serves. This is checked manually in the outage drill below. Prefetching RSC payloads isn't attempted, because their keys vary per router state.

### Web app (small change)

Add `data-live-feature` to the root element of each feature that needs the API, so the Worker can hide it in failover:
- the chat launcher;
- the contact form section;
- the newsletter subscribe form;
- the status card (a live "all systems up" card would be misleading during an outage).

The GitHub activity heatmap stays: it is server-rendered, so the copy shows accurate data as of the snapshot.

### Tests

- **`crawl.mjs`:** URL extraction (src, srcset, object data, CSS url(), manifest keys with query strings, same-origin filter) as pure functions, unit-tested with `node --test` (`scripts/snapshot/crawl.test.mjs`). The safety checks are tested with fixture responses.
- **Worker:** extend `infra/cloudflare/worker-fallback.test.mjs` with a fake `SNAPSHOT` binding (an in-memory get), covering:
  - origin up → passthrough;
  - origin 530 and HTML found → 200 with banner, CSP and `x-served-from`, and no `data-live-feature` elements;
  - asset found → served with its content type;
  - not found → 503 "Back shortly";
  - `/api/healthz` → 503;
  - a missing `current.json` → 503.

  `HTMLRewriter` isn't available in Node, so wrap the rewrite in a function that is skipped (test the banner insertion separately as string logic), or use a small polyfill limited to tests. Pick the simpler option and document it.
- **CI:** the existing `node --test` line in `ci.yml` gains `scripts/snapshot/crawl.test.mjs`.
- **Web:** a unit test that each live feature renders `data-live-feature`.

### Docs

- `infra/cloudflare/README.md`: create the bucket, the R2 token (scoped) and the GitHub secrets; add the `SNAPSHOT` binding to the Worker; paste the updated Worker code; run the snapshot workflow once; then do the outage drill.
- **Outage drill:**
  1. Stop `web` and `api` on the VM.
  2. Load `/`, a project, a post and `/resume`. Expect the banner and no chat.
  3. Click links between pages.
  4. Confirm `/api/healthz` returns 503 and Better Stack alerts.
  5. Start the services again.
- `docs/runbook.md`: a short "Static failover" section.
- `docs/architecture.md`: one paragraph and an ADR, `docs/adr/0011-static-failover.md`.

## Out of scope

- Failover for `api.` and `cms.`.
- Live features during an outage.
- Moving the Worker deploy to CI. It stays a dashboard paste, as today.

## Chris's setup steps (after merge)

1. Create the R2 bucket `portfolio-snapshot`.
2. Create an R2 API token scoped to it, with Object Read & Write.
3. Add the two GitHub secrets and the account ID variable (`gh secret set …`).
4. In the Worker's settings, add the R2 binding `SNAPSHOT` → `portfolio-snapshot`, and paste the new Worker code.
5. Run the snapshot workflow once, then do the outage drill.

## Verification

- Unit tests pass.
- The first workflow run uploads a snapshot with every sitemap page.
- In the outage drill, pages, images, the resume PDF and navigation work with the banner, while `/api/healthz` stays 503 and the monitor alerts.
- After the services restart, the live site is back with no banner.
