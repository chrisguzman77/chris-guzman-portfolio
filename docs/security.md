# Security model

A short threat model for a single-owner portfolio on one VM. It says what is worth protecting, who might attack it, and which controls stand in the way. Nothing here is a claim of perfect security; the accepted trade-offs are listed on purpose.

## Assets

- CMS content and uploads (Directus).
- Contact submissions and chat logs (Postgres, `portfolio` database).
- Secrets: `prod.enc.env`, the age keys, and tokens (Directus, Groq, Resend, GitHub, R2, Cloudflare).
- The VM and the Proxmox host under it.
- Backups in R2.

## Attackers

- Anonymous visitors and bots: scraping, spam, form abuse, probing routes.
- A compromised dependency (npm, PyPI, base images, GitHub Actions).
- A stolen token or password.
- A compromised VM or container.

## Controls

| Threat | Controls |
|---|---|
| Direct attack on the VM | No inbound ports. All traffic enters through a Cloudflare Tunnel ([ADR 0003](adr/0003-cloudflare-tunnel-direct-ingress.md)). Prometheus has no hostname. `/internal/*` on the API refuses tunnel traffic. |
| Admin takeover (Directus, Grafana, Umami) | Cloudflare Access in front of each admin host, then the app's own login. |
| Script injection (XSS) | Nonce-based CSP built per request, `object-src`, `base-uri 'none'`, `frame-ancestors 'none'`. React escapes output. |
| Browser-side leaks and downgrades | HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP on the site. A locked-down CSP and CORP on the API. |
| Form spam and chat abuse | Turnstile on the contact form, in-process rate limits ([ADR 0007](adr/0007-in-process-rate-limits-and-jobs.md)), a daily token budget on chat, an optional Cloudflare rate-limit rule ([setup](setup.md#cloudflare-waf-rules-phase-7)). |
| Forged cache revalidation | `/api/revalidate` needs a secret header, and the public path is blocked at Cloudflare. The Directus Flow calls it over the Docker network. |
| Leaked secrets | Secrets live in the repo only as SOPS/age ciphertext ([ADR 0004](adr/0004-sops-age-secrets.md)). `make secrets-check` rejects placeholders. |
| Stolen token | Least privilege: a read-only Directus token for web and for the API, a public-repos read-only GitHub token, a runner credential scoped to this repo. Rotation steps are in the [runbook](runbook.md#rotate-secrets). |
| Malicious or vulnerable dependency | Dependabot for npm, PyPI, Docker and Actions. Trivy scans images in CI. `pnpm audit` on production dependencies. |
| Compromised CI or runner | Ephemeral self-hosted runner, deploys only from `main`, fork pull requests need approval, default token read-only ([ADR 0005](adr/0005-self-hosted-runner-deploys.md), [ADR 0006](adr/0006-runner-in-compose.md)). |
| Data loss or ransomware | Nightly backups encrypted to a key the VM does not hold, uploaded to R2 with a 30-day object lock ([ADR 0010](adr/0010-backup-encryption-and-bucket-lock.md)). A weekly job restores and verifies the latest one. |
| Silent failure | Grafana alerts by email (on Prometheus metrics), Better Stack heartbeat for backups and uptime, per-container memory limits. |
| Host access | Proxmox root SSH is key-only once the runbook step is applied ([runbook](runbook.md#proxmox-ssh-keys-only)). |

## Accepted trade-offs

- **`style-src 'unsafe-inline'`.** Next.js, Tailwind and some components emit inline styles, and a nonce for styles would break them. Scripts are the real injection risk and they are nonce-only. Styles can leak data only in narrow cases, which the rest of the policy limits (`default-src 'self'`, `connect-src`, `form-action 'self'`).
- **The runner's Docker socket.** The runner can run any container, which makes it root-equivalent on the VM (ADR 0006). It is repo-scoped and ephemeral, and only the owner can push. Runner credentials (the PAT or the GitHub App key) are visible to jobs through the Docker socket (`docker inspect`), the same exposure ADR 0006 accepts.
- **Single-VM availability.** One VM means one failure domain. A fallback Worker serves a "back shortly" page and Better Stack pages me, but there is no failover. Restoring from backup is the recovery plan.
- **Grafana and Umami admin behind Access plus their own logins.** Two layers, but both are managed by one person and one identity provider setup.
- **API docs pages allow jsDelivr scripts and `'unsafe-inline'`.** Swagger UI and ReDoc load from `cdn.jsdelivr.net` and run an inline init script, so `/docs`, `/docs/oauth2-redirect` and `/redoc` get a looser CSP. It is scoped to those three static paths, which take no user input; every other path keeps `default-src 'none'`.
- **Public API docs.** `/docs` and `/openapi.json` are open on purpose; the contract is part of the showcase.

## Headers

### Web CSP

Built per request in `apps/web/src/lib/csp.ts` and applied in `apps/web/src/proxy.ts`. The proxy makes a nonce (16 random bytes, base64), sets it on the request as `x-nonce`, and sets `Content-Security-Policy` on both the request and the response. Directives, in order, joined with `"; "`:

```
default-src 'self'
script-src 'self' 'nonce-{N}' 'strict-dynamic' https://challenges.cloudflare.com
style-src 'self' 'unsafe-inline'
img-src 'self' data: blob:
font-src 'self'
connect-src 'self' {API origin from PUBLIC_API_URL} https://challenges.cloudflare.com
frame-src https://challenges.cloudflare.com
object-src 'self'
base-uri 'none'
form-action 'self'
frame-ancestors 'none'
upgrade-insecure-requests
```

- `'unsafe-eval'` is added to `script-src` only when `NODE_ENV` is not `production`.
- `upgrade-insecure-requests` is present only when `SITE_URL` is https.
- Turnstile loads because `'strict-dynamic'` trusts scripts that a nonced script loads.
- zod runs in jitless mode on the client (`apps/web/src/lib/zod-client.ts`), so it never needs `'unsafe-eval'`.
- The proxy skips `_next/static`, `_next/image`, `favicon.ico`, `cms-assets`, `stats`, `api` and `.well-known`, plus prefetch requests.
- A Playwright gate in CI (`apps/web/e2e/`) fails on any CSP violation or axe violation.

### Web static headers

Defined in `apps/web/src/lib/security-headers.ts` and applied to every route by `next.config.ts`, which also sets `poweredByHeader: false`.

- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
- `Cross-Origin-Opener-Policy: same-origin`

### API headers

Set on every response in `apps/api/src/portfolio_api/security_headers.py`.

- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Referrer-Policy: no-referrer`
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
- `Cross-Origin-Resource-Policy: same-site`

CORS allows the headers `Content-Type` and `X-Request-ID` and exposes `X-Request-ID`. Origins are the site only.

To check them, see "CSP and headers" in the [runbook](runbook.md#csp-and-headers).

## Reporting a vulnerability

Email **chguzman@augusta.edu**. This matches `apps/web/public/.well-known/security.txt`, served at https://christopherguzman.me/.well-known/security.txt. Please include steps to reproduce and do not test against other people's data. I will reply as soon as I can.
