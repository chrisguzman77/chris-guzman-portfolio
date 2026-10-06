# Phase 7a: Engineering polish

Approved by Chris in brainstorming on 2026-10-06. Phase 7 is split into 7a (this spec: engineering polish), 7b (content: blog posts, project write-ups, recruiter FAQ; Claude drafts, Chris edits) and 7c (launch: README, OG/Search Console, Umami goals, `v1.0.0`).

## Goal

Close the security, performance, accessibility and testing gaps the 2026-10-06 audit found, and clear the whole recorded backlog, so the site is launch-ready.

## Audit baseline (2026-10-06, live site)

| Check | Result |
|---|---|
| Lighthouse desktop | 100 in every category on 7 pages |
| Lighthouse mobile | 96–100 everywhere except `/` Performance **68** (1,023 ms long task in one client chunk; 194 KB HTML, 110 KB of it inlined RSC payload) |
| axe (dark + light, 9 pages) | 1 serious: `label-content-name-mismatch` on project-card and heatmap links; no contrast issues; no skip link |
| Security headers | none on the web app or API (no CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy, frame protection); `x-powered-by: Next.js` exposed; no `security.txt` |
| E2E | none |
| Dependencies | web prod audit 4 high / 0 critical (two via `shadcn`); API 0 |

## Decisions

| Area | Decision |
|---|---|
| CSP | Strict, nonce-based, enforced (not report-only). |
| Backlog | Every open item below, except W5 (print stylesheet: the PDF is the printable resume), W6 (loading skeletons: pages render in ~50 ms, skeletons would flash) and A12 (recruiter FAQ: moves to 7b as content). |
| E2E | Playwright visitor journey in CI against the built app with a fake API. |
| TypeScript 6 | Tried on its own commit inside 7a; kept only if every check passes, otherwise reverted and #6 stays on hold. |
| `@types/node` | Dependabot ignores semver-major bumps (runtime is Node 24); close #38 with that reason. |

## 1. Security headers

### Web (Next.js 16)

- `src/proxy.ts` (Next 16 middleware) runs on every page request (matcher excludes `_next/static`, `_next/image`, `favicon.ico`, `/cms-assets`, `/stats`, `/api`):
  - generates a nonce: 16 random bytes, base64;
  - sets `Content-Security-Policy` on the response and `x-nonce` on the request so server components can read it.
- Policy (enforced):

```
default-src 'self';
script-src 'self' 'nonce-{N}' 'strict-dynamic' https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self' https://api.christopherguzman.me https://challenges.cloudflare.com;
frame-src https://challenges.cloudflare.com;
object-src 'self';
base-uri 'none';
form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests
```

  `style-src 'unsafe-inline'` stays because Next and next-themes inject style attributes; style injection is far lower risk than script injection and is recorded as a trade-off in `docs/security.md`. `connect-src` takes the API origin from `PUBLIC_API_URL` (runtime env), not a hard-coded host. In development (`NODE_ENV !== "production"`) `script-src` also allows `'unsafe-eval'` for React Refresh.
