# Phase 4: Contact form and GitHub activity

_Approved in brainstorming with Chris on 2026-10-02. Refines Phase 4 of [the portfolio design spec](2026-09-16-portfolio-design.md); where the two differ, this document wins. Mockups Chris approved live in the git-ignored `.superpowers/brainstorm/79415-1790952338/content/`._

## Goal

Add the site's first two API-backed interactions: a contact form on `/contact` that reliably reaches Chris's inbox, and a GitHub contribution heatmap on the home page. Both degrade gracefully: neither can break or slow the pages they live on.

## Scope

In scope:

- `POST /v1/contact` with rate limiting, a honeypot, Turnstile verification, persist-then-send email through Resend, and background retries.
- `GET /v1/github/activity` served from a cache that a background job refreshes hourly from GitHub's GraphQL API.
- The contact page redesign (layout B), the contact form, the home page "GitHub activity" section, and a site-wide page-title size change.

Dropped from the master plan's Phase 4 (Chris's decisions):

- **Post views and reactions.** Chris does not want counts or like buttons visible to visitors. Private per-post view counts come from Umami in Phase 6; no like button is built.
- **Resume download counter.** Kept private by tracking the "Download PDF" click as an Umami event in Phase 6. `/resume` keeps linking the file directly; no `/v1/resume` endpoint.

## Decisions

| Area | Decision |
|---|---|
| Form fields | Name, email, message (no subject, reason or company) |
| Inbox | `chguzman@augusta.edu` (stored in secrets as `API_CONTACT_TO`; change after graduation) |
| Reply | Email to Chris has `Reply-To` set to the visitor; no auto-reply to visitors |
| Submit path | Browser posts directly to `https://api.christopherguzman.me/v1/contact` (CORS already allows the site origins) |
| Contact layout | B: form left, compact Email / LinkedIn / GitHub rows right; on phones the form comes first |
| Heatmap placement | Home page, its own section after Experience and before Blog |
| Private contributions | Included, as anonymous counts (GitHub profile setting) |
| Page titles | `PageHeader` title 30px (`text-3xl`), 16px (`mt-4`) below the prompt line; applies to every page using it. The home page name heading is unchanged |

## API: contact

### Endpoint

`POST /v1/contact`, JSON body:

| Field | Rule |
|---|---|
| `name` | string, trimmed, 1–100 chars |
| `email` | valid email address (Pydantic `EmailStr`), ≤ 254 chars |
| `message` | string, trimmed, 10–5000 chars |
| `turnstile_token` | string, 1–2048 chars |
| `website` | honeypot; optional string, must be empty for a real submission |

Processing order:

1. **Rate limit** per client IP: 5 per minute and 20 per day. Over the limit → `429 rate_limited` with `Retry-After` (seconds). The client IP is `CF-Connecting-IP` (trusted because the API is only reachable through the Cloudflare Tunnel or the internal Docker network), falling back to the socket peer address. The limiter is in-process (single API instance, no Redis), a sliding-window counter keyed by IP, with expired entries pruned so memory stays bounded.
2. **Validation** (Pydantic) → `422` in FastAPI's default shape is replaced by `400 invalid_request` with per-field messages under `error.fields`.
3. **Honeypot**: `website` non-empty → respond `202` exactly as for a real submission, store nothing, send nothing, log at info.
4. **Turnstile**: verify the token with Cloudflare `siteverify` (secret + `remoteip`, 5 s timeout). Fails → `400 turnstile_failed`. Cloudflare unreachable → `503 turnstile_unavailable`.
5. **Persist** a `contact_submissions` row with `email_status = pending`, then respond `202 {"status": "received"}`.
6. **Send** in a background task after the response.

When contact is not configured (`API_TURNSTILE_SECRET` unset) the endpoint returns `503 contact_unavailable` before step 2.

Errors use the API-wide shape `{"error": {"code", "message"}}` (plus `fields` for `invalid_request`), and every response echoes `X-Request-ID`.

### Email

- Sent with Resend's HTTP API, plain text only.
- From `API_CONTACT_FROM` (default `Portfolio <contact@christopherguzman.me>`), to `API_CONTACT_TO`, `Reply-To` the visitor's address, subject `Portfolio message from {name}` (name with CR/LF stripped).
- Body: name, email, received time (UTC), then the message verbatim.

### Delivery states and retries

`email_status`: `pending` → `sent`, or `failed` after an error. Each attempt increments `attempts` and records `last_error` (truncated, never the API key).

A background loop started in the API lifespan runs every 5 minutes and retries rows that are `failed`, or `pending` and older than 5 minutes (a send that died mid-flight), while `attempts < 5`. After the 5th failure the row stays `failed` and an error is logged. If `API_RESEND_API_KEY` is unset, sending is skipped without counting an attempt and a warning is logged, so messages wait in the database until a key exists.

