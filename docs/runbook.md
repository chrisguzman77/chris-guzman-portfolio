# Runbook

Production is VM 400 (`192.168.1.50`) on the Proxmox host, reached from the internet only through the Cloudflare Tunnel. Everything below runs on the VM from `/opt/portfolio` unless marked otherwise.

## First deploy (once, after bootstrap)

1. The release workflow has run on main at least once (so web, api and runner images exist), and all three GHCR packages — web, api, runner — are public (GitHub → Packages → each → Package settings → Change visibility).
2. `.sops.yaml` lists the VM's age public key and `prod.enc.env` has a real value for every key under "Stored in prod.enc.env" in `infra/compose/prod.env.example`, including `CLOUDFLARE_TUNNEL_TOKEN` and `GITHUB_RUNNER_TOKEN`. `make secrets-check` on the laptop reports `secrets look ready`.
3. `sudo /opt/portfolio/scripts/sync-repo.sh` (checks out `main` and keeps the checkout owned by the runner uid 1001)
4. `sudo IMAGE_TAG=latest INCLUDE_RUNNER=1 SMOKE_PUBLIC_URL=https://christopherguzman.me /opt/portfolio/scripts/deploy.sh`
5. GitHub → Settings → Actions → Runners shows `portfolio-vm` (Idle).
6. GitHub → Settings → Secrets and variables → Actions → Variables → `DEPLOY_ENABLED` = `true`.

## Normal deploys

Merge to `main`. `release.yml` builds, scans and pushes images, then the `deploy` job runs `scripts/deploy.sh` with `IMAGE_TAG=<commit sha>` on the VM's runner and smoke-tests locally and through `https://christopherguzman.me`.

## Roll back

```bash
sudo IMAGE_TAG=<previous good sha> /opt/portfolio/scripts/deploy.sh
```

If a migration shipped between the two versions, skip the migration step (the older image cannot find the newer revision recorded in the database):

```bash
sudo IMAGE_TAG=<previous good sha> SKIP_MIGRATIONS=1 /opt/portfolio/scripts/deploy.sh
```

Rolling back to an image from before Phase 3 (no CMS content) also needs `SKIP_CONTENT_SMOKE=1`, or the smoke test's content checks fail:

```bash
sudo IMAGE_TAG=<pre-Phase-3 sha> SKIP_CONTENT_SMOKE=1 /opt/portfolio/scripts/deploy.sh
```

The content checks also fail on purpose if the site has no CMS content to show: the profile intro is empty, or every experience role is a draft. If that is intentional, re-run the failed deploy on the VM with `SKIP_CONTENT_SMOKE=1` (same command as above with the current sha), and publish content again before the next merge.

Image tags are full commit SHAs (Actions → release → a green run). The database schema stays at the newer revision either way; a rollback across a destructive migration needs a down-migration.

## Update the runner

Dependabot bumps `infra/runner/Dockerfile`; after the release builds it:

```bash
sudo /opt/portfolio/scripts/sync-repo.sh
cd /opt/portfolio
DEPLOYED=$(docker inspect -f '{{.Config.Image}}' portfolio-api-1 | cut -d: -f2)
sudo IMAGE_TAG="$DEPLOYED" SERVICES=runner scripts/deploy.sh
```

Run it while no deploy is in progress: recreating the runner mid-job kills that job. IMAGE_TAG is the currently deployed version, so the migration step it runs is a no-op.

## Status and logs

```bash
docker ps --filter label=com.docker.compose.project=portfolio
scripts/smoke.sh
docker logs --tail 100 portfolio-api-1
```

## Content (CMS)

Edit content at https://cms.christopherguzman.me (Cloudflare Access, then the Directus login). Collections: `profile`, `experience`, `education`, `involvement`, `certifications`, `projects`, `posts`, `resume`.

