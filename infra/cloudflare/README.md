# Cloudflare configuration

Everything in Cloudflare is configured in the dashboard; this file is the record of it.

## Tunnel `portfolio` (Zero Trust → Networks → Tunnels)

| Public hostname | Service |
|---|---|
| `christopherguzman.me` | `http://web:3000` |
| `www.christopherguzman.me` | `http://web:3000` |
| `api.christopherguzman.me` | `http://api:8000` |
| `cms.christopherguzman.me` | `http://directus:8055` |
| `grafana.christopherguzman.me` | `http://grafana:3000` |
| `analytics.christopherguzman.me` | `http://umami:3000` |
| anything else | `http_status:404` |

Service names resolve on the Compose network because `cloudflared` runs in the same stack. The tunnel token lives only in `infra/compose/prod.enc.env` as `CLOUDFLARE_TUNNEL_TOKEN`.

## Access

Application `Directus admin` protects `cms.christopherguzman.me`. Policy `Chris only`: Allow, include Emails = owner's address. Login method: One-time PIN only, instant authentication on.

Application `Admin` protects the path `christopherguzman.me/admin` (the admin home with links to every tool, and the subscriber page) with the same `Chris only` policy and one-time-PIN login as `cms.`. The web app re-checks the Access JWT (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`) and answers 404 without it.

Applications `Grafana` (`grafana.christopherguzman.me`) and `Umami` (`analytics.christopherguzman.me`) use the same `Chris only` policy and one-time-PIN login. Both apps also have their own login behind Access.

## Deploy the fallback Worker

1. Workers & Pages → Create → Create Worker → name `portfolio-fallback` → Deploy.
2. Edit code → replace everything with `worker-fallback.mjs` from this directory → Deploy.
3. Worker → Settings → Domains & Routes → Add → Route: `christopherguzman.me/*` (zone christopherguzman.me). Add a second route `www.christopherguzman.me/*`.
4. Check: stop the web container on the VM (`docker compose -f infra/compose/compose.yaml stop web`), load the site, see "Back shortly" with HTTP 503; start it again.

`api.` and `cms.` are deliberately not routed through the Worker: API clients should see real status codes, and the CMS is behind Access.

## Static asset caching

No cache rule is needed. Cloudflare caches `.js`/`.css` by default, and Next.js serves `/_next/static/*` with `cache-control: public, max-age=31536000, immutable`, so the edge keeps them for a year (verified 2026-10-01: `cf-cache-status: HIT`). Re-check with `curl -sI https://christopherguzman.me/_next/static/<any file> | grep -i cf-cache-status`. Add a rule only if a future asset type isn't cached by default.

CMS images are the exception: `/cms-assets/<id>` has no file extension, so Cloudflare treats it as dynamic. Add a Cache Rule (Caching → Cache Rules): URI Path starts with `/cms-assets/` → Eligible for cache, Edge TTL "Use cache-control header if present, bypass cache if not" (the origin sends `public, max-age=31536000, immutable`). Verify with `curl -sI https://christopherguzman.me/cms-assets/<id> | grep -i cf-cache-status` run twice: the second answer must be `HIT`.

## External uptime monitor

Better Stack (free tier) checks `https://christopherguzman.me/api/healthz` every 3 minutes and emails the owner. It runs outside the home network, so it reports VM, home-internet, and tunnel outages; the fallback Worker returns 503, which the monitor counts as down.

A second Better Stack check, a heartbeat named `portfolio backup` (expected daily, 2 h grace), is pinged by every successful nightly backup and by `<url>/fail` when one fails.

## Worker routes

Domain → Workers Routes: `christopherguzman.me/*` and `www.christopherguzman.me/*` → `portfolio-fallback`. Verified 2026-10-01: www 301 → apex, and with `web` stopped the apex returns 503 "Back shortly" with `retry-after: 300` and `cache-control: no-store` while `api.` keeps returning 200.

## Static failover (R2 snapshot)

When the origin is down, the Worker serves a crawled copy of the public site instead of "Back shortly". `.github/workflows/snapshot.yml` crawls `https://christopherguzman.me` from a GitHub runner and uploads it to R2 as `snapshots/<run id>/`, then writes the pointer `current.json` last. It runs after each successful release, nightly at 08:15 UTC, and on Run workflow. A crawl failure fails the job and publishes nothing; a re-run of a run that is already live is skipped (use Run workflow for a fresh snapshot). The newest 3 snapshots are kept. Without the R2 secrets the workflow still crawls (to validate) and skips the upload. Design: [ADR 0011](../../docs/adr/0011-static-failover.md).

How the Worker behaves during an outage:

- It hides the live features (`data-live-feature`: chat launcher, contact form, newsletter form, status card) with an injected style and appends a bottom-fixed `#snapshot-banner` before `</body>`. It deletes nothing, because deleting or prepending broke React hydration.
- Snapshot responses carry `x-served-from: snapshot` and `cache-control: no-store`. HTML also gets `x-robots-tag: noindex` and its captured CSP.
- It refuses `/api/`, `/stats/`, `/newsletter/`, `/admin` and `_rsc` itself, so `/api/healthz` is always 503 and Better Stack keeps alerting.
- With no `SNAPSHOT` binding, or for anything not in the snapshot, it returns the old 503 "Back shortly" page.
- Its only export is `default`, so it boots under `wrangler dev --local`.
- The snapshot shows content as of the last snapshot (up to a day old for Directus edits). Client-side navigation falls back to full page loads.

### Setup (once)

1. Create the R2 bucket `portfolio-snapshot`.
2. Create an R2 API token with Object Read & Write, scoped to that bucket only. Copy the Access Key ID and Secret.
3. Set the GitHub secrets and variable (each `gh secret set` prompts for the value):
   - `gh secret set R2_SNAPSHOT_ACCESS_KEY_ID`
   - `gh secret set R2_SNAPSHOT_SECRET_ACCESS_KEY`
   - `gh variable set CLOUDFLARE_ACCOUNT_ID --body <account id>`
4. Worker `portfolio-fallback` → Settings → Bindings → Add → R2 bucket: variable `SNAPSHOT`, bucket `portfolio-snapshot`.
5. Paste the current `worker-fallback.mjs` (Edit code) and Deploy.
6. Actions → snapshot → Run workflow, then read the step summary (crawl log and the `Prefix:` line).
7. Run the outage drill below.

Troubleshooting: if the first run's crawl gets 403s, check Cloudflare Security → Events for blocked requests from GitHub runners (bot protection) and allow them, for example with a WAF custom rule with action Skip for requests whose User-Agent contains `portfolio-snapshot`.

### Outage drill

1. On the VM, stop the origin: `docker compose -f infra/compose/compose.yaml stop web api`.
2. `curl -I https://christopherguzman.me/` and a project page: expect 200 with `x-served-from: snapshot`.
3. `curl -I https://christopherguzman.me/api/healthz`: expect 503.
4. In a browser, load `/`, a project, a post and `/resume`. Check the banner at the bottom, that live features are hidden, and that the console has no errors after the page loads. Press ⌘K (there must be no chat), click between pages, and open the resume PDF.
5. Start them again: `docker compose -f infra/compose/compose.yaml start web api`, and confirm the live site returns.

### Roll back

Remove the `SNAPSHOT` binding from the Worker. It then returns the old 503 "Back shortly" page. The workflow can keep running; it only writes to R2.
