# Runbook

Production is VM 400 (`192.168.1.50`) on the Proxmox host, reached from the internet only through the Cloudflare Tunnel. Everything below runs on the VM from `/opt/portfolio` unless marked otherwise.

## First deploy (once, after bootstrap)

1. The release workflow has run on main at least once (so web, api, runner and backup images exist), and all four GHCR packages — web, api, runner, backup — are public (GitHub → Packages → each → Package settings → Change visibility).
2. `.sops.yaml` lists the VM's age public key and `prod.enc.env` has a real value for every key under "Stored in prod.enc.env" in `infra/compose/prod.env.example`, including `CLOUDFLARE_TUNNEL_TOKEN`, plus `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` for the runner (docs/setup.md, Runner GitHub App). `make secrets-check` on the laptop reports `secrets look ready`.
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

Rolling back to an image from before Phase 6 needs `SKIP_STATUS_SMOKE=1` (older APIs have no `/v1/status`) and a service list without `backup`, whose image did not exist yet. The backup container keeps running its current image:

```bash
sudo IMAGE_TAG=<pre-Phase-6 sha> SKIP_STATUS_SMOKE=1 \
  SERVICES="postgres directus api web cloudflared prometheus grafana node-exporter cadvisor blackbox-exporter umami" \
  /opt/portfolio/scripts/deploy.sh
```

Silence the `Container down` alert in Grafana before rolling back to a pre-Phase-6 image: the old API has no `/metrics`, so `up{job="api"}` drops to 0 and the alert emails after 5 minutes.

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

## Apply bootstrap changes (VM)

Bootstrap changes, such as the Docker apt origin for unattended-upgrades (backlog I9), only land when bootstrap runs; a deploy does not run it. After merging one, on the VM (idempotent):

```bash
cd /opt/portfolio && sudo ./infra/vm/bootstrap.sh
```

Once the origin is in place, unattended docker-ce upgrades restart dockerd and therefore every container. Expect a brief outage, with the fallback Worker serving the "back shortly" page.

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
- **Seed content and deletes.** Every deploy runs the CMS bootstrap (`==> CMS bootstrap` in the deploy log). It seeds each collection (from `infra/directus/seed/`) at most once, only while it is completely empty, and never changes existing items, so CMS edits and deletes survive deploys, including deleting **every** item in a collection. The hidden `bootstrap_state` singleton lists the collections already seeded (or found populated); to have a deploy seed a collection again, empty it and remove its name from `bootstrap_state.seeded` through the API as the admin user.
- **First Phase 3 deploy.** The bootstrap runs after the containers start, so on the very first deploy that adds the CMS collections the site can briefly serve empty sections (or fallback values) until the bootstrap finishes and the Flow refreshes the cache. Later deploys are unaffected.
- **Images in project or post bodies.** Upload the file in Directus and insert it into the markdown. The site rewrites `/assets/<id>` to `/cms-assets/<id>` and serves a file only while published content references it. Files are served with a 1-year immutable cache, so to change an image **upload a new file** and point the markdown at it; never use Directus "Replace file" on an existing asset (visitors and Cloudflare would keep the old bytes).
- **Check the edge caches CMS images (Cloudflare cache rule).** Pick any published image id and request it twice:

  ```bash
  curl -sI https://christopherguzman.me/cms-assets/<id> | grep -i cf-cache-status
  curl -sI https://christopherguzman.me/cms-assets/<id> | grep -i cf-cache-status
  ```

  The first may say `MISS`; the second must say `HIT`. `DYNAMIC` on both means the cache rule is missing (Cloudflare does not cache extensionless paths by default). Create it under Caching → Cache Rules: when URI Path starts with `/cms-assets/`, set "Eligible for cache" and Edge TTL to "Use cache-control header if present, bypass cache if not" (the origin sends `public, max-age=31536000, immutable`). Details in `infra/cloudflare/README.md`.