- **Only `published` items appear on the site.** Drafts are never shown: every read filters `status = published`.
- **Saving any item refreshes the site.** The revalidation Flow posts the collection name to `http://web:3000/api/revalidate`, which expires that collection's cached data immediately (`revalidateTag(collection, { expire: 0 })`), so the next visit to an affected page renders the new content. Every cached read also expires after 24 hours as a backstop.
- **Seed content and deletes.** Every deploy runs the CMS bootstrap (`==> CMS bootstrap` in the deploy log). It seeds a collection (from `infra/directus/seed/`) only while that collection is completely empty and never changes existing items, so CMS edits and individual deletes survive deploys. Deleting **every** item in a collection, however, makes it empty, and the next deploy re-seeds it. To clear a section from the site, **set its items to `draft` instead of deleting them.**
- **First Phase 3 deploy.** The bootstrap runs after the containers start, so on the very first deploy that adds the CMS collections the site can briefly serve empty sections (or fallback values) until the bootstrap finishes and the Flow refreshes the cache. Later deploys are unaffected.
- **Images in project or post bodies.** Upload the file in Directus and insert it into the markdown. The site rewrites `/assets/<id>` to `/cms-assets/<id>` and serves a file only while published content references it. Files are served with a 1-year immutable cache, so to change an image **upload a new file** and point the markdown at it; never use Directus "Replace file" on an existing asset (visitors and Cloudflare would keep the old bytes).
- **Markdown headings start at `##`.** The page title is the page's only `h1`, so project and post bodies use `##` and below.
- **Resume.** Export a copy of the resume **without the phone number** (the repo and site are public; never commit the PDF). In Directus open the `resume` singleton, upload the PDF into `file`, set `version_label` (e.g. `fall-2026`) and `updated_at`, save. `/resume` then shows the PDF and the Download button.
- **Re-run the bootstrap by hand:** on the VM it runs on every deploy; locally `make cms-bootstrap`.
- **Optional hardening:** `/api/revalidate` is only ever called by Directus over the Docker network (`http://web:3000`), so a Cloudflare WAF custom rule that blocks `christopherguzman.me/api/revalidate` at the edge removes the public endpoint entirely. The route already rejects requests without the secret (401, not logged).

## Contact messages

- Messages are saved before any email is sent. The API retries failed or stuck sends every 5 minutes, up to 5 attempts.
- Read recent messages on the VM:

  ```bash
  docker exec -it portfolio-postgres-1 psql -U postgres -d portfolio -c "select created_at, name, email, email_status, attempts, last_error from contact_submissions order by created_at desc limit 20;"
  ```

- Retry one that gave up (after fixing the cause, e.g. a new Resend key):

  ```bash
  docker exec -it portfolio-postgres-1 psql -U postgres -d portfolio -c "update contact_submissions set attempts = 0, updated_at = now() - interval '6 minutes' where id = '<id>';"
  ```

  The next retry run (within 5 minutes) sends it.
- Until `TURNSTILE_SECRET_KEY` and `TURNSTILE_SITE_KEY` are set, `/contact` shows "Contact form coming soon" and the API answers `503 contact_unavailable`. Without `RESEND_API_KEY` or `CONTACT_TO`, messages are saved and wait as `pending`.

## GitHub activity

The API refreshes the contribution calendar when it is an hour old (checked every 10 minutes). If GitHub fails, the last copy keeps showing. Without `GITHUB_ACTIVITY_TOKEN` the home page hides the section only if nothing was ever cached: once a calendar has been fetched, removing or revoking the token keeps serving that last copy indefinitely. To hide the section after removing the token, delete the cached row:

```bash
docker exec -it portfolio-postgres-1 psql -U postgres -d portfolio -c "delete from github_activity_cache;"
```

Check it with:

```bash
curl -s https://api.christopherguzman.me/v1/github/activity | head -c 200
```

## Ask about Chris (chat)

