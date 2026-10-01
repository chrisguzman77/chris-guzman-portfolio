# Phase 3: CMS content and pages, design

_Approved in brainstorming with Chris on 2026-10-01. Refines Phase 3 of [the portfolio design spec](2026-09-16-portfolio-design.md); where the two differ, this document wins. Mockups Chris approved live in the git-ignored `.superpowers/brainstorm/48612-1790881901/content/`._

## Goal

Turn the live placeholder at https://christopherguzman.me into the real site: every page rendered from Directus content, pre-filled from Chris's resume, editable by Chris without code changes, and updated on the live site within seconds of publishing.

## What changes from the master spec

| Area | Master spec | Now |
|---|---|---|
| Visual style | Clean editorial, serif display (Fraunces) | **"Engineer"**: dark-first, Geist + JetBrains Mono, mint accent, terminal details |
| Default theme | System | **Dark for first-time visitors**; toggle; choice remembered |
| Emojis | Not specified | **None anywhere**; Lucide icons; brand logos as inline SVGs |
| Projects page | Filterable by category | **No filters**; two sections, **Personal projects** then **Competitions** |
| Blog | Tags, tag pages, reading time | **No filters or tag pages**, **no reading time**, full dates with the day; section hidden until a post exists |
| Captions under page titles | Not specified | **None on any page** (the homepage intro is not a caption) |
| Collections | `category`, `reading_time_min`, `skills`, `site_settings` | Dropped; `projects.type`, `involvement`, `certifications` added |
| Typed client | Generated from Directus | Hand-written types validated with zod at the boundary |
| Nightly full revalidation | Cron | Not needed: every fetch also carries a 24 h time-based revalidate |
| Resume file | Repo copy of the PDF seeded into Directus | **Never in the repo** (it has a phone number and the repo is public). Chris uploads a phone-less PDF in the CMS |

## Visual system

- **Theme tokens** (Tailwind 4 CSS variables in `globals.css`), dark is the default class:

  | Token | Dark | Light |
  |---|---|---|
  | background | `#0d1117` | `#fbfbfa` |
  | surface (cards) | `#161b22` | `#ffffff` |
  | border | `#21262d` / `#30363d` | `#e6e8eb` / `#d0d4da` |
  | text / muted | `#e6edf3` / `#9da7b3` | `#16191d` / `#4b5563` |
  | accent | `#7ee2b8` | `#0d7a57` |
  | live (status, "current" pill) | `#3fb950` | `#15803d` |

  Contrast is checked for both themes (WCAG AA for body text).
- **Fonts** via `next/font/google`: Geist (text), JetBrains Mono (`~/chris-guzman` logo, `$ whoami`-style prompts, `01` section numbers, dates, tech tags, nav links). Fraunces and Inter are removed.
- **Icons**: `lucide-react` only. GitHub and LinkedIn logos are small inline SVG components (Lucide no longer ships brand logos). Award badge: outline Lucide `Trophy` + text in a rounded rectangle (radius 10px, padding 3px 10px) so it never clips when it wraps.
- **Theme**: `next-themes` with `defaultTheme="dark"`, `enableSystem={false}`, persisted choice; toggle in the nav (moon/sun).
- **Motion**: subtle only; everything respects `prefers-reduced-motion`.

## Layout shared by every page

- **Header**: `~/chris-guzman` (links home), then `experience · education · projects · blog · resume · contact`, then the theme toggle. Always a gap between the logo and the links. Below the `md` breakpoint the links collapse into a menu button (accessible disclosure, Escape closes and returns focus).
- **Footer**: `© <year> Christopher Guzman`, GitHub, LinkedIn, RSS icons.
- **Page header pattern**: a mono prompt (`$ cat experience.log`) above an `h1`. **No caption under any page title.**
- **404**: same layout, prompt `$ cd <path>: no such page`, links to the main pages.

## Pages

### `/` (homepage)

