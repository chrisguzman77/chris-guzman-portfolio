# Architecture Decision Records

One file per decision, numbered, never edited after acceptance (superseded instead).

| # | Decision |
|---|---|
| [0001](0001-monorepo.md) | Single repository for web, api, and infra |
| [0002](0002-directus-as-cms.md) | Directus as the self-hosted content system of record |
| [0003](0003-cloudflare-tunnel-direct-ingress.md) | Cloudflare Tunnel with direct ingress; no reverse proxy container |
| [0004](0004-sops-age-secrets.md) | Secrets as SOPS+age encrypted files in the repo |
| [0005](0005-self-hosted-runner-deploys.md) | Deploy via an ephemeral self-hosted GitHub Actions runner inside the VM |
| [0006](0006-runner-in-compose.md) | Deploy runner as a Compose service; deploys pinned to commit SHAs |
| [0007](0007-in-process-rate-limits-and-jobs.md) | In-process rate limits and background jobs; single API instance, no Redis |
| [0008](0008-rag-chat-on-groq.md) | "Ask about Chris" chat: local embeddings, Groq free tier, buffered cited answers |
| [0009](0009-monitoring-without-loki.md) | Monitoring with Prometheus and Grafana, no Loki; public status served through the API |
| [0010](0010-backup-encryption-and-bucket-lock.md) | Backups encrypted to a dedicated age key, stored in R2 with a 30-day bucket lock |
