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

## Cache rule for static assets

Caching → Cache Rules → Create rule `next static`: URI Path starts with `/_next/static/` → Eligible for cache, Edge TTL override 1 year, Browser TTL respect origin. Check with `curl -sI https://christopherguzman.me/_next/static/<any file> | grep -i cf-cache-status` twice; the second shows `HIT`.
