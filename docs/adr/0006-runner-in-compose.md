# 0006 — Deploy runner as a Compose service, deploys pinned to commit SHAs

Status: accepted · 2026-09-29

## Context
ADR 0005 chose an ephemeral self-hosted runner inside the VM. It needs Docker access to deploy, and the stack's relative bind mounts (the Postgres init scripts) must resolve on the host, not inside the runner.

## Decision
The runner is the `runner` service in `infra/compose/compose.yaml`, built from `infra/runner/Dockerfile` (official runner image plus compose, sops and age, checksum-verified). It mounts the Docker socket, the VM age key read-only, and `/opt/portfolio` at the same path. It registers with a fine-grained PAT, runs one job, and exits; Compose restarts it for the next job. Deploys check out the exact released commit in `/opt/portfolio` and run `scripts/deploy.sh` with `IMAGE_TAG` set to that SHA. The runner is excluded from the default deploy service list. Deploys stay off until the repository variable `DEPLOY_ENABLED` is `true`.

## Consequences
- Rebuilding the VM restores the runner with the rest of the stack; no hand-installed service.
- The socket mount makes the runner root-equivalent on the VM. Mitigations: repo-scoped, ephemeral, the PAT is unset before jobs start, and the deploy job only runs for `main` (a `github.ref` check) with `DEPLOY_ENABLED` set. Any workflow could target the runner's label, so the real controls are that only the owner has write access and fork pull requests need approval.
- Every deployed version is an immutable image tag, so rollback is one command.
- The runner itself is updated deliberately (`SERVICES=runner`), never by the deploy it is running.
- The runner re-registers after restarts (VM reboot, `docker restart`): the entrypoint clears stale local config before `config.sh`.
