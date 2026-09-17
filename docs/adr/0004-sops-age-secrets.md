# 0004 — Secrets as SOPS+age encrypted files in the repo

Status: accepted · 2026-09-16

## Context
Around twenty secrets (DB passwords, tunnel token, API keys) must reach the VM at deploy time. GitHub Environment secrets are write-only and awkward for whole env files.

## Decision
`infra/compose/*.enc.env` are encrypted with SOPS using age recipients listed in `.sops.yaml` (laptop key + VM key). The deploy job decrypts with the VM's key at `/etc/portfolio/age.key`. A pre-commit hook rejects any plaintext env file.

## Consequences
- Secrets are versioned, diffable (keys, not values), and rotated with `sops updatekeys`.
- The only unencrypted secret anywhere is the age private key on the VM and on the laptop.
- Anyone with repo read access sees the ciphertext; that is acceptable for age-encrypted data.