### Privacy

No IP address or IP hash is stored (the rate limiter holds IPs in memory only). Messages are kept in the database; Chris reads failed deliveries there (runbook).

### Table `contact_submissions`

`id` (uuid pk), `created_at` (timestamptz), `name`, `email`, `message`, `email_status` (enum `pending`/`sent`/`failed`), `attempts` (int, default 0), `last_error` (text, null), `sent_at` (timestamptz, null), `updated_at` (timestamptz). Index on `(email_status, updated_at)`.

## API: GitHub activity

### Fetch

- GitHub GraphQL `user(login: API_GITHUB_LOGIN) { contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount contributionLevel } } } } }` with `API_GITHUB_TOKEN` (default login `chrisguzman77`).
- Private contributions appear as anonymous counts because Chris enables "Include private contributions on my profile". The token is fine-grained, public repositories read-only, no permissions.
- `contributionLevel` maps `NONE`→0, `FIRST_QUARTILE`→1, `SECOND_QUARTILE`→2, `THIRD_QUARTILE`→3, `FOURTH_QUARTILE`→4.

### Cache and refresh

- Table `github_activity_cache`: `key` (text pk; one row, `contributions`), `payload` (jsonb), `fetched_at` (timestamptz).
- A lifespan background loop refreshes hourly, and immediately at startup when the cached copy is missing or older than 1 hour. On any GitHub error (network, non-200, GraphQL errors, revoked token) the existing row is kept and a warning is logged.
- With `API_GITHUB_TOKEN` unset the loop does not run.

### Endpoint

`GET /v1/github/activity` → `200 {"total": int, "weeks": [{"days": [{"date": "YYYY-MM-DD", "count": int, "level": 0-4}]}], "fetched_at": iso8601}` with `Cache-Control: public, max-age=300`. Never calls GitHub during a request. No cached copy → `503 activity_unavailable` with `Cache-Control: no-store`.

## API structure

Follows the master plan's layering: routers (HTTP) → services (use cases) → repositories (SQLAlchemy). External clients (`TurnstileClient`, `EmailSender`, `GitHubClient`) are `Protocol`s wired through `Depends`/app state so tests substitute fakes; real implementations use one shared `httpx.AsyncClient` closed in the lifespan. One Alembic revision creates both tables.

### New settings (all optional; features stay off until set)

| Env var | Purpose |
|---|---|
| `API_TURNSTILE_SECRET` | Turnstile secret key; enables `/v1/contact` |
| `API_RESEND_API_KEY` | Resend API key |
| `API_CONTACT_TO` | Inbox for messages |
| `API_CONTACT_FROM` | Sender, default `Portfolio <contact@christopherguzman.me>` |
| `API_GITHUB_TOKEN` | GitHub fine-grained token; enables the refresh loop |
| `API_GITHUB_LOGIN` | Default `chrisguzman77` |

Names in `prod.enc.env` → container env: `TURNSTILE_SECRET_KEY` → `API_TURNSTILE_SECRET`, `RESEND_API_KEY` → `API_RESEND_API_KEY`, `CONTACT_TO` → `API_CONTACT_TO`, `GITHUB_ACTIVITY_TOKEN` → `API_GITHUB_TOKEN` (api); `TURNSTILE_SITE_KEY` → `TURNSTILE_SITE_KEY` (web).

Compose passes the secret ones as `${VAR:-}` (not `:?`), so the stack deploys before Chris's accounts exist. The keys are added to `prod.env.example` in the same PR that adds their values to `prod.enc.env`, so `make secrets-check` keeps passing until then.

## Web

### Page titles

`PageHeader`: title `text-3xl` (30px), `mt-4` below the prompt. The home page's `h1` is untouched.

### `/contact` (layout B)

- Desktop: two columns (about 1.7 : 1). Left: a card titled "Send a message" (`h2`) with Name and Email side by side, Message below, and a "Send message" button. Right: three compact rows (icon, label, value, action): Email with Copy, LinkedIn with Open, GitHub with Open. Phones: one column, form first. Link and copy behavior, labels and new-tab `rel` stay as today.
- Client-side validation uses the same limits as the API, with errors shown under each field (`aria-describedby`, `aria-invalid`) and focus moved to the first invalid field.
- Turnstile loads only on this page (explicit render, managed mode, theme follows the site theme). The token resets after every failed submit.
- States:
  - Sending: button reads "Sending…" and is disabled.
  - Success: the form is replaced by "Message sent. I'll reply to the email you gave." (announced with `role="status"`).
  - `429`: "Too many messages. Try again later, or email me directly."
  - `400 turnstile_failed`: "Spam check failed. Try again."
  - `400 invalid_request`: the API's field errors shown under the fields.
  - Network error or 5xx: "Couldn't send. Email me at chguzman@augusta.edu instead." (address from the profile, as on the rest of the page). Typed input is kept.
