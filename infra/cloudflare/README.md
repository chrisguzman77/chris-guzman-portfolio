# Cloudflare configuration

Everything in Cloudflare is configured in the dashboard; this file is the record of it.

## Tunnel `portfolio` (Zero Trust → Networks → Tunnels)

| Public hostname | Service |
|---|---|
| `christopherguzman.me` | `http://web:3000` |
| `www.christopherguzman.me` | `http://web:3000` |
| `api.christopherguzman.me` | `http://api:8000` |
| `cms.christopherguzman.me` | `http://directus:8055` |
| anything else | `http_status:404` |

Service names resolve on the Compose network because `cloudflared` runs in the same stack. The tunnel token lives only in `infra/compose/prod.enc.env` as `CLOUDFLARE_TUNNEL_TOKEN`.

## Access

Application `Directus admin` protects `cms.christopherguzman.me`. Policy `Chris only`: Allow, include Emails = owner's address. Login method: One-time PIN only, instant authentication on.

## Deploy the fallback Worker

1. Workers & Pages → Create → Create Worker → name `portfolio-fallback` → Deploy.
2. Edit code → replace everything with `worker-fallback.mjs` from this directory → Deploy.
3. Worker → Settings → Domains & Routes → Add → Route: `christopherguzman.me/*` (zone christopherguzman.me). Add a second route `www.christopherguzman.me/*`.
4. Check: stop the web container on the VM (`docker compose -f infra/compose/compose.yaml stop web`), load the site, see "Back shortly" with HTTP 503; start it again.

`api.` and `cms.` are deliberately not routed through the Worker: API clients should see real status codes, and the CMS is behind Access.

## Static asset caching

No cache rule is needed. Cloudflare caches `.js`/`.css` by default, and Next.js serves `/_next/static/*` with `cache-control: public, max-age=31536000, immutable`, so the edge keeps them for a year (verified 2026-10-01: `cf-cache-status: HIT`). Re-check with `curl -sI https://christopherguzman.me/_next/static/<any file> | grep -i cf-cache-status`. Add a rule only if a future asset type isn't cached by default.

## External uptime monitor

Better Stack (free tier) checks `https://christopherguzman.me/api/healthz` every 3 minutes and emails the owner. It runs outside the home network, so it reports VM, home-internet, and tunnel outages; the fallback Worker returns 503, which the monitor counts as down.

## Worker routes

Domain → Workers Routes: `christopherguzman.me/*` and `www.christopherguzman.me/*` → `portfolio-fallback`. Verified 2026-10-01: www 301 → apex, and with `web` stopped the apex returns 503 "Back shortly" with `retry-after: 300` and `cache-control: no-store` while `api.` keeps returning 200.
