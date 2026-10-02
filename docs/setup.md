# Setup

Ordered checklist of every external account and machine this project needs. Each section will be expanded in the phase that uses it.

## Local development (Phase 1)
1. Install: Node 24, pnpm 11, uv, Docker Desktop, age, sops (`brew install sops age`), pre-commit (`uv tool install pre-commit`).
2. `cp infra/compose/env.example infra/compose/.env`
3. `make help` lists every target. `make up` then open http://localhost:3000, http://localhost:8000/docs, http://localhost:8055 (admin@example.com / admin).
3a. `make cms-bootstrap` creates the CMS collections, the read-only web token, the revalidation Flow, and the seed content in the dev Directus (safe to re-run; it seeds only empty collections and never overwrites edits). The dev `web` container reads Directus with the dev token from `compose.dev.yaml`; open http://localhost:3000/experience to see seeded content.
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
4. After the deploy: `make chat-eval` on the VM, read the report, then switch chat on in Directus (Chat Settings → enabled).

## Cloudflare R2 (Phase 6)
- Bucket for encrypted backups with a 30-day lifecycle rule; scoped API token.
