# Setup

Ordered checklist of every external account and machine this project needs. Each section will be expanded in the phase that uses it.

## Local development (Phase 1)
1. Install: Node 24, pnpm 11, uv, Docker Desktop, age, sops (`brew install sops age`), pre-commit (`uv tool install pre-commit`).
2. `cp infra/compose/env.example infra/compose/.env`
3. `make help` lists every target. `make up` then open http://localhost:3000, http://localhost:8000/docs, http://localhost:8055 (admin@example.com / admin).
4. `cd apps/web && pnpm install` (the prettier hook needs it) and `cd apps/api && uv sync`, then `pre-commit install`
5. Secrets: generate an age key (`age-keygen -o ~/.config/sops/age/keys.txt`) and have its public key added to `.sops.yaml`. On macOS, sops looks for the key under `~/Library/Application Support/sops/age/keys.txt`, so add `export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt"` to your shell profile (the Linux VM sets the same variable to `/etc/portfolio/age.key`). Test with `sops decrypt infra/compose/prod.enc.env | head -2`.

## Domain and Cloudflare (Phase 2)
- Buy a domain on Cloudflare Registrar; zone on Cloudflare DNS; enable Always Use HTTPS.
- Zero Trust: create a tunnel; create Access applications for `cms.`, `grafana.`, `status.`, `analytics.`.

## Proxmox VM (Phase 2)
- Ubuntu 24.04 cloud-init VM: 4 vCPU, 8 GB RAM, 60 GB disk, static LAN IP.
- Run `infra/vm/bootstrap.sh`; generate the VM age key at `/etc/portfolio/age.key`.

## GitHub (Phase 2)
- Register the self-hosted runner (label `portfolio-deploy`).
- Settings → Actions: require approval for all outside collaborators.

## Email, Turnstile, GitHub PAT (Phase 4)
- Resend account + domain DKIM/SPF records; Turnstile site key; GitHub PAT with `read:user`.

## Anthropic (Phase 5)
- API key for Claude Sonnet 5; set a monthly spend limit in the console.

## Cloudflare R2 (Phase 6)
- Bucket for encrypted backups with a 30-day lifecycle rule; scoped API token.
