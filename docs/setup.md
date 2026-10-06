# Setup

Ordered checklist of every external account and machine this project needs. Each section will be expanded in the phase that uses it.

## Local development (Phase 1)
1. Install: Node 24, pnpm 11, uv, Docker Desktop, age, sops (`brew install sops age`), pre-commit (`uv tool install pre-commit`).
2. `cp infra/compose/env.example infra/compose/.env`
3. `make help` lists every target. `make up` then open http://localhost:3000, http://localhost:8000/docs, http://localhost:8055 (admin@example.com / admin).
3a. `make cms-bootstrap` creates the CMS collections, the read-only web token, the revalidation Flow, and the seed content in the dev Directus (safe to re-run; it seeds each collection at most once, only while it is empty, and never overwrites edits). The dev `web` container reads Directus with the dev token from `compose.dev.yaml`; open http://localhost:3000/experience to see seeded content.
4. `cd apps/web && pnpm install` (the prettier hook needs it) and `cd apps/api && uv sync`, then `pre-commit install`
5. Secrets: generate an age key (`age-keygen -o ~/.config/sops/age/keys.txt`) and have its public key added to `.sops.yaml`. On macOS, sops looks for the key under `~/Library/Application Support/sops/age/keys.txt`, so add `export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt"` to your shell profile (the Linux VM sets the same variable to `/etc/portfolio/age.key`). Test with `sops decrypt infra/compose/prod.enc.env | head -2`.

## Domain and Cloudflare (Phase 2)
- Domain `christopherguzman.me` on Cloudflare Registrar; SSL/TLS Full (strict); Always Use HTTPS.
- Tunnel, Access, fallback Worker and cache rule: see [`infra/cloudflare/README.md`](../infra/cloudflare/README.md).

## Proxmox VM (Phase 2)
- How VM 400 was built and how to bootstrap it: [`infra/vm/README.md`](../infra/vm/README.md).

## GitHub (Phase 2)
- Settings → Actions → General: require approval for all external contributors; default token permissions read-only.
- Fine-grained PAT `portfolio-runner`: this repository only, Administration read and write, 1-year expiry → `GITHUB_RUNNER_TOKEN` in `prod.enc.env`.
- GHCR packages `web`, `api`, `runner` set to public so the VM pulls without credentials.
- First deploy and turning on automatic deploys: [`docs/runbook.md`](runbook.md).

## Email, Turnstile, GitHub PAT (Phase 4)
Local development needs none of this: `compose.dev.yaml` uses Turnstile's published test keys and no Resend key (messages stay `pending`).

1. **Resend:** sign up, add domain `christopherguzman.me`, add the DNS records it lists (DKIM, SPF/MX for its sending subdomain, DMARC if not present) in Cloudflare DNS, wait for "Verified", create an API key with "Sending access" for that domain.
2. **Turnstile:** Cloudflare dashboard → Turnstile → add widget, hostnames `christopherguzman.me` and `localhost`, mode Managed. This gives a site key and a secret key.
3. **GitHub:** Settings → Public profile → enable "Include private contributions on my profile". Settings → Developer settings → fine-grained token, public repositories read-only, no extra permissions, 1-year expiry.
4. **Secrets:** `make secrets-edit` to add `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY`, `GITHUB_ACTIVITY_TOKEN`, `CONTACT_TO`; add the same keys to `infra/compose/prod.env.example`; `make secrets-check`; commit and merge.
5. **Optional:** a Cloudflare rate-limiting rule on `api.christopherguzman.me/v1/contact` as a second layer (the free plan allows one rule).

## Groq and chat secrets (Phase 5)

1. Create a free account at console.groq.com (no card), create an API key, and turn on Zero Data Retention under data controls if the free plan offers it.
2. Generate three random values on your Mac: `openssl rand -hex 32` (run it three times) for `DIRECTUS_API_TOKEN`, `INTERNAL_API_SECRET`, `CHAT_HASH_SALT`.
3. `make secrets-edit`, add `GROQ_API_KEY` and the three values, save; `make secrets-check`; commit and push. Never paste these values anywhere else.
4. After the deploy: `make reindex` on the VM (fills the index now instead of at the next 15-minute sync), then `make chat-eval`, read the report, then switch chat on in Directus (Chat Settings → enabled).

## Backups, monitoring and analytics (Phase 6)