1. **Hero** (two columns on wide screens, photo right):
   - `$ whoami`, then **Christopher Guzman** (`h1`).
   - Intro from `profile.intro` (seeded with the approved text below).
   - Live status line (see "Live status line").
   - Row 1: **Download resume** (primary, links `/resume`), **Get in touch** (links `/contact`).
   - Row 2: **GitHub**, **LinkedIn** (open in a new tab, `rel="noopener noreferrer"`).
   - **Narrow screens**: the photo moves **between the name and the intro**, width `min(100%, 300px)`; it never shrinks beside the text.
   - Photo: existing `public/images/chris.jpg` via `next/image`, rounded, bordered.
2. **01 Featured projects**: up to 3 project cards where `featured = true`, then "all projects →".
3. **02 Experience**: compact timeline of roles where `show_on_home = true` (seeded: all five), each with dates and the "current" pill; "full history →".
4. **03 Blog**: latest 3 published posts. **The whole section is not rendered when there are no published posts.**
5. Footer.

GitHub activity (Phase 4) and "Ask about Chris" (Phase 5) are not rendered in Phase 3. No placeholders.

Approved intro text (seed value for `profile.intro`):

> I'm a CS and Cyber Operations student at Augusta University, graduating May 2027. Right now I'm a software engineering intern at AU's College of Allied Health Professions, building a 3D radiation-therapy clinic simulator in Three.js. I've also shipped full-stack and ML work as an intern and contractor, and I lead development for our ACM chapter's platform.

### `/experience`

Prompt `$ cat experience.log`, `h1` "Experience". All published roles, newest first (current roles first, then by start date). Each entry:

- **Company** (bold)
- Role (regular weight) + "current" pill when `end_date` is empty
- `Mon YYYY – Present · Location` (mono, muted): **dates first, then location**, on one line under the role
- Bullet highlights
- Tech tags (mono, accent)

No side date column. Ends with a "Download full resume" button (links `/resume`).

### `/education`

Prompt `$ cat education.md`, `h1` "Education".

- School card: graduation-cap icon, **school name** (seed: "School of Computer and Cyber Sciences, Augusta University"), location, "Expected May 2027" (or the end date once past), degrees and minors as labeled rows.
- **01 Involvement**: cards (organization, role · year, optional summary). Seed: ACM@AU, Lead Developer, 2026, "Built and run the chapter's production platform."; The Delta Chi Fraternity, Officer of Philanthropy, 2024.
- **02 Relevant coursework**: shown only when the list is non-empty.
- **03 Certifications**: shown only when at least one is published.

Section numbers renumber when a section is hidden.

### `/projects`

Prompt `$ ls projects/`, `h1` "Projects". Card grid, **no filters**, two sections in this order:

1. **01 Personal projects** (with a count, "3 projects")
2. **02 Competitions**

A section with no published projects is not rendered. Each card: award badge (when `award` is set), title, summary, tech tags; the whole card links to the detail page. Order within a section: `sort`, then newest.

### `/projects/[slug]`

Prompt `$ cat projects/<slug>.md`, title, award badge, type label, date, tech tags, repo and live links (Lucide icons), cover image, markdown write-up (images inline). Unknown or unpublished slugs return 404.

### `/blog`

Prompt `$ ls posts/`, `h1` "Blog". **No filters.** Each post: full date (`Oct 14, 2026`), title, excerpt, tags (display only), **"Read post →" button**. No reading time. Empty state: a dashed box reading `nothing yet. First post coming soon.` The nav link stays visible.

### `/blog/[slug]`

Title, then `Oct 14, 2026 · <tags>` (**full date with the day, no reading time**), "on this page" table of contents (from `h2`/`h3`, a sidebar on wide screens, hidden on narrow ones), markdown body at a ~65ch measure with syntax-highlighted code, "← all posts". Unknown or unpublished slugs return 404.

### `/blog/rss.xml`

RSS 2.0 feed of published posts (title, link, full-date `pubDate`, excerpt). Linked from the footer and via `<link rel="alternate">`.

