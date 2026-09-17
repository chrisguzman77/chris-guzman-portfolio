# 0005 — Deploy via an ephemeral self-hosted GitHub Actions runner inside the VM

Status: accepted · 2026-09-16

## Context
The VM has no inbound ports, so CI cannot SSH in. Options: a pull-based agent (Watchtower), a webhook receiver, or a self-hosted runner.

## Decision
An ephemeral, repo-scoped runner container (label `portfolio-deploy`) runs inside the VM. The `deploy` job in `release.yml` executes only on `push` to `main` after images are built and scanned on GitHub-hosted runners. PR jobs never run on the self-hosted runner. The repository setting "require approval for all outside collaborators" is enabled.

## Consequences
- Deploy logs and status live in GitHub next to the build.
- The runner never sees long-lived secrets; it decrypts with the VM-local age key.
- Fork PRs cannot reach the runner: they are approval-gated and no PR job targets its label.
- GitHub-hosted minutes are free on this public repo; the self-hosted runner is never billed.
