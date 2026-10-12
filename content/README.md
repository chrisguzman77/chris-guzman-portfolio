# Content drafts: publishing guide

Drafts for Phase 7b. Edit them here, then paste them into Directus.

1. **Upload diagrams.** In Directus → File Library, upload each `content/diagrams/*.png`. Copy each file's ID.
2. **Swap the diagram references.** In each draft, replace `DIAGRAM:<name>.png` with `/assets/<file-id>`. The site rewrites `/assets/` to `/cms-assets/`.
3. **Project pages.** For each project in `content/projects/`, open the item in Directus → Projects and paste `summary` and the body (everything below the front matter) into Body. Set `repo_url`, `date` and `tech` from the front matter. Save.
4. **Blog post.** Directus → Posts → create with `title`, `slug`, `excerpt`, `tags` and `published_at`, Body = the markdown below the front matter, status Published.
5. **Newsletter test send.** After publishing, run the post's "Email to subscribers" Flow with "Send a test to me only" ticked, then again unticked to send for real. See `docs/runbook.md` (Newsletter).
6. **FAQ.** It's seeded automatically on the deploy that adds it. Edit it later in Directus → Faq.
7. **Before pasting.** Search the drafts for `[CHRIS:` and resolve every marker (`grep -rn '\[CHRIS:' content/`).
