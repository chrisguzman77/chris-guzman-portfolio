# Content drafts: publishing guide

Drafts for Phase 7b. Edit them here, then paste them into Directus.

1. **Upload diagrams.** In Directus → File Library, upload each `content/diagrams/*.png`. Copy each file's ID.
2. **Swap the diagram references.** In each draft, replace `DIAGRAM:<name>.png` with `/assets/<file-id>`. The site rewrites `/assets/` to `/cms-assets/`.
3. **Project pages.** For each project in `content/projects/`, open the item in Directus → Projects and paste `summary` and the body (everything below the front matter) into Body. Set every front-matter field that differs from the current item (`summary`, `repo_url`, `live_url`, `date`, `tech`). Save.
4. **Blog post.** Directus → Posts → create with `title`, `slug`, `excerpt`, `tags` and `published_at`, Body = the markdown below the front matter, status Published.
5. **Newsletter test send.** After publishing, run the post's "Email to subscribers" Flow with "Send a test to me only" ticked, then again unticked to send for real. See `docs/runbook.md` (Newsletter).
6. **FAQ.** It's seeded automatically on the deploy that adds it. Edit it later in Directus → Faq.
7. **Before pasting.** Search the drafts for `[CHRIS:` and resolve every marker (`grep -rn '\[CHRIS:' content/posts content/projects`).
8. **Diagrams follow your answers.** The diagrams have no markers. If an answer changes what a diagram shows (for ACM@AU: Access on /admin, the challenge system and judge, Redis), edit the matching `content/diagrams/*.svg` and its image alt text, then re-run `node scripts/export-diagrams.mjs` before uploading the PNG.
9. **Live diagrams (optional).** In any post or project body, a fenced block that starts with ` ```mermaid ` renders as a diagram on the site and follows light/dark mode. If it can't render (a syntax error, or JavaScript is off), readers see the diagram source as a code block instead. Syntax: https://mermaid.js.org/intro/syntax-reference.html.
