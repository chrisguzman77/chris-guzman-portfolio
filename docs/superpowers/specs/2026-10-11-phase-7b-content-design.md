# Phase 7b: content

Decisions made by Chris on 2026-10-11. Phase 7b fills the site with content: one flagship blog post, longer project write-ups with diagrams, and a recruiter FAQ. Claude drafts, Chris edits. 7c (launch) follows.

## Decisions

| Area | Decision |
|---|---|
| Blog | One flagship post, "How I built this site". The newsletter mail-scanner bug is a section, not its own post. |
| FAQ | New Directus collection `faq`, shown on `/contact` and indexed by the "Ask about Chris" chat. Small code change. |
| Projects | OFFRes/OFFPay, Cyber Threat Lakehouse and ACM@AU expanded to about 400–600 words each, with one architecture diagram each. "This portfolio" stays short and links to the post. |
| Drafts | Markdown files under `content/` in the PR. Chris edits there, then pastes the final text into Directus. |
| Gaps | Facts the sources don't give (usage numbers, exact dates, motivation) appear as `[CHRIS: …]` prompts in the drafts. Nothing is invented. |
| OFFRes/OFFPay | Five-person team; Chris built the backend API with the wallet ledger, and the signed QR payments. The write-up says so and doesn't claim the rest. |
| ACM@AU | The repo is private: describe the architecture and decisions in prose and a diagram, with no code and no repo link. |
| Repo links | Link `chrisguzman77/OffRes` and `chrisguzman77/cyber-lakehouse` on their project pages (`repo_url`). |

## FAQ content (facts from Chris)

- Looking for: internships (for example summer 2027) and full-time roles after graduating in May 2027.
- Roles: full-stack, backend/infrastructure, data engineering, ML/data, security/cyber operations.
- Location: Augusta, GA; open to relocating anywhere in the US; remote or hybrid also fine.
- Work authorization: US citizen, no sponsorship needed.
- Also answered from existing content: degrees and graduation date, strongest stack (from the resume and projects), how to reach him (contact form, LinkedIn, resume).

## FAQ feature

- **Directus:** `faq` list collection with fields `status`, `sort`, `question` (string, required) and `answer_md` (markdown, required), added to `CONTENT_COLLECTIONS` in `infra/directus/schema.mjs`. That one change gives the reader role read access and makes edits trigger revalidation and a chat reindex.
- **Seed:** `infra/directus/seed/faq.json` holds the FAQ entries and is added to `SEED_ORDER` with seed key `question`. The collection is new and empty in production, so the next deploy fills it once; after that, Directus is where it's edited. The entries are reviewed in the PR like the other drafts.
- **Web:** `"faq"` in `lib/directus/tags.ts`; `FaqSchema` (`id`, `question`, `answer_md`); `getFaq()` sorted by `sort`. `/contact` renders a "Questions recruiters ask" section below the existing grid. Each entry is a native `<details>`/`<summary>`, with the answer through `renderMarkdown` and `<Prose>`, in the existing card style. The section is left out when the list is empty. Add an e2e fixture and an assertion in the contact test.
- **API/chat:**
  - Add `"faq"` to `LISTS`, and a `faq` field on `SiteContent`.
  - The `_faq` document builder has source type `faq`, title = question, URL `/contact`, body = answer.
  - `tests/rag/seed.py` loads `faq.json`.
  - One golden retrieval question for the FAQ ("Is Chris open to relocation?" → faq).

## Diagrams

`/cms-assets` serves raster images only (no SVG, on purpose), so each diagram is authored as SVG in `content/diagrams/` and exported to PNG at 2x with Playwright. Chris uploads the PNG to Directus and references it from the markdown. Each diagram is drawn on its own light background inside a border, so it reads in both themes. There are four: the site architecture (for the post), OFFRes/OFFPay, the Lakehouse pipeline, and ACM@AU.

## Content files

```
content/
  posts/how-i-built-this-site.md      title, excerpt, tags in front matter; ~2,000–2,500 words
  projects/offres-offpay.md           tagline + body
  projects/cyber-threat-lakehouse.md  fixes "40+ features" to 54 (repo metrics)
  projects/acm-au-platform.md
  projects/this-portfolio.md          short; links to /blog/how-i-built-this-site
  diagrams/*.svg, diagrams/*.png
  README.md                           how to paste each file into Directus, and upload diagrams
```

The post's sources are the repo itself: `docs/architecture.md`, the ADRs, `docs/security.md`, the newsletter spec and the click-to-confirm fix. It covers the architecture, self-hosting behind a Cloudflare Tunnel, CI/CD and the deploy runner, the chat, observability and backups, and the scanner bug. It should be easy to skim (short sections, one diagram) and also hold up for an engineer reading it in full.

## Out of scope

Publishing in Directus (Chris does it), the newsletter test send (Chris, after publishing), 7c launch items.

## Verification

- **FAQ code:** unit tests (web, api, directus lib), the golden retrieval test, and e2e all pass.
- **Content:** every fact traces to a source file or to Chris; every `[CHRIS: …]` marker is listed in the PR body.
- **Diagrams:** each PNG renders and stays legible at the page's width on a phone.
- **After merge:** the deploy seeds the FAQ. `/contact` shows it, and the chat answers "Is Chris open to relocation?" with a `/contact` citation.
