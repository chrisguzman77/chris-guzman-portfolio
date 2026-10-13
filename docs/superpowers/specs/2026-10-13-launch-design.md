# Phase 7c: launch

Decisions made by Chris on 2026-10-13. This is the last phase of the master plan (`docs/superpowers/specs/2026-09-16-portfolio-design.md`, Phase 7 items 6–7).

## Already in place (no work)
- **Discovery:** sitemap, robots, OG images (root, posts, projects), per-page metadata, JSON-LD Person, RSS.
- **Umami events:** `resume-download`, `chat-open`, `chat-question`, `contact-sent`, `newsletter-subscribe`, `outbound-click`.
- **Content:** published, with no `[CHRIS:]` markers left.
- **Repo:** public, MIT license.

## Decisions

| Area | Decision |
|---|---|
| README audience | Recruiter first, then engineers. |
| Badges | CI, deploy, chat eval, live 30-day uptime. |
| Screenshots | Home page, light and dark, from the live site; the chat open as well if Turnstile allows an automated browser. |
| Search Console | Domain property, verified by a DNS TXT record that Chris adds in Cloudflare. No code. |
| Repo metadata | Description, homepage and topics, set with `gh repo edit`. |
| Release | `v1.0.0` tag and a GitHub Release on the launch merge commit, after the launch check passes. Chris sees the notes first. |

## 1. Launch PR

### README.md (rewritten)
1. **Header:**
   - name and one-line pitch;
   - live link `https://christopherguzman.me`;
   - badges, in order: CI (`ci.yml`), deploy (`release.yml`), chat eval (`chat-eval.yml`), uptime (shields endpoint badge, below), license.
2. **Screenshots:** the home page, light and dark side by side, plus the chat open if captured. Files go in `docs/images/` (PNG or WebP, each under 300 KB, with alt text).
3. **What's interesting here:** 6–8 bullets, each one sentence linking its doc or ADR:
   - self-hosted on a home Proxmox VM behind a Cloudflare Tunnel (ADR 0003, 0005/0006);
   - the RAG "Ask about Chris" chat on local embeddings and Groq, with buffered, cited answers (ADR 0008);
   - the chat's weekly answer and red-team evals, hardening and feedback, tracked in Grafana (ADR 0012, 0013);
   - static failover from an R2 snapshot through the Worker (ADR 0011);
   - CI performance budgets (JS size and Lighthouse);
   - encrypted, verified backups with a bucket lock (ADR 0010);
   - observability with Prometheus and Grafana, plus a public status card (ADR 0009);
   - security: CSP with nonces, SOPS secrets, threat model (`docs/security.md`, ADR 0004).
4. **Architecture:** one Mermaid flowchart condensed from `docs/architecture.md`. It shows: visitor, Cloudflare (Worker, Tunnel, R2 failover), VM with Compose (web, api, directus, postgres + pgvector, umami, observability, backup, runner), Groq, GitHub Actions, R2 backups. A link to `docs/architecture.md` for detail.
5. **How it works:** a short tour, one line per area, each linking its ADR (0001–0013) or doc. Areas: repo layout, CMS and content, deploys, secrets, rate limits, chat, monitoring, backups, failover, evals.
6. **Repository layout:** keep the existing Layout table.
7. **Quick start:** keep the existing commands.
8. **Docs:** links to setup, runbook, security, architecture, ADR index.

### Uptime badge endpoint (API)
- **Route:** `GET /v1/status/badge` returns the shields.io endpoint JSON: `{"schemaVersion": 1, "label": "uptime 30d", "message": "<pct>%", "color": "<c>"}`.
  - `pct` is `uptime_30d × 100`, rounded to 2 decimals.
  - `color` is `brightgreen` at ≥ 99.5, `green` at ≥ 99, `yellow` at ≥ 95, `red` otherwise.
  - When `uptime_30d` is null, the message is `n/a` and the color `lightgrey`.
- **Data:** it reuses the same service and cache as `GET /v1/status`, with no new queries. Same `Cache-Control` as status.
- **Badge URL:** `https://img.shields.io/endpoint?url=https://api.christopherguzman.me/v1/status/badge`.
- **Tests:** formatting at each color threshold, rounding, and null.

### Screenshots
- **Capture:** a small Playwright script, `apps/web/scripts/screenshots.mjs`, captures the live site at 1280×800 in each color scheme and writes to `docs/images/`. It's committed so the images can be refreshed.
- **Chat image:** it tries to open the chat. If no chat panel is visible within 10 s, it skips that image and prints why.

## 2. Launch check (Claude, against the live site, reported in the PR)
- **Lighthouse:** `/`, `/projects`, `/projects/this-portfolio`, `/blog/how-i-built-this-site`, `/contact`, on mobile and desktop. Performance, accessibility, best practices and SEO, median of 3. Bar: ≥ 95 in every category (the master plan's Phase 7 bar).
- **axe:** the same pages through Playwright, with no serious or critical violations.
- **Open Graph:** for each page, `og:title`, `og:description`, `og:image` (fetch it: 200, image type, 1200×630) and `twitter:card`.
- **Below the bar:** any page or category that misses gets a separate small fix PR before the release, or is noted with a reason if it's outside our control. Examples: Turnstile's third-party script in best practices, or home-network TTFB.

## 3. Repo metadata (Claude)
`gh repo edit` with:
- **description:** "Self-hosted portfolio: Next.js, FastAPI, Directus and a RAG chat with evals, on Proxmox behind Cloudflare";
- **homepage:** `https://christopherguzman.me`;
- **topics:** `portfolio`, `nextjs`, `fastapi`, `directus`, `rag`, `self-hosted`, `proxmox`, `cloudflare`, `docker-compose`, `grafana`.

## 4. Chris's steps
1. **Search Console:**
   1. Add a Domain property for `christopherguzman.me`.
   2. Copy the TXT value and add it in Cloudflare DNS (type TXT, name `@`).
   3. Verify.
   4. Sitemaps → submit `https://christopherguzman.me/sitemap.xml`.
2. **LinkedIn Post Inspector:** check `https://christopherguzman.me` and the blog post. Claude checks the tags first.
3. **Umami goals** (analytics.christopherguzman.me → website → Goals): `resume-download`, `chat-question`, `contact-sent`, `newsletter-subscribe`.

## 5. Release
- **When:** after the launch PR merges and the launch check passes.
- **What:** tag `v1.0.0` on the merge commit, and a GitHub Release. Its notes cover:
  - what the site is;
  - what shipped, by phase and roadmap item, with PR links;
  - the launch check results.
- Chris approves the notes before `gh release create`.

## Out of scope
- New site features.
- Changing Umami event names.
- A CHANGELOG file.
- Version bumps in `package.json` or `pyproject.toml`.

## Verification
- **README:** renders on GitHub with every badge resolving (the uptime badge shows a percentage) and the images and Mermaid diagram displaying.
- **Launch check:** results are in the PR.
- **Repo page:** shows the description, homepage and topics.
- **Search Console:** verified, with the sitemap submitted.
- **Release:** `v1.0.0` exists, with notes.
