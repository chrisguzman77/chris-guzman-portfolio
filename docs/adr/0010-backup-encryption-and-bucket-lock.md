# 0010 — Backups encrypted to a dedicated age key, stored in R2 with a 30-day bucket lock

Status: accepted · 2026-10-03

## Context
The only copy of the site's content (Directus database and uploads), contact messages and chat logs lives on one VM on a home Proxmox host, and the Proxmox snapshot backups sit on the same host. Backups need to be off-site, unreadable to the storage provider, safe from a compromised VM or a bad script, proven restorable, and free.

## Decision
- Every night at 03:30 America/New_York: `pg_dumpall --globals-only`, `pg_dump -Fc` of `directus`, `portfolio` and `umami`, and a tar of the uploads volume, with a checksum manifest. One tar stream goes through `age` to Cloudflare R2 with `rclone`; no plaintext leaves a temp dir that is deleted on exit.
- A dedicated age key pair. The VM holds only the public key (`BACKUP_AGE_RECIPIENT`). The private key lives in Chris's password manager and in the GitHub secret `BACKUP_AGE_KEY`. It is not the SOPS key: that key lives on the VM, so it would give a compromised VM access to every old backup and would be lost along with the VM.
- R2 bucket lock for 30 days and a lifecycle rule that deletes after 31 days. The VM's token can read and write that one bucket; the lock stops it from deleting or overwriting the last 30 days. GitHub's token is read-only.
- Proof that backups work: a Better Stack heartbeat on every success (and a `/fail` ping on failure), a Grafana "Backup stale" alert after 36 h, and a weekly GitHub Actions job that restores the newest backup into a throwaway Postgres and runs `infra/backup/verify.sql`. The same `restore.sh` is the runbook's disaster procedure.

## Consequences
- Losing the private key makes every backup unreadable. GitHub secrets cannot be read back, so the password manager copy is the one that matters.
- At most one day of data is lost in a disaster, and nothing older than 31 days can be restored.
- A locked object cannot be deleted early, even by mistake. The cost is negligible at this size (well inside R2's free 10 GB, and R2 has no egress fees).
- Rotating the key means keeping the old private key for 31 days, until the last backup encrypted to it expires.
- Prometheus and Grafana data are not backed up.
