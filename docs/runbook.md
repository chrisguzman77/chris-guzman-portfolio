# Runbook

Production is VM 400 (`192.168.1.50`) on the Proxmox host, reached from the internet only through the Cloudflare Tunnel. Everything below runs on the VM from `/opt/portfolio` unless marked otherwise.

## First deploy (once, after bootstrap)

1. The release workflow has run on main at least once (so web, api and runner images exist), and all three GHCR packages — web, api, runner — are public (GitHub → Packages → each → Package settings → Change visibility).
2. `.sops.yaml` lists the VM's age public key and `prod.enc.env` has real values, including CLOUDFLARE_TUNNEL_TOKEN and GITHUB_RUNNER_TOKEN (make secrets-check on the laptop reports 0 still change-me).
3. `sudo git -C /opt/portfolio pull`
4. `sudo IMAGE_TAG=latest INCLUDE_RUNNER=1 /opt/portfolio/scripts/deploy.sh`
5. GitHub → Settings → Actions → Runners shows `portfolio-vm` (Idle).
6. GitHub → Settings → Secrets and variables → Actions → Variables → `DEPLOY_ENABLED` = `true`.

## Normal deploys

Merge to `main`. `release.yml` builds, scans and pushes images, then the `deploy` job runs `scripts/deploy.sh` with `IMAGE_TAG=<commit sha>` on the VM's runner and smoke-tests locally and through `https://christopherguzman.me`.

## Roll back

```bash
sudo IMAGE_TAG=<previous good sha> /opt/portfolio/scripts/deploy.sh
```

Image tags are full commit SHAs (Actions → release → a green run). Database migrations are not rolled back automatically; write a down-migration if one is needed.

## Update the runner

Dependabot bumps `infra/runner/Dockerfile`; after the release builds it:

```bash
cd /opt/portfolio && sudo git pull
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

## Rotate secrets

- **A database or Directus password:** `make secrets-edit` on the laptop, commit, merge; the next deploy applies it. Postgres role passwords also need `ALTER ROLE … PASSWORD` inside the database.
- **Tunnel token:** Zero Trust → Tunnels → `portfolio` → Refresh token; update `CLOUDFLARE_TUNNEL_TOKEN`; deploy.
- **Runner PAT (expires yearly):** create a new portfolio-runner token, update GITHUB_RUNNER_TOKEN with make secrets-edit, merge, then run the "Update the runner" commands. Normal deploys never restart the runner, so they do not apply this value.
- **Age keys:** generate a new key, add it to `.sops.yaml`, `sops updatekeys infra/compose/prod.enc.env`, remove the old recipient, `updatekeys` again.

## Outage checklist

1. Site shows "Back shortly": the fallback Worker is covering. Check the VM is up (Proxmox UI) and `docker ps` on it.
2. `Error 1033`: cloudflared is not connected. `docker logs portfolio-cloudflared-1`.
3. After a Proxmox host reboot, VM 400 starts first (`startup order=1`) and every container restarts on its own (`restart: unless-stopped`).
