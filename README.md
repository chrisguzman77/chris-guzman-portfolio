# chris-guzman-portfolio

Personal site of Christopher Guzman: experience, projects, blog, resume, and an AI chat grounded in the site's content. Self-hosted on a Proxmox VM behind a Cloudflare Tunnel.

[![ci](https://github.com/chrisguzman77/chris-guzman-portfolio/actions/workflows/ci.yml/badge.svg)](https://github.com/chrisguzman77/chris-guzman-portfolio/actions/workflows/ci.yml)
[![release](https://github.com/chrisguzman77/chris-guzman-portfolio/actions/workflows/release.yml/badge.svg)](https://github.com/chrisguzman77/chris-guzman-portfolio/actions/workflows/release.yml)

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js (App Router, TypeScript, Tailwind, shadcn) |
| `apps/api` | FastAPI service: interactions, GitHub cache, RAG chat |
| `infra/` | Compose stacks, Postgres init, Directus schema, Cloudflare, observability |
| `docs/` | [Architecture](docs/architecture.md), [ADRs](docs/adr/README.md), [setup](docs/setup.md), design spec |

## Quick start

```bash
cp infra/compose/env.example infra/compose/.env
make up        # postgres + directus + api + web
make test      # web (vitest) + api (pytest)
make lint      # eslint, tsc, prettier, ruff, pyright
```

Web: http://localhost:3000 · API docs: http://localhost:8000/docs · CMS: http://localhost:8055

## How it is built

Read the [design spec](docs/superpowers/specs/2026-09-16-portfolio-design.md) for the system design and the seven delivery phases, and the [ADRs](docs/adr/README.md) for the reasoning behind each infrastructure choice.
