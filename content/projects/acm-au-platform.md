---
slug: acm-au-platform
title: ACM@AU platform
summary: The ACM chapter's production site with end-to-end auth (rotating refresh tokens, TOTP 2FA) and a block-based CMS, self-hosted.
repo_url: null
live_url: [CHRIS: live URL, or remove]
award: null
date: 2026-01-01  # [CHRIS: the current repo dates from April 2026; keep Jan 2026, when you started as Lead Developer?]
tech: [sveltekit, typescript, fastapi, postgresql, docker]
---

## What it is

The production website and member platform for Augusta University's ACM chapter. Officers edit pages and events themselves in a block-based CMS, and members sign in with their own accounts. It runs on a SvelteKit/TypeScript frontend and a FastAPI/PostgreSQL backend, self-hosted on an Oracle Cloud ARM VM.

## How it works

![Architecture of the ACM@AU platform: visitors reach Cloudflare, which forwards through an outbound-only tunnel to a Docker Compose stack on an Oracle Cloud ARM VM: cloudflared, a SvelteKit frontend, a FastAPI backend, Postgres, a Redis leaderboard cache, and a Piston judge on an internal-only network](DIAGRAM:acm-au-platform.png)

[CHRIS: the diagram and this alt text show Access on /admin, the challenges, Redis and the judge; update them if your answers below change any of these (see content/README.md step 8)]

A visitor's request hits Cloudflare first, which handles TLS and DNS and can put Cloudflare Access in front of the admin area. [CHRIS: is Access on /admin live?] From there it travels through a Cloudflare Tunnel that the VM opens outbound, so the server has no open inbound ports.

Inside the VM, everything runs in Docker Compose. The SvelteKit app is the frontend and a backend-for-frontend: the browser only talks to it, with same-origin cookies, and it calls the FastAPI backend. FastAPI handles auth, the CMS and the coding challenges, and stores users, pages and results in Postgres.

The platform also runs a daily coding challenge. FastAPI sends each submission to a self-hosted Piston judge, a code-execution sandbox, and stores the verdict in Postgres. Leaderboards are cached in Redis. [CHRIS: keep or cut the challenge system?]

A nightly job backs up the database and uploaded media, checks each archive, and keeps 14 days.

## Decisions worth noting

- **Short-lived access tokens, rotating refresh tokens.** The access token lives about five minutes in an httpOnly cookie, never in localStorage. Refresh tokens are stored hashed and rotate on every use. Each one belongs to a family: a replay within 30 seconds is treated as two tabs racing, and a later replay revokes the whole family as likely theft. The trade-off: a stolen access token works for up to five minutes. Logins also get Argon2 hashing, TOTP 2FA, email verification, and a step-up mode where admins re-enter their password (and TOTP) for 30 minutes of elevated access.
- **The judge is the one privileged container, so it's boxed in.** It sits on an internal-only network with no public port, job networking is off, and each run is capped on memory, time and processes. The official Piston image is amd64-only, and both production and my Apple Silicon dev machine are ARM, so I build it from pinned source with an ARM64 package path.
- **Started without Redis, added it when leaderboards needed it.** I first decided against Redis, then added it when the daily-challenge leaderboards justified it. [CHRIS: why you first ruled out Redis] It is cache only: a miss rebuilds from Postgres.
- **Validated CMS blocks.** Each page is an ordered list of typed blocks with separate draft and published copies. The API validates every block on every write, and owner and editor permissions are checked server-side per request.

## Results

- Hosted on Oracle's Always Free tier (2 OCPU, 12 GB ARM VM); the only recurring cost is the domain, about $10 a year.
- 162 commits, 27 database migrations, and more than 500 backend test functions, with CI running linting, type checks, tests and dependency audits.

[CHRIS: usage numbers? e.g. registered members, officers editing in the CMS, challenge participants, uptime]

## My part

I'm the chapter's Lead Developer. I designed and built the platform, including auth end to end, and I run it in production. [CHRIS: did other students contribute code? If so, say what they built]
