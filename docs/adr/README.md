# Architecture Decision Records

One file per decision, numbered, never edited after acceptance (superseded instead).

| # | Decision |
|---|---|
| [0001](0001-monorepo.md) | Single repository for web, api, and infra |
| [0002](0002-directus-as-cms.md) | Directus as the self-hosted content system of record |
| [0003](0003-cloudflare-tunnel-direct-ingress.md) | Cloudflare Tunnel with direct ingress; no reverse proxy container |
| [0004](0004-sops-age-secrets.md) | Secrets as SOPS+age encrypted files in the repo |
| [0005](0005-self-hosted-runner-deploys.md) | Deploy via an ephemeral self-hosted GitHub Actions runner inside the VM |