- Configuration is read on the server (`TURNSTILE_SITE_KEY`, `PUBLIC_API_URL` default `https://api.christopherguzman.me`) and passed to the client form as props; nothing is baked in at build time. With no site key, the card shows "Contact form coming soon. Email me directly." instead of the form.

### Home: GitHub activity

- New section "GitHub activity" after Experience and before Blog, using `SectionHeading` with link label `@chrisguzman77` to the GitHub profile. Section numbering stays automatic (`sectionNumbers` gains `activity`; a hidden section is skipped).
- Fetched on the server from `${API_INTERNAL_URL}/v1/github/activity` together with the page's other data (section numbers depend on whether it shows, so it cannot stream in later). A 1.5 s timeout and a module memo (successes kept 300 s, failures 60 s) keep a slow or hung API from delaying the page more than once a minute. Any error, non-200 or schema mismatch (zod) hides the section.
- Card: month labels, a 7-row grid of weeks, footer `N contributions in the last year · updated hourly` and a less/more legend. Desktop shows the full year GitHub returns (52–53 weeks); below `md` only the last 22 weeks show (older columns hidden with CSS).
- Cells use the accent at four strengths plus an empty color, defined as semantic tokens for both themes. Each cell has a `title` like `3 contributions on Sep 14, 2026` (`No contributions on …` for zero, `1 contribution on …` singular).
- Accessibility: the grid is one `role="img"` with `aria-label="N GitHub contributions in the last year"`; the card links to the GitHub profile (new tab, `rel="noopener noreferrer"`).

## Error handling summary

| Failure | Result |
|---|---|
| API down | Contact form shows the email fallback; heatmap hidden; rest of both pages unaffected |
| Resend down / key revoked | Message saved, retried every 5 min up to 5 attempts |
| Turnstile down | `503`; form shows the email fallback |
| GitHub down / token revoked | Last cached heatmap keeps showing |
| Accounts not set up yet | Form shows "coming soon"; heatmap hidden |

## Testing

- **API (pytest, fakes for Turnstile, Resend, GitHub):** validation limits; honeypot stores nothing and returns 202; bad token → 400; Turnstile unreachable → 503; unconfigured → 503; 6th request in a minute → 429 with `Retry-After`, 21st in a day → 429; row saved as `pending` then `sent`; send failure → `failed`, retried, stops after 5 attempts; missing Resend key does not count attempts; subject strips CR/LF; GitHub refresh stores the mapped payload; GitHub failure keeps the old row; no row → 503; `Cache-Control` headers; `alembic check` clean.
- **Web (vitest):** form validation messages; each submit outcome (202, 400 field errors, 400 turnstile, 429, network error) renders the right state; "coming soon" without a site key; heatmap renders weeks, labels, singular/plural titles and the aria-label; heatmap hidden on API error; section numbering with and without the activity section; `PageHeader` classes.
- **Smoke (`scripts/smoke.sh`):** `api /v1/github/activity` answers `200` or `503` (both mean the route is wired).
- **Manual after deploy (once secrets exist):** a real message arrives in `chguzman@augusta.edu` and Reply goes to the sender; a 6th message in a minute is blocked; the heatmap matches github.com/chrisguzman77.

## Chris's setup steps

1. **Resend:** sign up, add domain `christopherguzman.me`, add the DNS records it lists (DKIM, SPF/MX for its sending subdomain, DMARC if not present) in Cloudflare DNS, wait for "Verified", create an API key with "Sending access" for that domain.
2. **Turnstile:** Cloudflare dashboard → Turnstile → add widget, hostnames `christopherguzman.me` and `localhost`, mode Managed. Gives a site key and secret key.
3. **GitHub:** Settings → Public profile → enable "Include private contributions on my profile"; Settings → Developer settings → fine-grained token, public repositories read-only, no extra permissions, 1-year expiry.
4. **Secrets:** `make secrets-edit` to add `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY`, `GITHUB_ACTIVITY_TOKEN`, `CONTACT_TO`; `make secrets-check`; commit and push the branch I prepare (it also adds the keys to `prod.env.example` and compose).
5. **Optional:** a Cloudflare rate-limiting rule on `api.christopherguzman.me/v1/contact` as a second layer (free plan allows one rule).

Development uses Turnstile's published test keys (always pass) in `compose.dev.yaml`, and no Resend key (messages stay `pending`, logged).

## Docs

- `docs/runbook.md`: reading contact messages and failed deliveries in Postgres; what the retry loop does; rotating the Resend key, Turnstile keys and GitHub token (yearly expiry).
- `docs/setup.md`: the setup steps above.
- `docs/architecture.md`: the two endpoints, background loops and degradation behavior.
- ADR 0007: in-process rate limiting and lifespan background loops (single API instance, no Redis or queue), and when that would need to change.