- Every inline or first-party script gets the nonce: Next's own scripts (automatic once the CSP header carries a nonce), the next-themes script (`nonce` prop on `ThemeProvider`), the Umami tag, and the Turnstile script. JSON-LD (`type="application/ld+json"`) is a data block and needs no nonce.
- Reading the nonce makes every page render per request; data fetches stay cached by their tags, so CMS load is unchanged.
- Static headers via `next.config.ts` `headers()` on every route: `Strict-Transport-Security: max-age=31536000; includeSubDomains` (no `preload`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, `Cross-Origin-Opener-Policy: same-origin`. `poweredByHeader: false`.
- `/cms-assets/*` keeps its own sandbox CSP for non-image, non-PDF types.
- `src/app/.well-known/security.txt/route.ts` (or `public/.well-known/security.txt`): `Contact: mailto:chguzman@augusta.edu`, `Expires:` one year ahead (CI test fails within 30 days of expiry), `Preferred-Languages: en`, `Canonical: https://christopherguzman.me/.well-known/security.txt`.

### API (FastAPI)

- Middleware adds to every response: `X-Content-Type-Options: nosniff`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Cross-Origin-Resource-Policy: same-site`. The API serves JSON only, so the strict CSP costs nothing.
- CORS reviewed: allowlist stays the two site origins; `X-Request-ID` exposed and allowed on preflight (backlog A7).

## 2. Performance

- Target: mobile Lighthouse Performance **≥ 95 on `/`**, measured on production after deploy (3 runs, median), with every other page staying ≥ 95.
- Find what owns the 1,023 ms task in the client chunk (bundle analyzer: `ANALYZE=true pnpm build` with `@next/bundle-analyzer`, dev-only) and fix the cause. Expected levers, applied only where the measurement points:
  - the chat terminal panel and its code load only on first open (the launcher stays tiny);
  - the GitHub heatmap and the status card render their heavy parts lazily or on the server;
  - shrink the inlined RSC payload on `/` (pass only fields the client components use).
- Desktop stays 100.

## 3. Accessibility

- "Skip to content" link as the first focusable element, visible on focus; `<main id="main" tabIndex={-1}>` in the root layout.
- Project-card and heatmap links: the accessible name starts with the visible text (drop `aria-label` overrides or make them extend the visible label).
- Focus-visible ring on every interactive element in both themes (audit header nav, footer, chat pill, status card, theme toggle).
- Status card: the 30 bars become one labelled group (`role="img"` with a summary label such as `30-day uptime, 29 days at 100%, 1 day at 98.7%`), bars `aria-hidden` (backlog W17).
- Target: axe 0 violations on every page in both themes (checked in Playwright).

## 4. Playwright end-to-end tests

- `apps/web/e2e/`, `@playwright/test`, Chromium only, run in CI as a new `e2e` job after `web` builds (production build + `next start`).
- A small fake API (Node HTTP server started by Playwright's `webServer`, fixtures in `e2e/fixtures/`) answers `/v1/status`, `/v1/contact`, `/v1/chat/*`, `/v1/github/activity`; `API_INTERNAL_URL` and `PUBLIC_API_URL` point at it. CMS reads use a fake Directus fixture server the same way (or the existing test fixtures), so CI needs no network.
- Tests (each at 390×844 and 1280×800; dark default plus one light run):
  1. Home renders hero, status card (operational fixture), featured projects; the skip link works.
  2. Project list → a project detail page.
  3. Resume page shows the download link.
  4. Contact form validates, submits to the fake API, shows success (Turnstile in test mode via the always-pass site key `1x00000000000000000000AA`).
  5. ⌘K / pill opens the chat terminal; a question gets the fixture answer with a source link; Esc closes.
  6. Unknown route shows the 404 page.
  7. Every page above: no console errors, **no CSP violations** (listen for `securitypolicyviolation`), axe 0 violations (`@axe-core/playwright`).
  8. Response headers on `/` include the CSP with a nonce and the static headers.
- CI caches the Playwright browser; job time target under 5 minutes.

## 5. Backlog

Every item in the table at the end of this spec is in scope unless marked out of scope above. Items needing Chris:

- **I6 GitHub App for the runner.** Chris creates a GitHub App (repo-scoped, Actions + Administration read/write for self-hosted runners), installs it on the repo, stores the app ID and private key in `prod.enc.env`; the runner entrypoint mints a registration token from the app instead of the PAT. Steps go in `docs/setup.md`; the PAT is revoked after the switch.
- **I14 Directus bootstrap credentials.** Bootstrap authenticates with a dedicated static admin token (`DIRECTUS_BOOTSTRAP_TOKEN`) instead of the admin email/password, so password changes and 2FA no longer break deploys. Chris creates the token in Directus and adds it to secrets. "Re-seed when a collection is emptied" becomes seed-once: bootstrap records seeded collections in a `bootstrap_state` singleton and never re-seeds them.
- **I1 Cloudflare rate-limit rule** and **I7 Proxmox key-only SSH**: step-by-step instructions in `docs/setup.md`/`docs/runbook.md`; Chris applies them.

Everything else is code, config or docs done by Claude.

## 6. Dependencies

- Move `shadcn` to `devDependencies` (it is a CLI) and resolve the remaining prod-audit highs by updating or overriding the affected packages; target: `pnpm audit --prod` 0 high, 0 critical.
- TypeScript 6 on its own commit; keep only if lint, typecheck, tests, build and e2e all pass.
- `.github/dependabot.yml`: ignore `@types/node` semver-major updates; add `compose.dev.yaml` and the CI-pinned images to Dependabot coverage where it supports them (backlog I8); close #38.

## 7. `docs/security.md`

Short threat model in plain prose:

- Assets: CMS content and uploads, contact submissions, chat logs, secrets (`prod.enc.env`, age keys, tokens), the VM, backups.
- Attackers: anonymous internet visitors and bots, a compromised dependency, a stolen token, a compromised VM.
- Controls mapped to threats: Cloudflare Tunnel (no open ports), Access on admin hosts, CSP and headers, Turnstile, rate limits and budgets, SOPS/age secrets, least-privilege tokens, runner isolation, encrypted deletion-locked backups with a separate key, Trivy and Dependabot, monitoring and alerts.
- Accepted trade-offs: `style-src 'unsafe-inline'`, the runner's Docker socket (ADR 0006), single-VM availability (fallback Worker, Better Stack), Grafana/Umami admin behind Access plus their own logins.
- How to report a vulnerability (matches `security.txt`).

## Testing and done criteria

- Web, API, infra suites green; new tests for the proxy (nonce present and unique per request, CSP string), API security headers, `security.txt` expiry, skip link, accessible names, status-card group label.
- Playwright job green in CI, including zero CSP violations and zero axe violations.
- After deploy: production mobile Lighthouse ≥ 95 on `/` (median of 3), desktop 100; `curl -sI` shows every header on the site and API; `securityheaders.com` grade A or better; `security.txt` served.
- `pnpm audit --prod`: 0 high/critical.

## Rollout

One PR (`phase-7a`). The CSP is enforced from the first deploy, so the Playwright CSP-violation check is the gate; after deploy, smoke and a manual browse (home, chat, contact form with real Turnstile, resume PDF, theme toggle) confirm nothing is blocked. If anything is, the fix is a policy change in `src/proxy.ts`, or a revert of the PR. The I6 and I14 switches happen after merge with Chris, each with its old credential kept until the new one is proven.

## Backlog (from the 2026-10-06 audit)

Effort S/M/L. UV = user-visible. Out of scope: W5, W6 (see Decisions), A12 (moves to 7b).




### Web (19 in scope)
| # | Item | Eff | UV |
|---|---|---|---|
| W1 | Add security headers (CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy, frame-ancestors), `poweredByHeader: false` (new, from audit; also resolves stale Phase 5 CSP spec note) | M | no |
| W2 | Add skip link and `id` on `<main>`; check header/footer nav focus styles (new) | S | yes |
| W3 | ProjectCard/heatmap `aria-label` replaces visible text: fix axe `label-content-name-mismatch` (Phase 3 minor, confirmed by axe) | S | yes |
| W4 | Mobile `/` Lighthouse 68: 1 s long task in 72 KB chunk, 194 KB HTML; lazy-load heatmap/chat/status islands (new) | M | yes |
| W7 | Playwright e2e smoke suite and CI job (deferred from Phase 2/3) | L | no |
| W8 | `outlineButton` class duplicated in 4 pages: extract (Phase 3) | S | no |
| W9 | Orphan shadcn tokens in globals.css (Phase 2) | S | no |
| W10 | Phase 3 residuals: posts list without body, metadata descriptions, `#` headings in markdown, collection list parity test, header-test regex, mobile-nav test strength, weak/flaky tests (fake-timer findBy, no-caption assertion), robots.txt sitemap URL fixed at build | M | partly |
| W11 | Contact page: `new URL()` throws on bad CMS URL, empty-string fallbacks, CopyEmail timer not cleared (Phase 3 T9) | S | no |
| W12 | Hidden `<object>` may still fetch the PDF on mobile (Phase 3 T9) | S | yes |
| W13 | Blog: RSS strip XML-illegal control chars (+test), rfc822 `slice(0,10)`, TOC `lg:top-24` magic offset, duplicate heading ids/TOC keys (Phase 3 T8) | S | no |
| W14 | `/api/revalidate` unauth `console.warn` log inflation; block at edge with WAF (Phase 3 T10) | S | no |
| W15 | Heatmap: in-flight dedupe at memo expiry, first-month label on mobile, impossible-date guard (Phase 4) | S | yes |
| W16 | Contact form: maxLength counts untrimmed text (Phase 4) | S | no |
| W17 | Status card: rounded % vs bar colour at 99.495, memoize promise not value, 30 `role=img` bars verbose for screen readers, empty `aria-hidden` skeleton value (Phase 6 T3) | S | yes |
| W18 | Chat: pointercancel in drag, clear input after length check, live-region re-announce, `clearInterval` in updater, UTF-16 vs code point length (Phase 5 T8) | S | yes |
| W19 | Umami: `resume-download` can double-count (use `from` prop or note in runbook); script streams late inside Suspense (Phase 6) | S | no |
| W20 | jsdom "navigation not implemented" noise from source-link tests (Phase 5/6) | S | no |
| W21 | Dependabot: TypeScript 6 (#6, on hold), `@types/node` 26 (#38), web-minor (#37); consider moving `shadcn` to devDependencies to clear 2 prod-audit highs | S | no |

### API (13 in scope)
| # | Item | Eff | UV |
|---|---|---|---|
| A1 | Rate limiter keys full IPv6 address (rotate within /64) and key map unbounded; key on /64 and cap (Phase 4 M4, Phase 5) | M | no |
| A2 | Chat: count/budget race, DB error masking model error, shared "unknown" IP bucket, test smells (Phase 5 T5) | S | no |
| A3 | Chat retention job runs only when fully configured: register whenever DB/salt set (Phase 5) | S | no |
| A4 | Title over 300 chars aborts a RAG sync partway (Phase 5) | S | no |
| A5 | RAG: keyword leg ANDs terms (consider OR), `upsert_document` bumps `updated_at`, debounce task not cancelled on shutdown, embedding dimension check, window step <= 0, resume size cap (Phase 5 T1-T3) | M | partly |
| A6 | Contact: malformed JSON bypasses rate limit/config check, name CR/LF in email body, use DB clock in retry query, Content-Length non-ASCII digit fallthrough, engine `hide_parameters=True` (Phase 4) | S | no |
| A7 | CORS preflight lacks `X-Request-ID`, `run_forever` no backoff, lifespan lacks try/finally, no 405/fields tests (Phase 4 T1) | S | no |
| A8 | GitHub activity: no test that endpoint makes no GitHub call, job wiring untested, refresh catches only `GitHubError`, corrupt payload gives 500 (Phase 4 T3) | S | no |
| A9 | Enable ruff `S` rules and add structlog output test (deferred from Phase 4) | S | no |
| A10 | Metrics: `chat_questions_total` excludes pre-compose rejections, missing tests (413 unmatched, uncited counter, gauge job registered), `disable_created_metrics` global side effect (Phase 6 T1) | S | no |
| A11 | Status service: floor slack in tiny windows, per-phase httpx timeout, ~35 concurrent PromQL queries/refresh, cache `first_probe`, `requests_today`/`p95` include web's own `/v1/status` calls (Phase 6) | S | no |
| A13 | Unhandled Directus error in `_reindex`/CLI traceback, `pdf_text` catch widening, `replace(**{...})` wrapper, missing seed file silent (Phase 5 T2/T6 minors) | S | no |
| A14 | Add `security.txt` route or static file and CORS review for API (new; pairs with W1) | S | no |

### Infra / ops (14)
| # | Item | Eff | UV |
|---|---|---|---|
| I1 | Cloudflare rate-limit/WAF rules for `/v1/contact` and `/v1/chat/*` (free plan has a single rule; check usage) | S | no |
| I2 | Digest-pin third-party images (Phase 2) | M | no |
| I3 | Fallback Worker `meta refresh` 60 s vs `Retry-After` 300 (Phase 2) | S | yes |
| I4 | cloudflared healthcheck (Phase 2; verify if already added) | S | no |
| I5 | Runner-offline alerting (deferred to Phase 6; confirm an alert rule exists) | S | no |
| I6 | GitHub App instead of PAT for the runner (Phase 2) | M | no |
| I7 | Proxmox host root SSH is password-based: key-only (Phase 2) | S | no |
| I8 | Image tags drift: Dependabot does not bump `compose.dev.yaml`, `ci.yml` promtool/blackbox tags, supercronic `ARG` (Phase 6) | S | no |
| I9 | Docker packages not in unattended-upgrades (Phase 2) | S | no |
| I10 | Grafana/Prometheus: "Uptime (30d)" label vs card, "Network" panel is container sum, "Last backup age" shows No data when absent, CI `$` guard covers only `rules.yml`, container-down 24 h lookback (Phase 6) | S | no |
| I11 | Backup scripts: `PGUSER` in ERE, `pg_restore --version` in secrets step (Phase 6 T6/T7) | S | no |
| I12 | Verify Cloudflare cache rule for `/cms-assets/*` (`cf-cache-status`; origin sends immutable) (Phase 3) | S | no |
| I13 | Memory watch: caps total ~4.7 GiB on a 4 GiB VM; watch working set and swap for a week (Phase 6) | S | no |
| I14 | Directus bootstrap depends on admin creds (password change/2FA breaks deploys), and deleting all items in a collection re-seeds (Phase 3, documented only) | M | no |

### Docs (3)
| # | Item | Eff | UV |
|---|---|---|---|
| D1 | Phase 5 spec claims a site-wide CSP exists; correct or satisfy via W1 | S | no |
| D2 | Wording nits: README "Phase 4 and Phase 5 tables", runbook "first four" vs 3 seeded, Makefile help alignment, `API_CONTAINER` empty error message | S | no |
| D3 | Add `security.txt`/CSP rollout and weekly-proof notes to runbook once W1 lands (new) | S | no |

Backlog total: 52 items (W 21, A 14, I 14, D 3), of which 14 are user-visible or partly.