- **Images must live in Directus.** Upload them to Directus and reference them through `/cms-assets`; the CSP (`img-src 'self' data: blob:`) blocks hot-linked external images, which render as broken.
- **Markdown headings start at `##`.** The page title is the page's only `h1`, so project and post bodies use `##` and below.
- **Resume.** Export a copy of the resume **without the phone number** (the repo and site are public; never commit the PDF). In Directus open the `resume` singleton, upload the PDF into `file`, set `version_label` (e.g. `fall-2026`) and `updated_at`, save. `/resume` then shows the PDF and the Download button.
- **Re-run the bootstrap by hand:** on the VM it runs on every deploy; locally `make cms-bootstrap`.
- **Optional hardening:** `/api/revalidate` is only ever called by Directus over the Docker network (`http://web:3000`), so a Cloudflare WAF custom rule that blocks `christopherguzman.me/api/revalidate` at the edge removes the public endpoint entirely. The route already rejects requests without the secret (401); those are logged at most once per minute per process, with a count of the suppressed ones.

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

## Newsletter

- **Send a post.** Open a published post in Directus, then Email to subscribers. Send a test first (tick "Send a test to me only"); it goes to `CONTACT_TO`. Then send for real (box unticked).
- **After a real send** `emailed_at` and `emailed_count` fill in. If they stay empty, the send was partial (Resend's free plan allows 100 emails a day and 3,000 a month), and the "Newsletter send failed" alert emails you. Click the button again later; it only emails subscribers who have not got the post. A post already sent answers `already_sent`.
- **Retrying after an edit.** If you retry a partial send after editing the post's title or excerpt, Resend may refuse the retried batch for up to 24 hours (same idempotency key, different content). Send the rest after 24 hours, or avoid edits between retries.
- **Remove a subscriber.** `https://christopherguzman.me/admin/subscribers` (Cloudflare Access).
- **Secret rotation.** Rotating `INTERNAL_API_SECRET` breaks unsubscribe links in emails already sent. Those readers can still unsubscribe from any newer email, or ask Chris to remove them.
- **Umami upgrades.** After a major Umami upgrade, check the "Newsletter visits per post" panel; Umami may rename `website_event` columns.
- **Grafana history.** Subscriber trend history goes back as far as Prometheus retention (35 days). The admin page shows every sign-up date.

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

- **Switch on/off:** Directus → Chat Settings → `enabled`. Off hides the launcher within seconds (Flow revalidation) and the API refuses new questions within a minute. Suggested questions are edited in the same place (the chat shows up to four; three are seeded).
- **Re-index now:** `make reindex` on the VM. Publishing in Directus already triggers one (the Flow's `reindex` step, debounced 5 s), and one runs every 15 minutes and at API startup.
- **Read chats:** `make chats` (last 7 days) or `DAYS=30 make chats`. Outcomes: `answered`, `no_match` (nothing relevant, model not called), `uncited` (model answered without citing; the visitor saw the fixed reply, the raw answer is shown here), `error` (Groq failed). Chats are deleted after 30 days.
- **Check answer quality:** `make chat-eval` (~10 minutes, uses about a third of the day's Groq quota). Every line should be PASS; a FAIL shows the answer and why.
- **Budget:** 180,000 tokens per UTC day (`API_CHAT_DAILY_TOKEN_BUDGET`); when spent, the terminal says chat is resting until tomorrow.
- **Switch provider:** add a class implementing `ChatModel` (`apps/api/src/portfolio_api/clients/groq.py` shows the shape), select it in `main.py`, add its key to secrets.

## Monitoring and analytics

- **Dashboards:** https://grafana.christopherguzman.me (Cloudflare Access, then the Grafana login `admin` / `GRAFANA_ADMIN_PASSWORD`). Dashboards → "Portfolio overview" (site, API, chat, contact, last backup; resume downloads are in Umami) and "Host & containers" (VM CPU, memory, swap, disk; each container against its limit). Prometheus has no hostname; query it from Grafana → Explore.
- **Alerts** email `CONTACT_TO` from `alerts@christopherguzman.me`: Disk filling, Memory tight, Site down, API errors, Container down, Backup stale, Chat budget, Runner offline (runner container unseen for 15 minutes). Container down keeps firing for up to 24 h after a planned container removal (it looks back 24 h), so silence it first. They are provisioned from `infra/observability/grafana/provisioning/`; change them there, not in the UI.
- **Silence an alert** (planned work or a known issue): Grafana → Alerting → Silences → New silence. Add the matcher `alertname` = the alert's name (for example `Site down`), pick a duration, write a comment, save. It ends on its own; to end it early, open Alerting → Silences and expire it. A silence only stops the emails; the rule keeps evaluating.
- **Test alert email:** Grafana → Alerting → Contact points → the email contact point → Test.
- **Analytics:** https://analytics.christopherguzman.me (Access, then the Umami login). Custom events: `resume-download`, `chat-open`, `chat-question`, `contact-sent`, `outbound-click`. Without `UMAMI_WEBSITE_ID` the site loads no tracker. `resume-download` fires only when the PDF link on `/resume` is clicked, so its `from` is always `/resume`; read where visitors came from off the `/resume` page view's referrer in Umami.
- **Status card:** the homepage card reads `GET /v1/status` (`curl -s https://api.christopherguzman.me/v1/status`). If it shows `degraded` with every value `—`, Prometheus is usually down: `docker logs --tail 50 portfolio-prometheus-1`.

### Memory watch

The `mem_limit` caps in `infra/compose/compose.yaml` add up to about 4.7 GiB on a 4 GiB VM. That is deliberate (limits are ceilings, not reservations), but nobody has watched real use yet. For the first month after launch, open Grafana → "Host & containers" once a week, with the time range set to 7 days:

- **Container memory (working set):** the sum of all containers. Investigate when the total sustains above **3.2 GiB**.
- **VM memory and swap** and **Swap used:** investigate when swap stays above **512 MiB** for hours (a brief spike during a deploy is normal).
- **Container memory vs mem_limit:** any container at 90% or more of its limit for a day is about to be OOM-killed; raise that limit instead of lowering others.

If a threshold trips, lower caps in this order, redeploy, and re-check for a week:

1. `runner` (768m): it is idle between deploys; try 512m.
2. `prometheus` (320m): try 256m, or shorten `--storage.tsdb.retention.time`.
3. `api` (768m): the embedding model is about 300 MB resident; only lower it if the chat is off.

Never lower `grafana` below 384m (it stalls on start, see the comment in the compose file). The Memory tight alert (VM above 90% for 10 minutes) is the safety net while you watch.

## CSP and headers

The full list and the reasoning are in [security.md](security.md).

- **Check headers:** `curl -sI https://christopherguzman.me/` and `curl -sI https://api.christopherguzman.me/v1/status`. The site should show `content-security-policy` (with a nonce), HSTS, `x-content-type-options`, `referrer-policy`, `permissions-policy` and `cross-origin-opener-policy`, and no `x-powered-by`. The API shows its own five.
- **Find CSP violations:** open the page with the browser console open and look for "Refused to ..." messages. In CI, the Playwright job (`apps/web/e2e/`) fails on any CSP or axe violation, so a policy change that breaks a page fails the PR.
- **Change the policy:** edit `apps/web/src/lib/csp.ts` and update its test in the same commit. The proxy (`apps/web/src/proxy.ts`) only applies the result.
- **Keep these Cloudflare features off.** They inject scripts that the nonce policy blocks: Email Obfuscation, Rocket Loader, and Web Analytics auto-inject. If a script you did not write is blocked, check them first.
- **Yearly:** bump `Expires` in `apps/web/public/.well-known/security.txt`. A web test fails when fewer than 30 days remain, so CI will remind you.
- **Weekly proof routine:** confirm the latest `backup-verify` run is green, and during the first month check the Grafana memory watch above.

## Proxmox SSH: keys only

The Proxmox host's root login accepted a password. Switch it to keys. Keep the first session open until the end, so a mistake cannot lock you out.

1. From the laptop: `ssh-copy-id root@<proxmox>`.
2. In a second terminal, confirm key login works: `ssh -o PasswordAuthentication=no root@<proxmox> true`.
3. On the host, create `/etc/ssh/sshd_config.d/10-keys-only.conf`:
   ```
   PasswordAuthentication no
   PermitRootLogin prohibit-password
   ```
   If `sshd -T | grep -E 'passwordauthentication|permitrootlogin'` still shows the old values, another file sets them first; the first value read wins, so keep this file's name sorted ahead of it.
4. `sshd -t && systemctl reload ssh`.
5. In a new terminal, test again: key login works, and `ssh -o PubkeyAuthentication=no root@<proxmox>` is refused. Only then close the first session.

## Backups

- Every night at 03:30 (America/New_York) the `backup` container dumps the roles and the `directus`, `portfolio` and `umami` databases plus the Directus uploads, encrypts them with the backup age public key, and uploads one file to R2: `backups/YYYY/MM/DD/portfolio-<UTC time>.tar.age`. R2 locks each file for 30 days and deletes it after 31.
- **Run a backup now:** `make backup-now` on the VM. It ends with `backup: ok, <size> bytes`. Better Stack's `portfolio backup` heartbeat turns green, and Grafana's last-backup panel updates within a minute.
- **Nightly logs:** `docker logs --tail 50 portfolio-backup-1`.
- **When a backup fails:** Better Stack emails (from the `/fail` ping, or when no ping arrives within a day plus 2 hours), and Grafana's Backup stale alert fires after 36 hours. Run `make backup-now` to see the error. Usual causes: an expired or revoked R2 token (rclone reports 403), Postgres down, a full disk.
- **Weekly proof:** the `backup-verify` workflow (Sundays 09:00 UTC) restores the newest backup into a throwaway Postgres and runs `infra/backup/verify.sql`. Run it by hand after any backup change: Actions → backup-verify → Run workflow. GitHub disables scheduled workflows after 60 days without repository activity; re-enable `backup-verify` in the Actions tab if the weekly run stops appearing. The first deploy of Phase 6 trips `Backup stale` until `make backup-now` has run once.
- The decryption key is not on the VM. It is in the password manager (`portfolio backup age key`) and the GitHub secret `BACKUP_AGE_KEY`.

## Restore after disaster

Use this when the VM or its disk is lost, or the databases are damaged. It replaces the three databases and puts the backup's uploads back. Prometheus and Grafana history are not in backups and start empty.

1. If the VM is gone, rebuild and bootstrap it ([`infra/vm/README.md`](../infra/vm/README.md)), add its new age public key to `.sops.yaml` and run `sops updatekeys infra/compose/prod.enc.env`, then follow "First deploy" above. The site comes up with seed content.
2. Stop everything that writes to Postgres:

   ```bash
   docker stop portfolio-web-1 portfolio-api-1 portfolio-directus-1 portfolio-umami-1
   ```

3. Open a throwaway shell in the backup image. It gets the backup container's Postgres and R2 settings without printing them, and the uploads volume mounted writable as uid 1000 (Directus's user, which owns the uploads):

   ```bash
   docker run --rm -it --user 1000:1000 --network portfolio_default \
     --env-file <(docker exec portfolio-backup-1 env | grep -E '^(PGHOST|PGUSER|POSTGRES_PASSWORD|R2_BUCKET|RCLONE_CONFIG_R2_[A-Z_]+)=') \
     -v portfolio_directus-uploads:/uploads-restore \
     --entrypoint bash "$(docker inspect -f '{{.Config.Image}}' portfolio-backup-1)"
   ```

4. In that shell, list the newest backups and download one (use a path from the list):

   ```bash
   rclone lsf --recursive --files-only "r2:${R2_BUCKET}/backups" | sort | tail -n 5
   rclone copyto "r2:${R2_BUCKET}/backups/2026/10/03/portfolio-20261003T073012Z.tar.age" /tmp/backup.tar.age
   ```

5. Paste the private key from the password manager (the whole key file, or just its `AGE-SECRET-KEY-…` line), press Enter, then Ctrl-D:

   ```bash
   (umask 077; cat >/tmp/age.key)
   ```

6. Restore, then leave the shell:

   ```bash
   RESTORE_REPLACE=1 RESTORE_UPLOADS_DIR=/uploads-restore restore.sh /tmp/backup.tar.age /tmp/age.key
   exit
   ```

   It checks the manifest checksums, restores the roles and the three databases, extracts the uploads, runs `verify.sql`, and ends with `restore: ok`. If it stops early, fix the cause and run the same command again; `RESTORE_REPLACE=1` makes re-runs safe. Leaving the shell deletes the container, the key and the download.
7. Start the apps and check them:

   ```bash
   docker start portfolio-directus-1 portfolio-api-1 portfolio-web-1 portfolio-umami-1
   scripts/smoke.sh
   make backup-now
   ```

## Rotate secrets

- **A database password:** `make secrets-edit` on the laptop, commit, merge; the next deploy applies it. Postgres role passwords also need `ALTER ROLE … PASSWORD` inside the database.
- **Directus admin password (`DIRECTUS_ADMIN_PASSWORD`):** Directus reads `DIRECTUS_ADMIN_EMAIL` / `DIRECTUS_ADMIN_PASSWORD` only at first install; afterwards the CMS bootstrap uses them to log in on every deploy. Rotate in this order: (1) change the password in the Directus UI (user menu → your account), (2) `make secrets-edit` to set the same value in `prod.enc.env`, commit, merge, (3) the deploy picks it up. Changing only the env (or only the UI) makes the bootstrap fail with `admin login rejected (401): ... no longer match the live Directus admin user`; fix it by making `prod.enc.env` match the current admin login and redeploying. Keep **2FA off** on this admin account while the bootstrap logs in with email and password: enabling 2FA breaks every deploy. Once `DIRECTUS_BOOTSTRAP_TOKEN` is set ([setup](setup.md#directus-bootstrap-token-phase-7)), the bootstrap uses that token instead, so the password and 2FA no longer affect deploys.
- **`DIRECTUS_WEB_TOKEN` or `REVALIDATE_SECRET`:** generate a value with `openssl rand -hex 32`, `make secrets-edit`, `make secrets-check`, commit, merge. The deploy recreates `web` with the new value and the CMS bootstrap updates the `web-reader` user's token and the revalidation Flow's secret header to match.
- **`GROQ_API_KEY`, `DIRECTUS_API_TOKEN`, `INTERNAL_API_SECRET`:** change in `make secrets-edit`, push; the next deploy syncs the Directus token and the Flow secret. **`CHAT_HASH_SALT`:** changing it only means existing sessions stop matching their visitors (they get "session ended").
- **Tunnel token:** Zero Trust → Tunnels → `portfolio` → Refresh token; update `CLOUDFLARE_TUNNEL_TOKEN`; deploy.
- **Runner GitHub App key (does not expire):** to rotate, generate a new private key on the app's page, update GITHUB_APP_PRIVATE_KEY with make secrets-edit, merge, then run the "Update the runner" commands and check `docker logs portfolio-runner-1 2>&1 | grep auth:` shows `auth: github app` before deleting the old key on GitHub. Normal deploys never restart the runner, so they do not apply this value.
- **Resend API key:** create a new key in Resend, `make secrets-edit` to set `RESEND_API_KEY`, merge, then delete the old key in Resend.
- **Turnstile keys:** rotate the secret in the Turnstile widget settings, update `TURNSTILE_SECRET_KEY` (and `TURNSTILE_SITE_KEY` if it changed) with `make secrets-edit`, merge.
- **Backup age key:** `age-keygen -o backup-age.key` on the laptop. Set the new public key as `BACKUP_AGE_RECIPIENT` (`make secrets-edit`, merge), and replace `BACKUP_AGE_KEY` in the GitHub `backup-verify` environment. Keep the old private key in the password manager for 31 days after the switch: backups made before it still need it.
- **R2 tokens:** create a new token with the same scope. For the VM token, update `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` with `make secrets-edit`, merge, then `make backup-now`. For the read token, update `R2_READ_ACCESS_KEY_ID` and `R2_READ_SECRET_ACCESS_KEY` in the `backup-verify` environment and run the workflow. Then delete the old token.
- **Grafana admin password:** Grafana reads `GRAFANA_ADMIN_PASSWORD` only when its database is first created. Change it in Grafana (avatar → Profile → Change password), then set the same value with `make secrets-edit` so the record matches.
- **Better Stack heartbeat:** set the new URL as `BACKUP_HEARTBEAT_URL` with `make secrets-edit`, merge.
- **GitHub activity token (expires yearly):** create a new fine-grained token (public repositories, read-only), set `GITHUB_ACTIVITY_TOKEN` with `make secrets-edit`, merge.
- **Contact inbox:** change `CONTACT_TO` (e.g. after graduation) with `make secrets-edit`, merge.
- **Age keys:** generate a new key, add it to `.sops.yaml`, `sops updatekeys infra/compose/prod.enc.env`, remove the old recipient, `updatekeys` again.

## Outage checklist

1. Site shows "Back shortly": the fallback Worker is covering. Check the VM is up (Proxmox UI) and `docker ps` on it.
2. `Error 1033`: cloudflared is not connected. `docker logs portfolio-cloudflared-1`.
3. After a Proxmox host reboot, VM 400 starts first (`startup order=1`) and every container restarts on its own (`restart: unless-stopped`).

## Recovery

A VM reboot restarts everything. The runner re-registers on its own: its entrypoint clears the stale local runner config before registering again.