### `/resume`

Prompt `$ open resume.pdf`, `h1` "Resume". Bar with version label, "updated <date>", and **Download PDF**. The PDF renders inline (`<object>`/`<iframe>` from `/cms-assets/<id>`) on wide screens; on narrow screens only the download button shows. If no PDF has been uploaded yet, the page shows "Resume coming soon" and links to `/experience`; the homepage "Download resume" button still links to `/resume`. Download counting arrives in Phase 4.

### `/contact`

Prompt `$ ping chris`, `h1` "Get in touch". Three cards: **Email** (`profile.email`, seed `chguzman@augusta.edu`, "Copy address" button that copies and confirms), **LinkedIn**, **GitHub** (each "Open" in a new tab). No form in Phase 3 (Phase 4 adds it). No phone number anywhere on the site.

## Live status line

`all systems operational · self-hosted on Proxmox` with a green dot, rendered by a server component that calls `GET http://api:8000/health` (2 s timeout, cached 60 s). If the call fails or `db` is not `ok`, it renders `degraded · self-hosted on Proxmox` with an amber dot. It never claims health it did not observe. In CI builds (no API) it renders the degraded state, which is never shipped because the page revalidates at runtime.

## Content model (Directus)

Every collection has `status` (`draft` | `published`, default `draft`) except singletons. The site shows **published items only**; because unlicensed Directus 12 cannot filter permissions, the web app enforces this on every query (the read token never leaves the server).

| Collection | Fields |
|---|---|
| `profile` (singleton) | `name`, `intro` (text), `email`, `location`, `github_url`, `linkedin_url`, `seo_description` |
| `experience` | `status`, `sort`, `company`, `role`, `location`, `start_date`, `end_date` (null = current), `highlights` (JSON string list), `tech` (JSON string list), `show_on_home` (bool) |
| `education` | `status`, `sort`, `school`, `location`, `end_date`, `degrees` (JSON list of `{kind: "degree"\|"minor", name}`), `coursework` (JSON string list) |
| `involvement` | `status`, `sort`, `organization`, `role`, `year`, `summary` |
| `certifications` | `status`, `sort`, `name`, `issuer`, `date`, `url` |
| `projects` | `status`, `sort`, `slug` (unique), `title`, `summary`, `body` (markdown, images inline), `type` (`personal` \| `competition`), `award` (optional text), `tech` (JSON string list), `repo_url`, `live_url`, `cover` (file), `date`, `featured` (bool) |
| `posts` | `status`, `slug` (unique), `title`, `published_at` (date), `excerpt`, `body` (markdown), `tags` (JSON string list), `cover` (file) |
| `resume` (singleton) | `file` (PDF), `version_label`, `updated_at` (date) |

### Seed content (from the resume, inserted only into empty collections)

- `profile`: name, the approved intro, email `chguzman@augusta.edu`, location Augusta, GA, GitHub and LinkedIn URLs, SEO description.
- `experience` (all published, `show_on_home = true`): AU College of Allied Health Professions (Software Engineer Intern, Aug 2026–present); Jubilee Farms (Full Stack Engineer, Contract, Mar 2026–present, Remote); ACM@AU (Lead Developer, Jan 2026–present); SteelGate LLC (AI/ML Engineer / Data Scientist Intern, Jun–Jul 2026, Hybrid); SIEGE CyberOps (GRC Analyst Intern, Jun 2025–Jun 2026). Highlights are the resume bullets, lightly shortened; tech from the resume.
- `education`: School of Computer and Cyber Sciences, Augusta University; Augusta, GA; May 2027; B.S. Computer Science, B.S. Cyber Operations, minor Mathematics; empty coursework.
- `involvement`: ACM@AU and Delta Chi as above.
- `projects`: OFFRes / OFFPay (`competition`, award "Capital One Best Financial Hack", featured); Cyber Threat Lakehouse (`personal`, featured); ACM@AU platform (`personal`, featured); This portfolio (`personal`). Bodies are short write-ups built only from resume facts.
- `posts`, `certifications`: empty. `resume`: no file (Chris uploads the phone-less PDF).