Steps 1–7 (including the secrets push) happen before the Phase 6 code PR merges: the new compose services refuse to start without these secrets. Steps 8–10 come after it deploys.

1. **R2 bucket.** Cloudflare dashboard → R2 → Create bucket `portfolio-backups` (location Automatic). In the bucket's Settings:
   - Bucket lock rules → Add rule: prefix `backups/`, retain for 30 days.
   - Object lifecycle rules → Add rule: prefix `backups/`, delete objects 31 days after upload; abort incomplete multipart uploads after 1 day.
   Note the Account ID from the R2 overview page.
2. **Two R2 tokens.** R2 → Manage API tokens → Create API token, twice, each applied to `portfolio-backups` only:
   - `portfolio-backup-vm`, permission Object Read & Write: its Access Key ID and Secret Access Key become `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.
   - `portfolio-backup-verify`, permission Object Read only: for GitHub (step 5).
3. **Backup key.** On the Mac: `age-keygen -o backup-age.key`. It prints `Public key: age1…`, which becomes `BACKUP_AGE_RECIPIENT`. Save the whole file in the password manager as `portfolio backup age key` and as the GitHub secret `BACKUP_AGE_KEY` (step 5), then `rm backup-age.key`. The private key never goes on the VM or into `prod.enc.env`; losing it makes every backup unreadable.
4. **Better Stack heartbeat.** Better Stack → Heartbeats → Create: name `portfolio backup`, expected every 1 day, grace period 2 hours, email alerts. Its URL becomes `BACKUP_HEARTBEAT_URL` (the backup adds `/fail` itself when a run fails).
5. **GitHub environment.** Settings → Environments → New environment `backup-verify`. Add secrets `R2_ACCOUNT_ID`, `R2_BUCKET` (`portfolio-backups`), `R2_READ_ACCESS_KEY_ID`, `R2_READ_SECRET_ACCESS_KEY` (the read-only token) and `BACKUP_AGE_KEY`. Under Deployment branches and tags, choose Selected branches and tags and allow only `main`, so a pushed branch cannot read `BACKUP_AGE_KEY`. Do not add required reviewers: the scheduled weekly run would wait for approval forever. GitHub disables scheduled workflows after 60 days without repository activity; if that happens, re-enable `backup-verify` in the Actions tab.
6. **Tunnel and Access.** Zero Trust → Networks → Tunnels → `portfolio` → Public hostnames: add `grafana.christopherguzman.me` → `http://grafana:3000` and `analytics.christopherguzman.me` → `http://umami:3000`. Access → Applications: add self-hosted apps `Grafana` and `Umami` for those hostnames with the `Chris only` policy (one-time PIN), as for `cms.`. The record is in [`infra/cloudflare/README.md`](../infra/cloudflare/README.md).
7. **Secrets.** Generate `GRAFANA_ADMIN_PASSWORD` and `UMAMI_APP_SECRET` with `openssl rand -hex 32` (once each). `make secrets-edit`, add those two and `BACKUP_AGE_RECIPIENT`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `BACKUP_HEARTBEAT_URL`; commit and push. This deploys unchanged code; the current compose file ignores the new keys. `UMAMI_DB_PASSWORD` is already in `prod.enc.env`; it goes into Umami's `DATABASE_URL`, so it must be URL-safe (letters and digits, no `@ : / ? #`).
8. **After the code PR deploys.**
   - The release creates a new GHCR package, `backup`, which starts private, so the first deploy stops at `compose pull` (nothing changes on the VM). GitHub → Packages → backup → Package settings → Change visibility → Public, then re-run the failed deploy job.
   - `make secrets-check` on the laptop reports `secrets look ready`.
   - On the VM: `make backup-now` ends with `backup: ok`. Run it soon after the first deploy: until a backup succeeds, the `Backup stale` alert fires (about 15 minutes after the deploy) and emails you. Better Stack shows the heartbeat.
   - Actions → backup-verify → Run workflow: green.
   - Grafana → Alerting → Contact points → email → Test: the email arrives.
9. **Umami.** Open https://analytics.christopherguzman.me and log in as `admin` / `umami`, then change the password at once (Settings → Profile). Settings → Websites → Add website: name `portfolio`, domain `christopherguzman.me`. Copy its Website ID, add it as `UMAMI_WEBSITE_ID` with `make secrets-edit`, commit and push. The tracker appears after that deploy.
10. **Swap.** On the VM: `cd /opt/portfolio && sudo ./infra/vm/bootstrap.sh`, then `swapon --show` lists `/swapfile` (2G).

