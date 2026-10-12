# Static Failover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During a VM, home-internet or tunnel outage, serve a recent read-only copy of the public site, with a banner, from R2 through the existing `portfolio-fallback` Worker.

**Architecture:**
- **Crawl:** a GitHub Actions workflow crawls the live public site after each successful release and nightly.
- **Storage:** it uploads the pages and assets to a private R2 bucket under a per-run prefix, then flips `current.json`.
- **Serving:** when the origin is down, the Worker looks up the requested key in the current snapshot's manifest and serves it. For HTML it adds the captured CSP, a banner, and removes elements marked `data-live-feature`.

**Tech Stack:**
- Node 24 ESM: no dependencies for the crawler; `node --test` for its tests.
- GitHub Actions and the AWS CLI against the R2 S3 endpoint.
- A Cloudflare Worker with `HTMLRewriter` and an R2 binding.
- Next.js 16 (marker attributes only).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-10-12-static-failover-design.md` is binding.
- **Names:** bucket `portfolio-snapshot`; Worker binding `SNAPSHOT`; pointer object `current.json`; snapshot prefix `snapshots/<GITHUB_RUN_ID>/`; keep the newest 3 prefixes.
- **Secrets and variables:**
  - GitHub secrets: `R2_SNAPSHOT_ACCESS_KEY_ID`, `R2_SNAPSHOT_SECRET_ACCESS_KEY`.
  - GitHub variable: `CLOUDFLARE_ACCOUNT_ID`.
  - The R2 endpoint is `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`.
  - Never print secrets.
- **Origin:** `https://christopherguzman.me`.
- **Failover response headers:**
  - **Snapshot responses:** `x-served-from: snapshot` and `cache-control: no-store`.
  - **HTML only:** also `x-robots-tag: noindex`, with the captured `Content-Security-Policy`.
  - **Assets:** keep their captured `cache-control`, except that `no-store` is forced on HTML.
- **Banner text:** "This is a backup copy of the site while my server is offline. Chat and the contact form are paused; email me at chguzman@augusta.edu."
- **Never in the snapshot:** `/api/*`, `/stats/*`, any URL with `_rsc`, `/admin*` and `/newsletter/*`. The Worker returns the existing 503 "Back shortly" for anything not in the snapshot.
- **Live-feature markers:** `data-live-feature` goes on the chat launcher, the contact-form section, the newsletter subscribe form and the status card. The GitHub heatmap stays.
- **Workflow security:** no new third-party GitHub Actions. Existing actions stay pinned by SHA (`actions/checkout`, `actions/setup-node`, as used in `ci.yml`). Permissions are `contents: read`.
- **Commits:** end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Files:** never create, read or write `.env` files.

## Manifest interface (shared by Tasks 2 and 3)

`<prefix>manifest.json`:

```json
{
  "version": 1,
  "createdAt": "2026-10-12T08:15:00Z",
  "origin": "https://christopherguzman.me",
  "pages": 12,
  "entries": {
    "/": { "file": "files/<sha256 hex of the key>", "type": "text/html; charset=utf-8", "csp": "<captured CSP>", "cacheControl": "<captured>" },
    "/_next/static/chunks/abc.js": { "file": "files/<sha256>", "type": "application/javascript; charset=utf-8", "cacheControl": "public, max-age=31536000, immutable" },
    "/_next/image?url=%2Fimages%2Fchris.jpg&w=640&q=75": { "file": "files/<sha256>", "type": "image/avif", "cacheControl": "..." }
  }
}
```

**Key rules:**
- **Keys:** pathname plus search, exactly as requested (`URL.pathname + URL.search`).
- **HTML pages:** keyed by pathname with no search. A trailing slash is stripped, except for `/`.
- **R2 object names:** `<prefix><entry.file>`.
- **Pointer:** `current.json` is `{ "prefix": "snapshots/<id>/", "createdAt": "...", "commit": "<sha>" }`.

**Worker lookup:**
1. Try `pathname + search`.
2. If that misses and the request's `Accept` includes `text/html`, try the normalized pathname alone, so `?utm_…` still finds the page.
3. Otherwise it's a miss and gets a 503.

---

### Task 1: Live-feature markers (web)

