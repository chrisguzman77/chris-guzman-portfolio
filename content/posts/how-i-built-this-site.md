---
title: How I built this site
slug: how-i-built-this-site
excerpt: Next.js, FastAPI and Directus on a home Proxmox VM behind a Cloudflare Tunnel, with a cited chat, alerts, and backups that get restored every week.
tags: [next.js, fastapi, self-hosting, cloudflare, rag, observability]
published_at: "2026-10-11"
---

This site is my portfolio, and it is also one of my projects. A resume can say "Docker, CI/CD, Postgres." I wanted a site where you can see those things working, then open the repo and check the code against what I say.

It runs on a virtual machine in my home with no open ports. A chat answers questions about me from this site's pages and cites them. Every merge to `main` is built, scanned and deployed automatically, and the data is backed up off-site every night.

I built it this way because I wanted to learn how to self-host my own application and what goes into building one, and treat the whole thing as a learning experience. I also wanted a site that builds my personal brand and shows what I'm learning and building, and maybe inspires someone to do the same.

Here is how it fits together, what I decided and why, and two things that broke.

## The shape of it

![Architecture of christopherguzman.me](DIAGRAM:site-architecture.png)

Green arrows are the request path, a dashed arrow means behind Cloudflare Access, and everything in the dashed box runs on one Proxmox VM under Docker Compose.

**Frontend (web).** Next.js renders every page on the server. Pages read content from Directus on each request, but the fetches are cached by tag, so Directus is hit only after I publish something or once a day. When I save an item in Directus, a Flow posts the collection name to the site's `/api/revalidate` route, which clears that collection's cache tag. `next build` never contacts the CMS, because CI has no route to it. Responses are checked with zod, so a malformed item is skipped and logged instead of breaking a page.

**API.** A FastAPI service (Python 3.12, Pydantic v2, SQLAlchemy 2, Alembic) handles everything interactive: the contact form, post views and reactions, the GitHub activity heatmap, the chat, and blog subscriptions. Services reach the database and outside APIs through small interfaces, so tests swap in fakes. The `/docs` page is public on purpose: the API contract is part of the showcase.

**CMS.** Directus is the content system of record. I weighed it against MDX in the repo, Sanity, Payload and Strapi. Directus needs no vendor account, and content sits with the rest of the system, so the same backups cover it. The schema is code: a bootstrap script runs on every deploy and creates any missing collections, fields, roles and Flows, but never alters or deletes. The admin UI at `cms.christopherguzman.me` is the only part reachable from outside, and it sits behind Cloudflare Access.