- **Switch on/off:** Directus → Chat Settings → `enabled`. Off hides the launcher within seconds (Flow revalidation) and the API refuses new questions within a minute. Suggested questions are edited in the same place (the first four are shown).
- **Re-index now:** `make reindex` on the VM. Publishing in Directus already triggers one (the Flow's `reindex` step, debounced 5 s), and one runs nightly and at API startup.
- **Read chats:** `make chats` (last 7 days) or `DAYS=30 make chats`. Outcomes: `answered`, `no_match` (nothing relevant, model not called), `uncited` (model answered without citing; the visitor saw the fixed reply, the raw answer is shown here), `error` (Groq failed). Chats are deleted after 30 days.
- **Check answer quality:** `make chat-eval` (~10 minutes, uses about a third of the day's Groq quota). Every line should be PASS; a FAIL shows the answer and why.
- **Budget:** 180,000 tokens per UTC day (`API_CHAT_DAILY_TOKEN_BUDGET`); when spent, the terminal says chat is resting until tomorrow.
- **Switch provider:** add a class implementing `ChatModel` (`apps/api/src/portfolio_api/clients/groq.py` shows the shape), select it in `main.py`, add its key to secrets.

## Rotate secrets

- **A database password:** `make secrets-edit` on the laptop, commit, merge; the next deploy applies it. Postgres role passwords also need `ALTER ROLE … PASSWORD` inside the database.
- **Directus admin password (`DIRECTUS_ADMIN_PASSWORD`):** Directus reads `DIRECTUS_ADMIN_EMAIL` / `DIRECTUS_ADMIN_PASSWORD` only at first install; afterwards the CMS bootstrap uses them to log in on every deploy. Rotate in this order: (1) change the password in the Directus UI (user menu → your account), (2) `make secrets-edit` to set the same value in `prod.enc.env`, commit, merge, (3) the deploy picks it up. Changing only the env (or only the UI) makes the bootstrap fail with `admin login rejected (401): ... no longer match the live Directus admin user`; fix it by making `prod.enc.env` match the current admin login and redeploying. Keep **2FA off** on this admin account: the bootstrap logs in with email and password only, so enabling 2FA breaks every deploy. (If 2FA is ever wanted, the future option is a static admin token for the bootstrap instead of a password login.)
- **`DIRECTUS_WEB_TOKEN` or `REVALIDATE_SECRET`:** generate a value with `openssl rand -hex 32`, `make secrets-edit`, `make secrets-check`, commit, merge. The deploy recreates `web` with the new value and the CMS bootstrap updates the `web-reader` user's token and the revalidation Flow's secret header to match.
- **`GROQ_API_KEY`, `DIRECTUS_API_TOKEN`, `INTERNAL_API_SECRET`:** change in `make secrets-edit`, push; the next deploy syncs the Directus token and the Flow secret. **`CHAT_HASH_SALT`:** changing it only means existing sessions stop matching their visitors (they get "session ended").
- **Tunnel token:** Zero Trust → Tunnels → `portfolio` → Refresh token; update `CLOUDFLARE_TUNNEL_TOKEN`; deploy.
- **Runner PAT (expires yearly):** create a new portfolio-runner token, update GITHUB_RUNNER_TOKEN with make secrets-edit, merge, then run the "Update the runner" commands. Normal deploys never restart the runner, so they do not apply this value.
- **Resend API key:** create a new key in Resend, `make secrets-edit` to set `RESEND_API_KEY`, merge, then delete the old key in Resend.
- **Turnstile keys:** rotate the secret in the Turnstile widget settings, update `TURNSTILE_SECRET_KEY` (and `TURNSTILE_SITE_KEY` if it changed) with `make secrets-edit`, merge.
- **GitHub activity token (expires yearly):** create a new fine-grained token (public repositories, read-only), set `GITHUB_ACTIVITY_TOKEN` with `make secrets-edit`, merge.
- **Contact inbox:** change `CONTACT_TO` (e.g. after graduation) with `make secrets-edit`, merge.
- **Age keys:** generate a new key, add it to `.sops.yaml`, `sops updatekeys infra/compose/prod.enc.env`, remove the old recipient, `updatekeys` again.

## Outage checklist

1. Site shows "Back shortly": the fallback Worker is covering. Check the VM is up (Proxmox UI) and `docker ps` on it.
2. `Error 1033`: cloudflared is not connected. `docker logs portfolio-cloudflared-1`.
3. After a Proxmox host reboot, VM 400 starts first (`startup order=1`) and every container restarts on its own (`restart: unless-stopped`).

## Recovery

A VM reboot restarts everything. The runner re-registers on its own: its entrypoint clears the stale local runner config before registering again.