**Seeding runs on every deploy but only fills a collection while it is completely empty** (and a singleton while it has no row), so once Chris has any content in a collection, deleting, renaming, or reordering it always sticks.

## How content reaches the page

```
Chris edits in Directus ──► Directus Flow (on create/update/delete in a content collection)
                              └─► POST http://web:3000/api/revalidate  (X-Revalidate-Secret)
                                    └─► revalidateTag(<collection>) + revalidateTag(<collection>:<slug>)
Visitor ──► Cloudflare ──► Next.js serves the cached page; first request after invalidation re-renders from Directus
```

- **Reads**: `lib/directus/` fetches `http://directus:8055/items/...` server-side with the read-only token (`DIRECTUS_TOKEN`), validates every response with zod, and tags each fetch (`profile`, `experience`, `projects`, `projects:<slug>`, `posts`, `posts:<slug>`, ...) with `revalidate: 86400` as the backstop.
- **Writes trigger refresh**: any create/update/delete in a content collection calls the revalidate route (cheap; drafts are never shown because reads filter `status = published`). The route rejects requests without the correct secret (constant-time compare) and only accepts known collection names.
- **Assets**: `GET /cms-assets/[id]` streams the file from Directus with the token and `Cache-Control: public, max-age=31536000, immutable`; only file IDs referenced by published content or the resume singleton are served. Markdown bodies have `/assets/<id>` rewritten to `/cms-assets/<id>`. `cms.christopherguzman.me` stays behind Cloudflare Access.
- **No CMS at build time**: every page that reads Directus calls `connection()`, so it renders per request; the Directus responses themselves are cached by tag, so renders stay cheap and Directus sees almost no traffic. `next build` in CI must pass with no Directus and no API.
- **Markdown**: unified (remark-parse, remark-gfm, remark-rehype, rehype-sanitize, rehype-slug, rehype-pretty-code with Shiki themes matching both modes). Sanitization runs even though only Chris writes content.

## Directus bootstrap (schema as code)

`infra/directus/` holds:

- `schema.mjs`: the collections and fields above; `bootstrap.mjs` creates whatever is missing through the REST API (additive only, never alters or deletes).
- `bootstrap.mjs` (Node, runs inside the Directus container, no new image): idempotently ensures the `web-reader` policy (read published items in content collections + `directus_files`), a `web-reader` user with the static token from `DIRECTUS_WEB_TOKEN`, the revalidation Flow, and the seed content.
- `seed/*.json`: the seed content.

`scripts/deploy.sh` runs `compose exec -T directus node /directus/bootstrap/bootstrap.mjs` after `up --wait` and before the smoke test. The `directus` service mounts `infra/directus` read-only at `/directus/bootstrap`. The same commands run in dev via `make cms-bootstrap`.

## Configuration and secrets

New variables (added to `prod.env.example`, checked by `make secrets-check`):

| Variable | Used by | Value |
|---|---|---|
| `DIRECTUS_WEB_TOKEN` | directus (bootstrap), web (`DIRECTUS_TOKEN`) | `openssl rand -hex 32` |
| `REVALIDATE_SECRET` | directus Flow, web | `openssl rand -hex 32` |

web also gets `DIRECTUS_URL=http://directus:8055`, `API_INTERNAL_URL=http://api:8000`, `SITE_URL=https://christopherguzman.me` (non-secret, set in `compose.yaml`).

**Ordering constraint:** compose marks the new secrets as required, so **Chris adds both to `prod.enc.env` (`make secrets-edit`, then `make secrets-check`) before the Phase 3 PR merges**, or the deploy fails at `compose config`. The plan includes a step that stops and asks him.

## SEO

