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
- Resend account + domain DKIM/SPF records; Turnstile site key; GitHub PAT with `read:user`.

## Anthropic (Phase 5)
- API key for Claude Sonnet 5; set a monthly spend limit in the console.

## Cloudflare R2 (Phase 6)
- Bucket for encrypted backups with a 30-day lifecycle rule; scoped API token.