**Database.** One Postgres instance with pgvector holds three databases: `directus`, `portfolio` (the API's), and `umami` (analytics). Each app's role reaches only its own database, plus one read-only analytics role for Grafana; only the backup container holds the superuser password.

## Self-hosting without opening a port

The usual way to expose a home server is port forwarding, which publishes my home IP and means managing TLS on the box. I didn't want either.

Instead, a `cloudflared` container opens an outbound connection to Cloudflare. Cloudflare routes each hostname straight to a container by name: the site to `web`, `api.` to the API, `cms.` to Directus, and so on. There is no Caddy or Traefik in between, and TLS ends at Cloudflare.

The tunnel service, from `infra/compose/compose.yaml`:

```yaml
cloudflared:
  <<: *service
  image: cloudflare/cloudflared:2026.9.3@sha256:072c067d25ccbe61d46e18f0d0723255f2bb5304f7317caa95b27031520ff92c
  command: ["tunnel", "--no-autoupdate", "--metrics", "0.0.0.0:2000", "run"]
  environment:
    TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN:?}
  depends_on: [web, api, directus]
  # The image is distroless (no shell or wget); `ready` calls /ready, which
  # is 200 only while the tunnel has a live edge connection.
  healthcheck:
    test: ["CMD", "cloudflared", "tunnel", "--metrics", "localhost:2000", "ready"]
    interval: 30s
    timeout: 5s
    retries: 5
    start_period: 20s
  mem_limit: 128m
```

The Compose file publishes no host ports, and the VM's firewall denies all inbound traffic except SSH from my LAN.

One way in also simplifies trust. Every request through the tunnel carries a `CF-Connecting-IP` header, so the API can rate-limit on it. The reverse holds too: `/internal/*` and `/metrics` return 404 to any request with that header, so only containers on the VM reach them.

The admin tools (`cms.`, `grafana.`, `analytics.`) are each behind a Cloudflare Access app with a one-time PIN, and then the app's own login.

The trade-off: losing the tunnel or my home internet means losing the site. A Cloudflare Worker serves a "back shortly" page, and Better Stack checks from outside and alerts me. There is no failover; restoring from backup is the recovery plan.

**Secrets.** The stack needs around twenty secrets. GitHub's secrets are write-only and awkward for whole env files, so they live in the repo as an env file encrypted with SOPS and age, readable by my laptop's key and the VM's key. A deploy decrypts it into a private temp file that is deleted on exit. A pre-commit hook and a CI check both reject plaintext env files, and `make secrets-check` catches placeholders. Diffs show which keys changed, never the values. The only unencrypted secrets on the VM and my laptop are their age private keys.

## Shipping

Every pull request runs CI on GitHub-hosted runners, with path filters so an API change doesn't rebuild the web app.

- **Web:** lint, type check, formatting, 545 unit tests, a production build, then 26 Playwright tests across phone and desktop against the built app with a fake API and fake CMS. The Playwright run fails on any console error, any Content Security Policy violation, or any axe accessibility violation. It ends by building the Docker image.
- **API:** ruff, pyright, Alembic migrations plus `alembic check` (which fails if the models and migrations disagree), 343 pytest tests against a real Postgres with pgvector, and an image build.
- **Infra:** Compose and monitoring config checks, and a round-trip test of the backup and restore scripts.

A merge to `main` triggers the release workflow. It builds four images (web, api, the deploy runner, and backup), scans each with Trivy, and fails on any critical vulnerability that has a fix available. Images go to GitHub's container registry, tagged with the full commit SHA.

Deploying was the interesting part. With no inbound ports, CI can't SSH in. The options were a pull-based agent like Watchtower, a webhook receiver, or a self-hosted GitHub Actions runner inside the VM. I chose the runner, so deploy logs sit in GitHub next to the build.

The runner is a service in the same Compose file. It is ephemeral: it registers, runs one job, and exits, and Compose restarts it for the next one. A deploy checks out the exact released commit on the VM and runs `scripts/deploy.sh` with that SHA. The script decrypts secrets, pulls images, runs migrations, starts everything and waits for health checks, applies the Directus bootstrap, and smoke-tests the site locally and through `https://christopherguzman.me`.

The runner mounts the Docker socket, which makes it root-equivalent on the VM. ADR 0006 says so plainly. The mitigations: it is repo-scoped and ephemeral, the deploy job only runs for `main`, only I have write access, and fork pull requests need my approval.

Every deployed version is an immutable image tag, so rolling back is one command: `deploy.sh` with `IMAGE_TAG` set to the previous good SHA. The catch is the database: the schema stays at the newer migration, so rolling back across a destructive one needs a down-migration.

## Ask about Chris: the chat

Press ⌘K (or Ctrl K) anywhere and a terminal slides up. Ask it about my experience, projects or skills; it answers only from published content and cites its pages.

**Indexing.** The API turns every published Directus item and my resume PDF into markdown, splits it into chunks of about 260 words, and embeds each chunk with `bge-small-en-v1.5`. The model runs on CPU inside the API and is baked into the image, so there is no second AI vendor. Chunks go into Postgres with a pgvector column and a full-text column. Syncs compare content hashes, so running one twice embeds nothing. A sync runs after every publish, every 15 minutes, and by hand.

**Retrieval.** A question runs two searches: the top 20 chunks by vector similarity and the top 20 by full-text search. Reciprocal rank fusion merges them, and the top 5 are kept, at most 2 from any one page. If even the best match is not similar enough, the model is never called and the visitor gets a fixed reply.

**Generation.** The original plan used Claude with streamed answers. I switched to Groq's free tier (`openai/gpt-oss-120b`) because it costs nothing and Groq states it does not train on API data. The model sits behind a small `ChatModel` interface, so moving to another provider is a new class and a config change.

Answers are buffered, not streamed. The API checks that the full answer cites at least one source and that every citation points to a source it was given. Anything else becomes the fixed reply: "I don't have information on that. You can ask Chris directly on the contact page." The cost is a second or two of waiting.

**Abuse and cost.** Opening a session needs a Cloudflare Turnstile check. Questions are capped at 500 characters and 10 per session, and each IP gets 5 messages a minute and 30 a day. A daily budget of 180,000 tokens sits just under Groq's free cap of 200,000. That is roughly 60 answers a day, after which the chat says it is resting until tomorrow. It costs $0 a month. IPs are stored only as a keyed hash, and conversations are deleted after 30 days.

**Quality gate.** Retrieval has a test in CI: a set of golden questions, each with the page it should find, run against the seed content with the real embedding model. All but one must find their page in the top 5, or CI fails. A hand-run eval also sends the real model answerable questions and ones it must refuse (off-topic requests, prompt injection) and prints every answer for me to read.

The first time I ran the eval, every answer failed: the model wrote its citations as 【1】 instead of [1], so my check threw out every answer. After I changed the check to accept both formats, 24 of 26 passed, and the two failures were the test being picky about punctuation.

## Knowing it's up

**Monitoring.** Prometheus scrapes the API, the host (node-exporter), every container (cAdvisor), and a probe of the public site (blackbox-exporter) every 30 seconds, and keeps 35 days of data. Grafana, at `grafana.christopherguzman.me` behind Access, has the dashboards and sends alert emails: disk over 80%, more than 5% of API requests failing, a container down, or a backup older than 36 hours.

I left two things out on purpose. No Loki: on a VM with 4 GiB of RAM, log search would cost several hundred MB for little benefit, so logs stay in `docker logs`. No Uptime Kuma: nothing inside the VM can report that the VM is down, so Better Stack checks from outside.

The homepage status card gets its numbers from the API, which runs fixed queries against Prometheus and caches the result for 60 seconds. Nothing from a visitor's request reaches Prometheus, which has no public hostname. Time with no probe data counts as downtime, so the uptime figure errs low.

**Analytics.** Umami counts page views without cookies or stored IP addresses. The tracker loads from the site's own `/stats/` path; the dashboard is behind Access.

**Backups.** Every night at 03:30 Eastern, a backup container dumps all three databases and the CMS uploads, writes a checksum manifest, encrypts the whole stream with age, and uploads it to Cloudflare R2. No plaintext survives outside a temp directory deleted on exit. Each successful run pings a Better Stack heartbeat, and Grafana alerts if none succeeds for 36 hours.

The backup key is not the SOPS key. The VM holds only its public half; the private key lives in my password manager and a GitHub secret, so a compromised VM cannot read old backups. A 30-day bucket lock means the VM's credentials cannot delete or overwrite recent backups either.

A backup only counts if it restores. Every Sunday, a GitHub Actions job restores the newest one into a throwaway Postgres and runs a SQL check that fails unless the content tables have rows and the API's migration table exists.

The trade-offs: up to a day of data can be lost, nothing older than 31 days can be restored, and losing the private key would make every backup unreadable.

## Things that broke

**Mail scanners confirmed a subscription nobody clicked.** The blog has email subscriptions with double opt-in: you're subscribed only after you click the link in a confirmation email. My first design had the confirm page post the token to the API from JavaScript when the page loaded. The reasoning was that link scanners fetch URLs with a plain GET and don't run scripts, so they wouldn't confirm anyone.

That was wrong. Mail security scanners such as Microsoft Safe Links open links in a real browser and run their scripts. A school inbox's scanner opened the link, the script ran, and a subscription was confirmed that no one had clicked.

I was testing the feature by subscribing with both my school and personal email, but I only clicked the link in my personal one. When I checked the subscribers page, both showed as confirmed.

The fix (commit `a3eed5c`) was to act only on a click. The confirm and unsubscribe pages now wait for a press of "Confirm subscription" or "Unsubscribe." The one-click unsubscribe that Gmail and Yahoo show (RFC 8058, where the mail provider posts to the API) didn't change. The lesson I took from it: consent has to be something a person does, and a page loading is not that.

**A form the homepage doesn't show made it slower.** After the newsletter shipped, the homepage's mobile Lighthouse score dropped from 95 to 93. The subscribe form imported a newsletter helper, which imported zod, both directly and through the contact form's email pattern. So the homepage started loading a zod chunk of about 90 KB, even when the form didn't render, because client bundles follow imports, not what shows on screen.

The fix (PR #52) moved the email pattern into a zod-free module and replaced a one-field zod parse with a hand check. A new test mocks zod to throw and imports the newsletter components, so bringing zod back breaks CI.

Measured on local production builds, mobile Lighthouse on `/`, five runs each:

| Build | Score | LCP | JS |
|---|---|---|---|
| Before the newsletter | 95 | 2.87 s | 164 KB |
| After the newsletter | 93 | 3.25 s | 256 KB |
| With the fix | 95–96 | 2.87 s | 166 KB |

The lesson: the import graph is the bundle, and a regression that is easy to miss in review deserves a test.

## What I'd do differently, and what's next

The biggest gap is availability: everything runs on one VM in my house, so a power or internet outage takes the site down. Running a second copy of the API would first need shared locking (Redis or Postgres advisory locks). I'd also like a narrower deploy path than a runner with root-level access to the VM.

## Read the code

Everything here is in the repo, including the decision records behind each choice: [github.com/chrisguzman77/chris-guzman-portfolio](https://github.com/chrisguzman77/chris-guzman-portfolio). If you have questions, or you're hiring, [get in touch](/contact).