Per-page `metadata` (title template `%s · Christopher Guzman`, descriptions from content), canonical URLs from `SITE_URL`, `sitemap.ts` (static pages + published projects and posts), `robots.ts`, Open Graph images via `next/og` (one dynamic template in the site style, per project and post), JSON-LD `Person` on the homepage (`sameAs` GitHub and LinkedIn), RSS `<link rel="alternate">`.

## Errors

| Failure | Behavior |
|---|---|
| Directus down | Cached pages keep serving; revalidation fails quietly and retries on the next request; nothing shows an error page |
| Item unpublished or deleted | Its page returns the styled 404 after revalidation |
| Malformed CMS data | zod validation fails: list pages skip the bad item and log it; detail pages 404 and log it |
| API down | Status line shows `degraded`; nothing else changes |
| Whole VM down | Cloudflare fallback Worker serves "Back shortly" (Phase 2) |
| Bad revalidate secret | 401, logged, no revalidation |

## Testing

- **Unit (vitest)**: date formatting (`Oct 14, 2026`, `Aug 2026 – Present`), "current" logic, experience ordering, section numbering when sections hide, zod schemas against good and bad fixtures, markdown pipeline (sanitizes `<script>`, rewrites `/assets/` URLs, highlights code), revalidate route (401 on bad secret, 400 on unknown collection, tags revalidated on success), status-line states, cms-assets allow-list.
- **Component tests**: hero (photo order on narrow layout via class assertions), header (menu button, active link), award badge, empty states (blog, coursework, certifications, projects sections).
- **Bootstrap (node --test)**: seed planner is idempotent (second run plans zero inserts) and never plans an update to an existing item.
- **CI**: `next build` with no Directus or API; existing lint/typecheck/test gates.
- **Deploy smoke**: `scripts/smoke.sh` additionally checks that `/` contains "Christopher Guzman" and `/experience` contains a seeded company name, proving content flows from Directus end to end.
- **Manual before calling Phase 3 done**: edit a published project in the CMS and see it on the live site within ~10 s; a draft never appears; `/cms-assets/<id>` serves with the immutable header while `cms.christopherguzman.me/assets/<id>` requires Access; Lighthouse ≥ 95 on `/` and a project page in both themes, mobile and desktop.

## Execution shape

1. **Foundation** (sequential, one task each, all on branch `feat/phase-3`):
   - F1: Directus bootstrap: schema, policy/user/token, Flow, seed, deploy.sh + compose + env changes, `make cms-bootstrap`.
   - F2: Web foundation: theme tokens, fonts, dark default, header/footer/mobile menu, `lib/directus` (client, zod schemas, tagged queries), markdown pipeline, `/cms-assets/[id]`, shared components (page header, section heading, project card, award badge, experience entry, post list item, live status, brand icons, empty state, 404).
2. **Six parallel tracks** (subagents in isolated git worktrees branched from the foundation; each owns only its route files and tests and does not edit shared components; a needed shared change is reported back instead):
   - A: homepage. B: experience + education. C: projects list + detail. D: blog list + post + RSS. E: resume + contact. F: revalidate route, sitemap, robots, OG images, JSON-LD, metadata.
3. **Integration**: merge tracks into `feat/phase-3` one at a time with review and tests after each; Chris adds the two secrets; one PR to `main`; auto-deploy; manual checks above.

## Chris's tasks

1. Review this spec.
2. Before the PR merges: add `DIRECTUS_WEB_TOKEN` and `REVALIDATE_SECRET` with `make secrets-edit` (values from `openssl rand -hex 32`), run `make secrets-check`, push `chore/phase-3-secrets`.
3. After deploy: review the seeded content in the CMS, and upload the phone-less resume PDF to the `resume` singleton.

## Out of scope for Phase 3

Contact form, view counts, reactions, resume download counts, GitHub heatmap (Phase 4); "Ask about Chris" chat (Phase 5); analytics (Phase 6); Playwright end-to-end suite and the full accessibility audit (Phase 7).
