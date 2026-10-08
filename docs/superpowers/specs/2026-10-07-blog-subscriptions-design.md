# Blog subscriptions

Approved by Chris in brainstorming on 2026-10-07. Built before Phase 7b, so subscribing works when the first posts go up.

## Goal

Visitors can subscribe by email. When Chris chooses to, he sends a new post to confirmed subscribers by clicking one button in Directus. He can see subscriber counts in Grafana and the subscriber list on a private admin page.

## Decisions

| Area | Decision |
|---|---|
| Approach | Built into the site: FastAPI + Postgres + Resend. No third-party newsletter service. |
| Sending | Manual. A Directus button on each post. Never automatic. |
| Consent | Double opt-in. A visitor is subscribed only after clicking the confirmation email. |
| Placement | Top of `/blog`, and on the homepage under the Blog section's latest posts. Not at the end of posts, not in the footer. |
| Copy | The box is titled "Subscribe". Button "Subscribe". Note "No spam. Unsubscribe anytime." |
| Measurement | No open pixels and no click rewriting. Post links carry `utm_source=newsletter&utm_medium=email&utm_campaign=<slug>`. Visits per newsletter are counted, not who clicked: they appear on the Grafana Newsletter dashboard (read from Umami's data) and in Umami's UTM report. |
| Dashboard | A Grafana "Newsletter" dashboard (counts, trends, and newsletter visits per post), plus a private `/admin/subscribers` page (list and remove). |

## Visitor experience

1. **Subscribe.** The visitor enters an email and clicks Subscribe.
   - Turnstile runs invisibly. Its script loads only when the email field is first focused, so `/blog` and the homepage pay no script cost until someone starts typing.
   - The response is always "Check your inbox to confirm.", including for addresses already subscribed or pending. This prevents list enumeration.
2. **Confirmation email.**
   - From `Christopher Guzman <posts@christopherguzman.me>`.
   - Subject "Confirm your subscription to Christopher Guzman's blog".
   - One "Confirm subscription" button linking to `https://christopherguzman.me/newsletter/confirm?token=…`.
   - Pending sign-ups that are not confirmed are deleted after 7 days.
3. **Confirm page.** The page posts the token to the API from client JS on load, so link scanners that prefetch GETs do not confirm, then shows "You're subscribed. You'll get an email when there's a new post." An invalid or expired token shows "This link has expired. Subscribe again from the blog." with a link.
4. **New-post email.**
   - Subject: the post title. Body: the excerpt and a "Read the post" button (UTM-tagged).
   - Footer: "You're getting this because you subscribed at christopherguzman.me · Unsubscribe".
   - Plain HTML in the site's style, plus a text part.
   - Headers `List-Unsubscribe: <https://api.christopherguzman.me/v1/newsletter/unsubscribe?token=…>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), so Gmail and Yahoo show their own Unsubscribe button.
5. **Unsubscribe.** The footer link opens `/newsletter/unsubscribe?token=…`. The page posts on load (JS) and shows "You're unsubscribed." There is no login and no confirmation step. Unsubscribing deletes the subscriber row; no suppression list is kept.

## Sending (Chris)

- **The button.** Directus shows a manual Flow button "Email to subscribers" on `posts` items. Its confirmation dialog shows the post and a checkbox "Send a test to me only".
- **The Flow.**
  - It calls `POST http://api:8000/internal/newsletter/send` with `X-Internal-Secret` (existing `INTERNAL_API_SECRET`) and `{ post_id, test }`.
  - On a successful non-test send it writes the API's `sent_at` and `recipients` back to the post's read-only `emailed_at` and `emailed_count` fields.
  - Directus shows the Flow's success or failure.
- **API rules.**
  - The post must exist in Directus and be `published`. Otherwise 409 `not_published`.
  - A post that has completed a send returns 409 `already_sent` with its `sent_at`, so double clicks never email twice.
  - `test: true` sends only to `CONTACT_TO`, records nothing, and ignores `already_sent`.
- **Delivery.**
  - Resend batch API, up to 100 messages per request, one message per subscriber. Each has its own unsubscribe token; no BCC.
  - Each delivered subscriber is recorded in `newsletter_deliveries` (unique per post and subscriber).
  - If Resend fails or hits its quota partway (free plan: 100 a day, 3,000 a month), the API returns 207 with `sent` and `remaining`. Clicking again sends only to subscribers without a delivery row, possibly the next day.
  - A send is complete when no confirmed subscriber is left without a delivery. Only then is `already_sent` set.

## Architecture

### API (FastAPI, `portfolio` database)

- **Tables** (Alembic migration):
  - `newsletter_subscribers`: `id` (uuid), `email` (unique, stored lowercased and trimmed), `status` (`pending` | `confirmed`), `confirm_token_hash` (sha256, nullable), `confirm_sent_at`, `created_at`, `confirmed_at`.
  - `newsletter_sends`: `post_id` (pk), `started_at`, `completed_at`, `recipients`.
  - `newsletter_deliveries`: `post_id`, `subscriber_id` (fk, on delete cascade), `sent_at`; unique on (`post_id`, `subscriber_id`).
- **Tokens.**
  - The confirm token is 32 random bytes (urlsafe). Only its sha256 is stored. It expires 7 days after `confirm_sent_at`.
  - The unsubscribe token is `<subscriber id>.<HMAC-SHA256(key, "unsub:" + id)>`. It is not stored, and it stops working when the row is deleted.
  - The HMAC key is derived from `INTERNAL_API_SECRET` with the label `newsletter-unsubscribe-v1`. Rotating that secret invalidates old unsubscribe links; the runbook notes this.
- **Public endpoints.** All return the standard error body and are JSON-only, like contact.
  - `POST /v1/newsletter/subscribe`: body `{ email, turnstile_token, website }`, where `website` is the honeypot.
    - Rate limit 5/min and 20/day per client key (/64 for IPv6).
    - At most one confirmation email per address per hour.
    - Always returns 202 `{ status: "check_inbox" }`.
    - A new address creates a pending row and sends the email. An existing pending address re-sends if allowed. A confirmed address sends nothing.
  - `POST /v1/newsletter/confirm`: body `{ token }`. Returns 200 `{ status: "confirmed" }`, or 400 `invalid_token`.
  - `POST /v1/newsletter/unsubscribe`: token from the body `{ token }` or from the query string with the RFC 8058 form body. Returns 200 `{ status: "unsubscribed" }`. An unknown or already-deleted subscriber also gets 200, so the call is idempotent. A malformed or forged token gets 400 `invalid_token`.
- **Internal endpoints** (`require_internal`: secret header, refused when `CF-Connecting-IP` is present):
  - `POST /internal/newsletter/send`, described under Sending.
  - `GET /internal/newsletter/subscribers` returns `[{ id, email, status, created_at, confirmed_at }]` plus totals.
  - `DELETE /internal/newsletter/subscribers/{id}`.
- **Jobs.** A daily job deletes pending rows older than 7 days.
- **Metrics.**
  - Gauge `newsletter_subscribers{status}`.
  - Counters `newsletter_subscribe_requests_total{result="accepted"|"rejected"}`, `newsletter_confirmations_total`, `newsletter_unsubscribes_total`, `newsletter_emails_total{kind="confirm"|"post"|"test",result="sent"|"failed"}`.
- **Email.** Sent with the existing Resend client (`resend_api_key`). New setting `newsletter_from`, default `Christopher Guzman <posts@christopherguzman.me>`; the domain is already verified in Resend.

### Web (Next.js)

- **`SubscribeForm`** (client component), used on `/blog` (under the page header) and on `/` (under the Blog section's post list).
  - It renders only when the API URL and Turnstile site key are configured, like the contact form.
  - It validates the email shape client-side and shows the success, rate-limited and unavailable messages.
- **Confirm and unsubscribe pages.** `/newsletter/confirm` and `/newsletter/unsubscribe` are client pages that post the token to the API on load. They are excluded from the sitemap and marked `noindex`.
- **Admin page `/admin/subscribers`.**
  - Server component. It verifies the `Cf-Access-Jwt-Assertion` header with `jose` against `https://<CF_ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs` and audience `CF_ACCESS_AUD`.
  - Missing or invalid JWT, or unset env, returns 404 (fail closed).
  - It lists subscribers via the internal API, using `API_INTERNAL_URL` and `INTERNAL_API_SECRET`, newly passed to the web container. Each row has a Remove button, a server action calling DELETE.
  - `noindex`, `Disallow: /admin` in robots, not linked anywhere.
- **Analytics.** Umami event `newsletter-subscribe` on success; no email is sent to Umami.
- **CSP.** No change. Turnstile is already allowed, and server actions post to `'self'`.

### Directus

- **Fields.** `posts` gains `emailed_at` (timestamp, read-only, sidebar) and `emailed_count` (integer, read-only), created by the bootstrap schema step. They are not readable by the web-reader role.
- **Flow.** The bootstrap creates the manual Flow "Email to subscribers" on `posts`, with "Require confirmation" and the field `test_only` (boolean). It runs a webhook operation, then a conditional update of `emailed_at` and `emailed_count` when not a test. It is idempotent, like the existing Flows.

### Monitoring

- **Grafana "Newsletter" dashboard:**
  - confirmed and pending subscribers (stat)
  - subscribers over time
  - subscribes, confirmations and unsubscribes per week
  - post emails sent, and failures, per send
- **Newsletter visits per post (bar gauge).** It reads Umami's `website_event` table through a new Grafana PostgreSQL data source named `umami-readonly`. The query counts distinct sessions where `utm_source = 'newsletter'`, grouped by `utm_campaign` (the post slug), over the dashboard's time range. Before writing the query, confirm the column names against the pinned Umami version's schema.
  - **Read-only role.** The data source logs in as a `grafana_umami_ro` role with `CONNECT` on the `umami` database and `SELECT` on `website_event` only, and nothing else.
    - Its password is `GRAFANA_UMAMI_DB_PASSWORD`, optional in `prod.enc.env` and passed to the Grafana and postgres containers.
    - Fresh installs create the role in `infra/postgres/init`. The existing production database gets it from an idempotent deploy step (`scripts/deploy.sh`, `psql` in the postgres container: create the role if missing, set its password, grant). The step is skipped while the variable is empty.
  - **Unset variable.** While `GRAFANA_UMAMI_DB_PASSWORD` is unset, the panel shows "No data" and nothing else is affected.
  - **CI `$` guard.** The data source file interpolates `${GRAFANA_UMAMI_DB_PASSWORD}`, so the guard gets an explicit exemption for that one variable, like the existing `${CONTACT_TO}` one.
  - **Runbook note.** After a major Umami upgrade, check the "Newsletter visits per post" panel; Umami may change `website_event` columns. Dependabot already skips Umami majors, so they happen only by hand.
- **Grafana alert "Newsletter send failed":** `increase(newsletter_emails_total{kind="post",result="failed"}[15m]) > 0`, emailed to Chris.
- **Umami UTM report:** the same newsletter visits, with per-post drill-down (countries, devices), filtered on `utm_source=newsletter`.

## Chris's setup (after merge)

1. **Cloudflare Access app** for `christopherguzman.me/admin` (path-based), with the same policy as `cms.`. Copy its **Application Audience (AUD) tag** and the team domain (`<team>.cloudflareaccess.com`). Neither value is secret.
2. **Secrets.** `make secrets-edit`: add `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` and `GRAFANA_UMAMI_DB_PASSWORD` (generate it with `openssl rand -hex 24`; it does not need to go in the password manager). All three are optional: the admin page stays 404 and the visits panel shows "No data" until they are set. Then commit and merge.
3. **Test.** In Directus, open any published post → Email to subscribers → tick "Send a test to me only" → Send. The email arrives at `CONTACT_TO`.

## Testing

- **API (pytest):**
  - subscribe, confirm and unsubscribe, including idempotent unsubscribe
  - the same response for new, pending and confirmed addresses
  - expired, unknown and forged tokens
  - the honeypot, Turnstile failure and rate limits
  - the per-address hourly limit
  - the purge job
  - send:
    - skips drafts and already-sent posts
    - test sends only to `CONTACT_TO` and records nothing
    - a batch failure partway, then a resumed send with no duplicates
    - completion sets `already_sent`
    - `List-Unsubscribe` headers are present and UTM links are correct
  - the internal list and delete endpoints, and that the internal routes refuse tunnel traffic
  - metrics
- **Web (vitest):** `SubscribeForm` states (lazy Turnstile, success, errors); confirm and unsubscribe page states; admin page 404 without or with an invalid JWT, and the list and remove flow with a mocked JWT verifier and API.
- **Directus:** a `lib.mjs` unit test for the Flow and field plan; a dev-stack run of the bootstrap twice (idempotent).
- **Infra:** the deploy step that creates `grafana_umami_ro` is idempotent and skipped when the password is unset (shellcheck, plus a dev-stack run twice). The Grafana provisioning parse and the `$` guard pass with the new data source. The visits query runs against the dev Umami database.
- **Playwright:** subscribe on `/blog` shows "Check your inbox to confirm". The confirm and unsubscribe pages render with fixture tokens. The existing CSP, console and axe gates apply.
- **Performance:** the `/` mobile Lighthouse score stays ≥ 95 (Turnstile is not loaded until focus).

## Out of scope

Automatic sending, open and click tracking, imports, digests, multiple lists, and subscriber self-service beyond unsubscribe.