## Directus bootstrap token (Phase 7)

Optional. Until it is set, every deploy's CMS bootstrap logs in with `DIRECTUS_ADMIN_EMAIL` / `DIRECTUS_ADMIN_PASSWORD`, as before.

1. **Generate.** Directus admin UI → User Directory → your admin user → Token → Generate. Copy the value before saving the user (Directus shows it only once), then Save.
2. **Store.** `make secrets-edit`, add `DIRECTUS_BOOTSTRAP_TOKEN=<value>`, save; `make secrets-check`; commit and merge.
3. **Check.** The deploy log's `==> CMS bootstrap` step prints `auth: static token` (it printed `auth: admin password` before).
4. **Afterwards.** `DIRECTUS_ADMIN_EMAIL` / `DIRECTUS_ADMIN_PASSWORD` stay in `prod.enc.env` as Directus's first-admin settings (read only at first install), but deploys no longer use them, so changing the admin password or turning on 2FA no longer breaks deploys. To rotate the token, generate a new one in the same place and repeat step 2.

## Runner GitHub App (Phase 7)

Optional. Until both `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` are set, the runner registers with the `GITHUB_RUNNER_TOKEN` PAT, as before. One of the two (the app pair or the PAT) is required; the runner refuses to start with neither. The app replaces a PAT that expires yearly with a key that does not, and every token it mints lasts at most an hour.

1. **Create the app.** GitHub → Settings → Developer settings → GitHub Apps → New GitHub App. Name it (for example `portfolio-runner`), set the homepage URL to the repo, and untick Webhook → Active. Repository permissions: Administration read and write (the runner registration token requires it) and Metadata read-only. "Where can this GitHub App be installed?": Only on this account. Create it and note the App ID at the top of its page.
2. **Install it.** The app's page → Install App → your account → Only select repositories → `chris-guzman-portfolio`.
3. **Generate a private key.** The app's page → Private keys → Generate a private key. The browser downloads a `.pem` file.
4. **Store the secrets.** The entrypoint expects the PEM on one line with each newline written as the two characters `\n` (sops dotenv values are single-line; a real multi-line PEM also works if it ever arrives that way). Copy the converted key to the clipboard without printing it:
   ```bash
   awk 'NR > 1 { printf "\\n" } { printf "%s", $0 }' ~/Downloads/<app>.private-key.pem | pbcopy
   ```
   `make secrets-edit`, add `GITHUB_APP_ID=<app id>` and `GITHUB_APP_PRIVATE_KEY=<paste>` (unquoted, one line), save; `make secrets-check`; commit and merge. Then delete the downloaded `.pem` (GitHub can generate a new key at any time).
5. **Recreate the runner, then check.** A normal deploy never restarts the runner, so the merge alone leaves it on its old image and old env (still the PAT). Once the release from step 4 is green and no deploy is running, on the VM run the "Update the runner" commands from `docs/runbook.md`:
   ```bash
   sudo /opt/portfolio/scripts/sync-repo.sh
   cd /opt/portfolio
   DEPLOYED=$(docker inspect -f '{{.Config.Image}}' portfolio-api-1 | cut -d: -f2)
   sudo IMAGE_TAG="$DEPLOYED" SERVICES=runner scripts/deploy.sh
   ```
   Then `docker logs portfolio-runner-1 2>&1 | grep auth:` must show `auth: github app` (it showed `auth: pat` before), and the runner is listed as Idle under the repo's Settings → Actions → Runners. **Do not go on to step 6 until both checks pass**: revoking the PAT while the runner still uses it stops every deploy, including the one that would fix it.
6. **Retire the PAT.** Settings → Developer settings → Fine-grained tokens → `portfolio-runner` → Revoke. Then `make secrets-edit` to delete `GITHUB_RUNNER_TOKEN`, and in the same commit move `GITHUB_RUNNER_TOKEN` in `infra/compose/prod.env.example` from the "Stored in prod.enc.env" block to the "Optional" block so `make secrets-check` stops requiring it; commit and merge.

To rotate the key, generate a new one on the app's page, repeat step 4, recreate the runner and check its log as in step 5, and only then delete the old key there (the running container keeps the old key until it is recreated).