**Files:**
- Modify:
  - `apps/web/src/components/chat/chat-slot.tsx` (the element it renders; if it renders a client component, put the attribute on that component's root);
  - `apps/web/src/app/contact/page.tsx` (the "Send a message" `<section>`);
  - `apps/web/src/components/newsletter/subscribe-form.tsx` (root `<section>`);
  - `apps/web/src/components/content/status-card.tsx` (both the card and the skeleton root).
- Tests: the existing test files next to each component.

- [ ] **Step 1:** Add tests asserting the root has the `data-live-feature` attribute (value `""`) for each component. Assert the heatmap (`github-activity.tsx`) does NOT have it.
- [ ] **Step 2:** Run them and watch them fail. Add the attribute. Watch them pass.
- [ ] **Step 3:** Run `pnpm vitest run`, `tsc --noEmit`, `lint`, `prettier --check .`, `pnpm build`, and `pnpm exec playwright test`. Before e2e, stop stale servers: `pkill -f next-server; pkill -f "e2e/fake-backend.mjs"`. The JS budget must still pass.
- [ ] **Step 4:** Commit `feat(web): mark live features so the failover copy can hide them`.

### Task 2: Snapshot crawler + workflow

**Files:**
- Create:
  - `scripts/snapshot/crawl.mjs`, the CLI: `node scripts/snapshot/crawl.mjs --origin https://christopherguzman.me --out snapshot`;
  - `scripts/snapshot/lib.mjs`, pure functions;
  - `scripts/snapshot/crawl.test.mjs`, the tests;
  - `.github/workflows/snapshot.yml`.
- Modify: `.github/workflows/ci.yml`. Add `scripts/snapshot/crawl.test.mjs` to the existing `node --test infra/cloudflare/worker-fallback.test.mjs infra/directus/lib.test.mjs` line.

**`lib.mjs` (pure, unit-tested):**
- `pageKey(url)`: pathname, with the trailing slash stripped except for `/`.
- `assetKey(url)`: pathname plus search.
- `isSameOrigin(url, origin)`.
- `isExcluded(key)`: `/api/`, `/stats/`, `_rsc`, `/admin`, `/newsletter/`.
- `extractHtmlRefs(html, baseUrl)` returns absolute URLs from:
  - `src`;
  - `href` on `link[rel~=stylesheet|icon|apple-touch-icon|manifest|preload|modulepreload]` and `a` links to same-origin `*.xml`;
  - every `srcset` candidate;
  - `<object data>`;
  - `meta[property=og:image|name=twitter:image] content`.
- `extractCssRefs(css, baseUrl)`: `url(...)`, ignoring `data:`.
- `extractJsChunkRefs(js, origin)`: string literals matching `/_next/static/[\w/.-]+\.(?:js|css)`.
- `fileName(key)`: `files/` plus the sha256 hex of the key.
- `checkSafety(results)` returns a list of problems. It flags:
  - any page with a status other than 200;
  - any response header `x-served-from: snapshot`;
  - a homepage body without `Christopher Guzman`;
  - fewer than 10 pages.

**`crawl.mjs`:**
- **Request settings:** fetch with `User-Agent: portfolio-snapshot (+https://github.com/chrisguzman77/chris-guzman-portfolio)`, `Accept-Encoding: identity`, and, for images, `Accept: image/avif,image/webp,*/*`. Use concurrency 4 and a 15 s timeout per request.
- **Order:**
  1. Fetch `/sitemap.xml` and its `<loc>` pages.
  2. Fetch each page and queue the refs from `extractHtmlRefs`.
  3. Queue `/robots.txt`, `/sitemap.xml`, `/icon.svg`, plus the RSS path linked from `<link rel=alternate type=application/rss+xml>`.
  4. Fetch the assets breadth-first: CSS gets `extractCssRefs`, and JS under `/_next/static/` gets `extractJsChunkRefs`.
  5. Dedupe by key and skip excluded keys.
- **Asset failures:** an asset failing with a non-200 status is skipped and listed in a warning. Only page failures and the safety checks abort.
- **Output:** write the bodies to `<out>/files/<sha256>` and `<out>/manifest.json`, following the Manifest interface above. Print a summary: pages, assets, total bytes, warnings.
- **Exit codes:** exit 1 if `checkSafety` reports problems. Print them, and never write the manifest in that case.

**`snapshot.yml`:**

```yaml
name: snapshot
on:
  workflow_run:
    workflows: [release]
    types: [completed]
    branches: [main]
  schedule:
    - cron: "15 8 * * *"
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: snapshot
  cancel-in-progress: false
jobs:
  snapshot:
    if: github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps: # checkout (pinned SHA as in ci.yml), setup-node 24 (pinned as in ci.yml), then:
      # 1. node scripts/snapshot/crawl.mjs --origin https://christopherguzman.me --out snapshot
      # 2. upload: aws s3 cp snapshot/ "s3://portfolio-snapshot/snapshots/${GITHUB_RUN_ID}/" --recursive --endpoint-url "$R2" --only-show-errors
      # 3. pointer: write current.json {prefix, createdAt, commit: github.sha}; aws s3 cp current.json s3://portfolio-snapshot/current.json
      # 4. prune: list s3://portfolio-snapshot/snapshots/ prefixes, sort numerically, aws s3 rm --recursive all but the newest 3
      # 5. append crawl summary to $GITHUB_STEP_SUMMARY
    # env for aws steps: AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY from secrets.R2_SNAPSHOT_*, AWS_DEFAULT_REGION=auto, R2=https://${{ vars.CLOUDFLARE_ACCOUNT_ID }}.r2.cloudflarestorage.com
```

**Missing setup:** if `R2_SNAPSHOT_ACCESS_KEY_ID` is empty (setup not done yet), the job crawls (still validating) and then skips the upload with a notice instead of failing.

- [ ] **Step 1:** Write `crawl.test.mjs` for every `lib.mjs` function, using real-looking HTML from the site. Cover:
  - srcset with several widths, `/_next/image` query keys, object data with `#toolbar=0` (the fragment must be dropped);
  - CSS `url()` with quotes and `data:`;
  - JS chunk strings;
  - excluded keys;
  - `fileName` being stable;
  - each `checkSafety` problem.
- [ ] **Step 2:** Run them and watch them fail. Implement `lib.mjs`. Watch them pass.
- [ ] **Step 3:** Implement `crawl.mjs`. Run it for real against the live site into a scratch directory, e.g. `node scripts/snapshot/crawl.mjs --origin https://christopherguzman.me --out /tmp/snap-test` or the session scratchpad. Report pages, assets, bytes and warnings. Confirm the manifest has all 12 sitemap pages, `/_next/static` chunks, `/cms-assets` images and the resume PDF.
- [ ] **Step 4:** Write `snapshot.yml`. Validate it with `actionlint` if installed; otherwise run `python3 -c "import yaml,sys;yaml.safe_load(open(sys.argv[1]))" .github/workflows/snapshot.yml` and review it by hand.
- [ ] **Step 5:** Update the ci.yml `node --test` line. Run `node --test scripts/snapshot/crawl.test.mjs infra/cloudflare/worker-fallback.test.mjs infra/directus/lib.test.mjs`.
- [ ] **Step 6:** Commit `feat(snapshot): crawl the public site and publish it to R2 for failover`.

### Task 3: Worker serves the snapshot

**Files:**
- Modify: `infra/cloudflare/worker-fallback.mjs`, `infra/cloudflare/worker-fallback.test.mjs`.

**Behaviour:** see the spec's Worker section and the Manifest interface above. Unchanged: the www redirect, passthrough when the origin answers, and the `ORIGIN_DOWN` set.

**When the origin is down or the fetch throws:**
1. If `env.SNAPSHOT` is missing, return the old 503. This keeps the Worker safe to paste before the binding exists.
2. Read `current.json` and `<prefix>manifest.json`, each cached in module scope for 60 s.
3. Look the request up per the key rules.
4. **Hit:** `env.SNAPSHOT.get(prefix + entry.file)`, then serve it with `content-type`, the headers from Global Constraints, and status 200.
   - **HTML:** pass through `new HTMLRewriter()`:
     - `.on("body", { element(e) { e.prepend(BANNER_HTML, { html: true }); } })`;
     - `.on("[data-live-feature]", { element(e) { e.remove(); } })`.
   - **`BANNER_HTML`:** a small `<div role="status">` with inline styles, a contrast-safe dark-on-amber look, and the email as a `mailto:` link.
5. **Miss, or any R2 error:** the old 503.
6. **Method:** only GET and HEAD use the snapshot; other methods get the 503.

**Testability:** export the pure helpers: `lookupKeys(request)` returns the candidate keys in order, plus `snapshotHeaders(entry, isHtml)`. Tests:
- Stub `globalThis.HTMLRewriter` with a recorder fake whose `.on()` stores handlers and whose `.transform()` returns the response unchanged. Assert that the `body` and `[data-live-feature]` handlers are registered and that they call `prepend` and `remove` on fake elements.
- Stub `fetch` to return 530 or throw.
- Use an in-memory fake `env.SNAPSHOT` (`get(key)` returns `{ body, text(), json() }` or `null`).

**Cases:**
- origin 200 → passthrough;
- 530 and HTML hit → 200, banner and remove handlers, CSP equal to the captured one, `x-served-from`, `no-store`, `noindex`;
- `?utm_source=x` falls back to the page;
- asset hit → content type and captured cache-control;
- `/_next/image?...` exact query key;
- miss → 503 "Back shortly";
- `/api/healthz` → 503;
- no `SNAPSHOT` binding → 503;
- `current.json` missing → 503;
- POST while down → 503;
- fetch throws → snapshot path.

- [ ] **Step 1:** Write the failing tests. Run them: `node --test infra/cloudflare/worker-fallback.test.mjs`.
- [ ] **Step 2:** Implement. Watch the tests pass, and confirm the existing tests still pass.
- [ ] **Step 3:** Commit `feat(cloudflare): fallback Worker serves the R2 snapshot during an outage`.

### Task 4: Docs and ADR

**Files:**
- Modify: `infra/cloudflare/README.md`, `docs/runbook.md`, `docs/architecture.md`.
- Create: `docs/adr/0011-static-failover.md`. Follow the format of the existing ADRs, e.g. 0010.

**Content:**
- **README:** numbered setup.
  1. Create the R2 bucket `portfolio-snapshot`.
  2. Create an R2 API token with Object Read & Write, scoped to that bucket only. Copy the Access Key ID and Secret.
  3. `gh secret set R2_SNAPSHOT_ACCESS_KEY_ID`, `gh secret set R2_SNAPSHOT_SECRET_ACCESS_KEY` (each prompts for the value), and `gh variable set CLOUDFLARE_ACCOUNT_ID --body <id>`.
  4. Worker → Settings → Bindings → Add → R2 bucket, variable `SNAPSHOT`, bucket `portfolio-snapshot`.
  5. Paste the new `worker-fallback.mjs` and Deploy.
  6. Actions → snapshot → Run workflow, and check the step summary.
  7. Do the outage drill: stop `web` and `api`; check `/`, a project, a post, `/resume`, the banner, that there's no chat, and link clicks; check that `curl -sI https://christopherguzman.me/api/healthz` returns 503; then start them again.

  Also cover:
  - what to do if the crawl gets 403 from Cloudflare bot protection: check Security → Events for the runner's requests;
  - how to roll back: remove the binding, which brings back the old 503 page.
- **Runbook:** a short "Static failover" section covering what it does, where the snapshot status is shown (the workflow step summary), how to force a refresh (Run workflow), and the drill link.
- **Architecture:** one paragraph under the resilience notes.
- **ADR 0011:**
  - Context: single home VM.
  - Decision: an R2 snapshot through the existing Worker; refreshed after each release and nightly; crawled from GitHub Actions; banner plus hidden live features; the healthz endpoint is excluded so monitoring stays honest.
  - Alternatives:
    - Cloudflare Pages;
    - Always Online (it depends on the Internet Archive and is unreliable);
    - a second VM (cost);
    - a Next static export (impossible: the pages are dynamic and use a nonce CSP).
  - Consequences: up to a day stale for content; RSC client navigation falls back to full page loads; the Worker deploy is still manual.

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Check that every file, secret and binding name matches the Global Constraints.
- [ ] **Step 3:** Commit `docs: static failover setup, runbook, ADR 0011`.
