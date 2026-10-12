# Phase 7b Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a recruiter FAQ (Directus collection shown on `/contact` and indexed by the chat), and draft the flagship blog post, the expanded project write-ups and four architecture diagrams for Chris to edit.

**Architecture:**
- **FAQ collection:** `faq` is a new Directus list collection added to `CONTENT_COLLECTIONS`. That gives reader access and wires revalidation and reindex automatically. It's seeded once from `infra/directus/seed/faq.json` on the next deploy.
- **Web:** reads it with `getFaq()` and renders native `<details>` entries on `/contact`.
- **API:** adds `faq` to the content it fetches, and builds one RAG document per entry, cited as `/contact`.
- **Content:** drafts are markdown files under `content/`. Diagrams are SVG sources exported to PNG with Playwright.

**Tech Stack:**
- Directus bootstrap scripts (Node, `node:test`).
- Next.js 16 / React 19 / zod / vitest / Playwright.
- FastAPI / pytest (via `uv`).
- Markdown and hand-written SVG.

## Global Constraints

- The spec, `docs/superpowers/specs/2026-10-11-phase-7b-content-design.md`, is binding.
- FAQ fields are exactly `status`, `sort`, `question` (string, required) and `answer_md` (markdown text, required). The web schema reads only `id`, `question` and `answer_md`.
- FAQ answers are written in first person ("I'm…"), matching the profile intro. No phone numbers anywhere: the seed test and the `/contact` test both check for them.
- FAQ facts are exactly these: internships (for example summer 2027) and full-time roles after graduating in May 2027; full-stack, backend/infrastructure, data engineering, ML/data, security/cyber operations; Augusta, GA, open to relocating anywhere in the US, remote or hybrid fine; US citizen, no sponsorship needed.
- Content must not invent facts. Anything the sources don't give appears as `[CHRIS: …]`.
- **OFFRes/OFFPay:** five-person team. Chris built the backend API with the wallet ledger, and the signed QR payments. Don't claim the rest.
- **ACM@AU:** the repo is private. Prose and a diagram only: no code, no repo link, no secrets or internal hostnames.
- **Repo links:** `https://github.com/chrisguzman77/OffRes` and `https://github.com/chrisguzman77/cyber-lakehouse`.
- **Lakehouse:** the write-up says 54 features (from repo `metrics.json`), not "40+".
- `/cms-assets` stays raster-only. Diagrams ship as PNG, with SVG sources kept in `content/diagrams/`.
- Python only through `uv run`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never create, read or write `.env` files. Never run sops or `bootstrap.sh` on the Mac.

---

### Task 1: FAQ collection in Directus (schema, seed, tests, runbook)

**Files:**
- Modify: `infra/directus/schema.mjs` (`CONTENT_COLLECTIONS`; new `faq` entry after `certifications`)
- Modify: `infra/directus/bootstrap.mjs:32-40` (`SEED_ORDER`)
- Modify: `infra/directus/lib.mjs:79-86` (`seedKeys`)
- Create: `infra/directus/seed/faq.json`
- Modify: `infra/directus/lib.test.mjs:143-165`
- Modify: `apps/web/src/lib/directus/tags.ts`, `apps/web/src/lib/directus/tags.test.ts` (the web list must match `schema.mjs`; a test compares them)
- Modify: `docs/runbook.md:83` (collection list)

**Interfaces:**
- Produces: Directus collection `faq` with fields `status`, `sort`, `question`, `answer_md`. The seed file `infra/directus/seed/faq.json` (8 items) is loaded by Task 2's `tests/rag/seed.py`. The web `ContentCollection` type includes `"faq"`, which Task 3's `getList("faq", …)` requires.

- [ ] **Step 1: Update the tests first**

In `infra/directus/lib.test.mjs`, extend the seedKeys test and the seed-files loop:

```js
test("seedKeys: singletons, experience company+role, education, involvement, projects, faq", () => {
  // ...existing assertions unchanged...
  assert.equal(seedKeys.projects({ slug: "this-portfolio" }), "this-portfolio");
  assert.equal(seedKeys.faq({ question: "Do you need visa sponsorship?" }), "Do you need visa sponsorship?");
});

test("seed files: valid JSON, no phone number, unique keys", async () => {
  const phone = /\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/;
  for (const name of ["profile", "resume", "experience", "education", "involvement", "projects", "faq"]) {
    // ...body unchanged...
```

In `apps/web/src/lib/directus/tags.test.ts`, change the first test to:

```ts
  it("lists the ten content collections", () => {
    expect(CONTENT_COLLECTIONS).toEqual([
      "profile",
      "experience",
      "education",
      "involvement",
      "certifications",
      "faq",
      "projects",
      "posts",
      "resume",
      "chat_settings",
    ]);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test infra/directus/lib.test.mjs`
Expected: FAIL. `seedKeys.faq is not a function`, and the seed file is missing.

Run: `cd apps/web && pnpm vitest run src/lib/directus/tags.test.ts`
Expected: FAIL. The "ten content collections" test fails on the array mismatch.

- [ ] **Step 3: Implement**

`infra/directus/schema.mjs`: insert `"faq",` after `"certifications",` in `CONTENT_COLLECTIONS`, and add this entry right after the `certifications` collection entry:

```js
  {
    collection: "faq",
    meta: { icon: "help", sort_field: "sort" },
    fields: [
      status,
      sort,
      string("question", { required: true }),
      text("answer_md", { required: true, markdown: true }),
    ],
  },
```

`infra/directus/bootstrap.mjs`: append `"faq",` to `SEED_ORDER` after `"projects",`.

`infra/directus/lib.mjs`: add to `seedKeys`, after `projects`:

```js
  faq: (i) => i.question,
```

`apps/web/src/lib/directus/tags.ts`: insert `"faq",` after `"certifications",` in `CONTENT_COLLECTIONS`.

`docs/runbook.md` line 83: add `faq` to the collection list, following the line's existing format.

Create `infra/directus/seed/faq.json` exactly:

```json
[
  {
    "status": "published",
    "sort": 1,
    "question": "Are you looking for internships or full-time roles?",
    "answer_md": "Both. I'm open to internships (for example, summer 2027) and to full-time roles starting after I graduate in May 2027."
  },
  {
    "status": "published",
    "sort": 2,
    "question": "What roles are you interested in?",
    "answer_md": "Full-stack, backend and infrastructure, data engineering, ML and data, and security or cyber operations. My [projects](/projects) show work in each."
  },
  {
    "status": "published",
    "sort": 3,
    "question": "Where are you based, and will you relocate?",
    "answer_md": "I'm in Augusta, GA, and open to relocating anywhere in the US. Remote and hybrid roles work too."
  },
  {
    "status": "published",
    "sort": 4,
    "question": "Do you need visa sponsorship?",
    "answer_md": "No. I'm a US citizen and don't need sponsorship."
  },
  {
    "status": "published",
    "sort": 5,
    "question": "What are you studying, and when do you graduate?",
    "answer_md": "A B.S. in Computer Science and a B.S. in Cyber Operations, with a minor in Mathematics, at Augusta University. I graduate in May 2027."
  },
  {
    "status": "published",
    "sort": 6,
    "question": "What's your strongest stack?",
    "answer_md": "Python and TypeScript. FastAPI and PostgreSQL on the backend; SvelteKit, React and Next.js on the frontend; Docker and GitHub Actions to ship. For data and ML work, Spark, Delta Lake and PyTorch."
  },
  {
    "status": "published",
    "sort": 7,
    "question": "Where can I get your resume?",
    "answer_md": "On the [resume page](/resume), as a PDF you can view or download."
  },
  {
    "status": "published",
    "sort": 8,
    "question": "What's the best way to reach you?",
    "answer_md": "Send a message with the contact form, or email me. I'm also on [LinkedIn](https://www.linkedin.com/in/christopher-emmanuel-guzman/)."
  }
]
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node --test infra/directus/lib.test.mjs` → all pass.
Run: `cd apps/web && pnpm vitest run src/lib/directus/tags.test.ts` → all pass, including the `schema.mjs` comparison.
Run: `cd apps/web && pnpm exec prettier --check src/lib/directus/tags.ts src/lib/directus/tags.test.ts` → clean.

- [ ] **Step 5: Commit**

```bash
git add infra/directus/schema.mjs infra/directus/bootstrap.mjs infra/directus/lib.mjs infra/directus/lib.test.mjs infra/directus/seed/faq.json apps/web/src/lib/directus/tags.ts apps/web/src/lib/directus/tags.test.ts docs/runbook.md
git commit -m "feat(directus): faq collection, seeded once with the recruiter FAQ"
```

---

### Task 2: The chat indexes the FAQ

**Files:**
- Modify: `apps/api/src/portfolio_api/rag/documents.py` (`SiteContent` gets `faq`; new `_faq` builder; `_BUILDERS`)
- Modify: `apps/api/src/portfolio_api/clients/directus.py:17` (`LISTS`)
- Modify tests:
  - `apps/api/tests/rag/test_documents.py` (`EMPTY`, the `SiteContent(...)` in `test_project_post_involvement_certification_and_resume_urls`, a new FAQ test, the seed-count test)
  - `apps/api/tests/rag/test_indexer.py` (`SiteContent(...)` construction: add `faq=[]`)
  - `apps/api/tests/rag/seed.py` (`faq=_items("faq")`)
  - `apps/api/tests/test_directus_client.py` (`SITE` dict: `"/items/faq": []`)
  - `apps/api/tests/rag/golden.yaml` and `apps/api/tests/rag/test_golden.py` (one more question; threshold 15 of 16)

**Interfaces:**
- Consumes: `infra/directus/seed/faq.json` (Task 1). Items have `question` and `answer_md`; ids are assigned by `seed._items`.
- Produces: RAG documents with `source_type="faq"`, `source_id=str(id)`, `title=question`, `url="/contact"`, markdown `# {question}\n\n{answer_md}`.

- [ ] **Step 1: Write the failing tests**

In `tests/rag/test_documents.py`, add `faq=[],` after `certifications=[],` in `EMPTY` and in every other `SiteContent(...)` call in the file. Then add:

```python
def test_faq_document_is_cited_as_the_contact_page() -> None:
    content = replace(
        EMPTY,
        faq=[
            {
                "id": 4,
                "question": "Do you need visa sponsorship?",
                "answer_md": "No. I'm a US citizen and don't need sponsorship.",
            }
        ],
    )
    [doc] = by_type(build_documents(content), "faq")
    assert doc.source_id == "4"
    assert doc.title == "Do you need visa sponsorship?"
    assert doc.url == "/contact"
    assert doc.markdown == (
        "# Do you need visa sponsorship?\n\nNo. I'm a US citizen and don't need sponsorship."
    )
```

In `test_seed_content_builds_one_document_per_item`, add:

```python
    assert len(by_type(docs, "faq")) == 8
```

In `tests/rag/test_indexer.py`, add `faq=[],` after `certifications=[],` in the `SiteContent(...)` construction.

In `tests/test_directus_client.py` `SITE`, add `"/items/faq": [],` after `"/items/certifications": [],`.

In `tests/rag/golden.yaml`, change the header comment's "Passing threshold: 14 of 15." to "Passing threshold: 15 of 16." and append:

```yaml
- question: Is Chris open to relocation?
  expect: ["relocate"]
```

In `tests/rag/test_golden.py`: `REQUIRED_HITS = 15`.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/api && uv run pytest tests/rag/test_documents.py tests/rag/test_indexer.py tests/test_directus_client.py -q`
Expected: FAIL with `TypeError: SiteContent.__init__() got an unexpected keyword argument 'faq'`.

- [ ] **Step 3: Implement**

`rag/documents.py`, in `SiteContent`, after `certifications: list[Item]`:

```python
    faq: list[Item]
```

After `_certification`:

```python
def _faq(item: Item) -> SourceDocument:
    return _doc("faq", str(item["id"]), _text(item, "question"), "/contact", [_text(item, "answer_md")])
```

In `_BUILDERS`, after `("certifications", _certification),`:

```python
    ("faq", _faq),
```

`clients/directus.py`:

```python
LISTS = ["experience", "education", "involvement", "certifications", "faq", "projects", "posts"]
```

`tests/rag/seed.py`, in `load_seed_content`, after `certifications=[],`:

```python
        faq=_items("faq"),
```

Run `uv run ruff format` on the changed files so the `_faq` line wraps to the project's line length.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd apps/api && uv run pytest -q` → all pass, including `test_golden.py` (it needs the test Postgres the suite already uses; the README/CI setup applies).
Run: `cd apps/api && uv run ruff check . && uv run ruff format --check . && uv run pyright` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): chat indexes the recruiter FAQ, cited as /contact"
```

Rollout note, no action needed: on the deploy that ships this, the API restarts and runs its startup sync before bootstrap creates `faq`, so that one sync fails, logged as a Directus 403. The seed insert that follows fires the reindex Flow, and the 15-minute sync catches up as well. No alert covers chat index syncs.

---

### Task 3: FAQ section on /contact

**Files:**
- Modify: `apps/web/src/lib/directus/schemas.ts` (`FaqSchema`, `Faq` type)
- Modify: `apps/web/src/lib/directus/queries.ts` (`getFaq`)
- Create: `apps/web/src/components/contact/faq-section.tsx`
- Modify: `apps/web/src/app/contact/page.tsx`
- Modify: `apps/web/src/app/globals.css` (hide the WebKit disclosure marker)
- Create: `apps/web/e2e/fixtures/directus/faq.json`
- Modify tests:
  - `apps/web/src/lib/directus/schemas.test.ts`
  - `apps/web/src/lib/directus/queries.test.ts`
  - `apps/web/src/lib/directus/e2e-fixtures.test.ts`
  - `apps/web/src/app/contact/page.test.tsx`
  - `apps/web/e2e/journey.spec.ts`

**Interfaces:**
- Consumes: `"faq"` in `CONTENT_COLLECTIONS` (Task 1).
- Produces:
  - `FaqSchema` (`{ id: number; question: string; answer_md: string }`) and type `Faq`.
  - `getFaq(): Promise<Faq[]>`, sorted by `sort` and published only.
  - `FaqSection({ items }: { items: { id: number; question: string; html: string }[] })`.

- [ ] **Step 1: Write the failing tests**

`schemas.test.ts`, add inside the existing schemas `describe` (import `FaqSchema` with the others):

```ts
  it("parses an FAQ entry and rejects one without an answer", () => {
    expect(FaqSchema.parse({ id: 1, question: "Q?", answer_md: "A." })).toEqual({
      id: 1,
      question: "Q?",
      answer_md: "A.",
    });
    expect(FaqSchema.safeParse({ id: 1, question: "Q?", answer_md: null }).success).toBe(false);
  });
```

`queries.test.ts`: import `getFaq`, and add `["faq", getFaq],` to the `it.each` list next to `["certifications", getCertifications],`.

`e2e-fixtures.test.ts`: import `FaqSchema`, and add `["faq", FaqSchema],` to `LISTS`.

`app/contact/page.test.tsx`:
- Change the mock to `vi.mock("@/lib/directus/queries", () => ({ getProfile: vi.fn(), getFaq: vi.fn() }));`.
- Import `getFaq`.
- In a `beforeEach` (add `beforeEach` to the vitest import), use `vi.mocked(getFaq).mockResolvedValue([]);`.
- In `afterEach`, add `vi.mocked(getFaq).mockReset();`.
- Then add:

```ts
  it("leaves the FAQ out when there are no entries", async () => {
    vi.mocked(getProfile).mockResolvedValue(profile);
    render(await ContactPage());
    expect(screen.queryByRole("heading", { name: "Questions recruiters ask" })).toBeNull();
  });

  it("renders each FAQ entry as a disclosure with its markdown answer", async () => {
    vi.mocked(getProfile).mockResolvedValue(profile);
    vi.mocked(getFaq).mockResolvedValue([
      { id: 1, question: "Do you need visa sponsorship?", answer_md: "No. I'm a **US citizen**." },
      { id: 2, question: "Where can I get your resume?", answer_md: "On the [resume page](/resume)." },
    ]);
    const { container } = render(await ContactPage());

    expect(screen.getByRole("heading", { level: 2, name: "Questions recruiters ask" })).toBeTruthy();
    const items = container.querySelectorAll("details");
    expect(items).toHaveLength(2);
    expect(items[0].querySelector("summary")?.textContent).toBe("Do you need visa sponsorship?");
    expect(items[0].querySelector("strong")?.textContent).toBe("US citizen");
    expect(screen.getByRole("link", { name: "resume page" }).getAttribute("href")).toBe("/resume");
    expect(container.textContent).not.toMatch(/\+?\d[\d\s().-]{8,}\d/);
  });
```

Create `apps/web/e2e/fixtures/directus/faq.json`:

```json
[
  {
    "id": 1,
    "question": "Do you need visa sponsorship?",
    "answer_md": "No. I'm a US citizen and don't need sponsorship."
  },
  {
    "id": 2,
    "question": "Where can I get your resume?",
    "answer_md": "On the [resume page](/resume), as a PDF you can view or download."
  }
]
```

`e2e/journey.spec.ts`, add after the `contact: validation, then send` test:

```ts
test("contact: FAQ answers open on click", async ({ page }) => {
  await page.goto("/contact");
  await expect(page.getByRole("heading", { name: "Questions recruiters ask" })).toBeVisible();
  const answer = page.getByText("No. I'm a US citizen and don't need sponsorship.");
  await expect(answer).toBeHidden();
  await page.getByText("Do you need visa sponsorship?").click();
  await expect(answer).toBeVisible();
  await expectNoAxeViolations(page);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/web && pnpm vitest run src/lib/directus src/app/contact`
Expected: FAIL. `FaqSchema`/`getFaq` aren't exported, and the FAQ heading isn't found.

- [ ] **Step 3: Implement**

`schemas.ts`, after `CertificationSchema` (no `status`/`sort`: the query requests exactly the schema's keys):

```ts
export const FaqSchema = z.object({
  id: z.number(),
  question: z.string(),
  answer_md: z.string(),
});
```

And with the other type exports:

```ts
export type Faq = z.infer<typeof FaqSchema>;
```

`queries.ts`: add `FaqSchema` and `type Faq` to the `./schemas` import (keep alphabetical order). After `getCertifications`:

```ts
export function getFaq(): Promise<Faq[]> {
  return getList("faq", FaqSchema, "sort");
}
```

Create `apps/web/src/components/contact/faq-section.tsx`:

```tsx
import { ChevronDown } from "lucide-react";

import { Prose } from "@/components/content/prose";

// `html` must come from renderMarkdown(), which sanitizes it.
export type FaqItem = { id: number; question: string; html: string };

export function FaqSection({ items }: { items: FaqItem[] }) {
  return (
    <section aria-labelledby="contact-faq" className="mt-8">
      <h2 id="contact-faq" className="mb-3 text-[15px] font-semibold">
        Questions recruiters ask
      </h2>
      <div className="flex flex-col gap-2.5">
        {items.map((item) => (
          <details
            key={item.id}
            className="group rounded-[10px] border border-border bg-card px-4 py-3"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-sm text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand">
              {item.question}
              <ChevronDown
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                aria-hidden
              />
            </summary>
            <div className="mt-2 text-sm">
              <Prose html={item.html} />
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
```

The test checks `summary.textContent` equals the question exactly. The icon is an SVG with no text, so that holds.

`app/contact/page.tsx`:
- Import `getFaq` alongside `getProfile`, `FaqSection` from `@/components/contact/faq-section`, and `renderMarkdown` from `@/lib/markdown`.
- Replace `const profile = await getProfile();` with:

```tsx
  const [profile, faq] = await Promise.all([getProfile(), getFaq()]);
  const faqItems = await Promise.all(
    faq.map(async (item) => ({
      id: item.id,
      question: item.question,
      html: (await renderMarkdown(item.answer_md)).html,
    })),
  );
```

And after the grid's closing `</div>` (still inside the outer `max-w-5xl` div):

```tsx
      {faqItems.length > 0 ? <FaqSection items={faqItems} /> : null}
```

`globals.css`, after the `.prose-content` block:

```css
/* <details> FAQ entries draw their own chevron; hide Safari's built-in disclosure triangle. */
summary::-webkit-details-marker {
  display: none;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd apps/web && pnpm vitest run` → all pass.
Run: `cd apps/web && pnpm exec tsc --noEmit && pnpm lint && pnpm exec prettier --check .` → clean.
Run: `cd apps/web && pnpm build && pnpm exec playwright test` → all pass, including the new FAQ test on mobile and desktop.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): recruiter FAQ on /contact"
```

---

### Task 4: Architecture diagrams

**Files:**
- Create: `content/diagrams/site-architecture.svg`, `content/diagrams/offres-offpay.svg`, `content/diagrams/cyber-threat-lakehouse.svg`, `content/diagrams/acm-au-platform.svg`
- Create: `scripts/export-diagrams.mjs`
- Create (generated): `content/diagrams/*.png`

**Interfaces:**
- Produces: four PNGs, referenced by name in Tasks 5–6 (the drafts reference them as `![alt](DIAGRAM:<name>.png)`; `content/README.md` tells Chris to swap in the Directus asset URL after uploading).

**Sources (facts only from these):**
- `docs/architecture.md`, `infra/compose/compose.yaml` and `infra/cloudflared/` for the site.
- `.superpowers/sdd/phase7b/project-facts.md` for the three projects. Its node/arrow lists are the diagram contents. Draw only what's listed there.

**Style rules (every diagram):**
- `viewBox="0 0 1200 H"` (H as needed, 500–800). The root `<svg>` has `xmlns`, `width="1200"`, `height="H"`, `role="img"`, and a `<title>`.
- A full-size background `<rect>` filled `#ffffff` with a 1px `#e6e8eb` border.
- Boxes: fill `#fbfbfa`, stroke `#d0d4da`, `rx="10"`. Group/boundary boxes (Docker network, VM, Cloudflare, "team scope") use a dashed stroke `#4b5563` with a mono label.
- Text: `#16191d`, labels in `font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"`, 18–20px for box titles and 14–15px for sublabels. Technical names (ports, hostnames) in `font-family="ui-monospace, SFMono-Regular, Menlo, monospace"`.
- Accent `#0d7a57`: arrows for the main request path, and a 3px left bar on boxes for what Chris built (OFFRes/OFFPay: the backend API with the wallet ledger, and QR signing, per Global Constraints). Other arrows `#4b5563`. Arrowheads via one `<marker>` per color.
- No external fonts, images or scripts. Plain SVG elements only. No `<foreignObject>`.
- Legible on a phone: the page displays the image about 360px wide, so at 1200 wide the smallest text (14px) becomes about 4.2px there. Keep labels short; at most about 8–10 boxes per diagram.

**Content:**
- **site-architecture:**
  - Visitor → Cloudflare (DNS, WAF, cache, Access for admin hosts) → Tunnel (outbound-only) → VM boundary on Proxmox.
  - Inside the VM: cloudflared → web (Next.js) and api (FastAPI). Directus behind Access. Postgres with pgvector holding the `directus` / `portfolio` / `umami` databases. The observability box (Prometheus, Grafana, Umami). The backup job → Cloudflare R2.
  - GitHub Actions → GHCR → the self-hosted runner in the VM that deploys.
- **offres-offpay:** from the facts file, Chris's parts marked with the accent bar, and a legend line "accent = my part".
- **cyber-threat-lakehouse:** the pipeline stages from the facts file (raw → dedupe → features → models → MLflow / Unity Catalog), with the real row counts from the facts file on the arrows.
- **acm-au-platform:** the production topology from the facts file (Cloudflare Tunnel, SvelteKit, FastAPI, Postgres, Redis, the sandboxed judge on an internal-only network). No hostnames, ports, secrets or env names.

- [ ] **Step 1: Write the export script** `scripts/export-diagrams.mjs`:

```js
// scripts/export-diagrams.mjs: render content/diagrams/*.svg to 2x PNG for upload to Directus.
// Run from the repo root: node scripts/export-diagrams.mjs
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const dir = new URL("../content/diagrams/", import.meta.url);
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
for (const name of (await readdir(dir)).filter((f) => f.endsWith(".svg")).sort()) {
  const svg = await readFile(new URL(name, dir), "utf8");
  const [, w, h] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg) ?? [];
  if (!w) throw new Error(`${name}: viewBox must be "0 0 W H"`);
  await page.setViewportSize({ width: Number(w), height: Number(h) });
  await page.setContent(`<style>html,body{margin:0}svg{display:block}</style>${svg}`);
  const out = new URL(name.replace(/\.svg$/, ".png"), dir);
  await page.locator("svg").screenshot({ path: out.pathname });
  console.log(`${name} -> ${out.pathname.split("/").pop()} (${w * 2}x${h * 2})`);
}
await browser.close();
```

- [ ] **Step 2: Write the four SVGs** following the style rules and content above.

- [ ] **Step 3: Export and check**

Run: `node scripts/export-diagrams.mjs`
Expected: four lines, `<name>.svg -> <name>.png (2400xH2)`.

Then open each PNG with the Read tool and check:
- no overlapping text, every arrow lands on a box, and the labels are readable;
- each node or arrow traces to the sources listed above.

Also run `xmllint --noout content/diagrams/*.svg`. Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add content/diagrams scripts/export-diagrams.mjs
git commit -m "docs(content): architecture diagrams for the post and three projects"
```

---

### Task 5: Flagship post draft, "How I built this site"

**Files:**
- Create: `content/posts/how-i-built-this-site.md`

**Interfaces:**
- Consumes: `content/diagrams/site-architecture.png` (Task 4), referenced as `![Architecture of christopherguzman.me](DIAGRAM:site-architecture.png)`.
- Produces: slug `how-i-built-this-site`, which Task 6's "This portfolio" write-up links to as `/blog/how-i-built-this-site`.

**Format:**

```markdown
---
title: How I built this site
slug: how-i-built-this-site
excerpt: <one or two sentences, under 200 characters>
tags: [<4–6 lowercase tags, e.g. next.js, fastapi, self-hosting, cloudflare, rag>]
published_at: "[CHRIS: publish date]"
---

<body>
```

**Sources (every technical claim must trace to one):**
- `docs/architecture.md`, `docs/adr/0001`–`0010`, `docs/security.md`, `docs/runbook.md`;
- `docs/superpowers/specs/2026-09-16-portfolio-design.md` and the later phase specs (for what was decided and why);
- `docs/superpowers/specs/2026-10-07-blog-subscriptions-design.md` and commit `a3eed5c` (`git show a3eed5c --stat` and the message) for the scanner bug;
- `infra/compose/compose.yaml`, `.github/workflows/`.

Metrics only from these:
- the e2e and test counts as run now (`cd apps/web && pnpm vitest run` for the number of tests; `cd apps/api && uv run pytest -q --co | tail -1`);
- the Lighthouse numbers recorded in PR #52's body (`gh pr view 52`).

**Outline (target 2,000–2,500 words, first person, plain and specific):**
1. Intro (about 120 words): what the site is and why I built it this way: show the engineering, not just list it.
2. The shape of it: the diagram, plus one paragraph per box group (frontend, API, CMS, database).
3. Self-hosting without opening a port: Proxmox VM, Cloudflare Tunnel, Access on admin tools, secrets with SOPS + age (ADR 0003, 0004).
4. Shipping: CI on every PR, image build + scan, the ephemeral self-hosted runner deploy, rollback (ADR 0005, 0006).
5. Ask about Chris: the RAG chat. Local embeddings, pgvector hybrid search with citations, abuse limits and the daily budget (ADR 0008). Mention the retrieval quality gate (the golden questions test).
6. Knowing it's up: Prometheus/Grafana alerts, Umami, encrypted backups to R2 with a weekly restore check (ADR 0009, 0010).
7. Things that broke. The mail-scanner bug: confirm links auto-confirmed because scanners run the page's JS; the fix was acting only on a click. Second, the homepage Lighthouse drop from zod getting into the client bundle (PR #52). Short, concrete, with what each taught me.
8. What I'd do differently / next: `[CHRIS: …]` prompt with two suggested angles drawn from the ADRs' "consequences" sections.

**Rules:**
- No invented facts, numbers or dates. Use `[CHRIS: …]` for opinions only Chris can give, such as "why I chose X" when no ADR says why, or "what surprised me".
- No secrets, hostnames beyond the public ones (`christopherguzman.me`, `api.`, `cms.`, `grafana.`, `analytics.`), IPs, Tailscale addresses or emails.
- Short paragraphs, H2 per section, at most one code block (optional, for example a compose or ingress snippet copied from the repo with no secrets).
- End with a link to the repo, `https://github.com/chrisguzman77/chris-guzman-portfolio`, and to `/contact`.

- [ ] **Step 1: Read the sources** listed above.
- [ ] **Step 2: Write the draft** to the outline.
- [ ] **Step 3: Self-check.** For every number and named technology, confirm the source line. Run `grep -o '\[CHRIS:[^]]*\]' content/posts/how-i-built-this-site.md` and list every marker in your report. Count words with `wc -w` (target 2,000–2,500 excluding front matter).
- [ ] **Step 4: Commit**

```bash
git add content/posts/how-i-built-this-site.md
git commit -m "docs(content): draft flagship post, How I built this site"
```

---

### Task 6: Project write-up drafts + content README

**Files:**
- Create: `content/projects/offres-offpay.md`, `content/projects/cyber-threat-lakehouse.md`, `content/projects/acm-au-platform.md`, `content/projects/this-portfolio.md`
- Create: `content/README.md`

**Interfaces:**
- Consumes: the diagram PNGs (Task 4) and the post slug `how-i-built-this-site` (Task 5).

**Format for each project file** (the front matter mirrors the Directus `projects` fields; the body is the markdown `body` field):

```markdown
---
slug: <existing slug>
title: <existing title>
summary: <one or two sentences; the card text on /projects>
repo_url: <URL or null>
live_url: <URL or null>
award: <existing award or null>
date: <existing YYYY-MM-DD from infra/directus/seed/projects.json, or a [CHRIS: …] note if the sources disagree>
tech: [<existing tech list, adjusted only if the sources prove it wrong>]
---

<body>
```

**Sources:**
- `.superpowers/sdd/phase7b/project-facts.md` (verified facts and the "ask Chris" lists).
- The current live text: `curl -s https://christopherguzman.me/projects/<slug>`, which is the baseline being expanded.
- `infra/directus/seed/projects.json`.

**Body outline for OFFRes/OFFPay, Lakehouse, ACM@AU (400–600 words each):**
- `## What it is` (2–3 sentences)
- `## How it works`, with the diagram (`![<alt>](DIAGRAM:<slug>.png)`) and a short walk through it
- `## Decisions worth noting` (2–4 bullets, each with the reason)
- `## Results` (only sourced numbers; otherwise a `[CHRIS: …]` prompt)
- `## My part` (OFFRes/OFFPay: team of five; I built the backend API with the wallet ledger, and the signed QR payments. Lakehouse: solo if the facts file says so, otherwise `[CHRIS: …]`. ACM@AU: Lead Developer, per `infra/directus/seed/involvement.json`.)

**Per-project rules:**
- **OFFRes/OFFPay:** `repo_url: https://github.com/chrisguzman77/OffRes`. Be accurate about the facts file's flags: the vendor app doesn't verify the HMAC, and preload/settlement are simulated. Describe them as such, or leave them out; never claim them as real.
- **Lakehouse:** `repo_url: https://github.com/chrisguzman77/cyber-lakehouse`. 54 features; the row counts and model results come from the facts file (`metrics.json`). Say which run (local 500k sample) the results come from.
- **ACM@AU:** `repo_url: null`. Architecture and decisions in prose only: no code, hostnames, ports or env names. The Redis decision reversal can be a "Decisions" bullet, framed as "started without Redis, added it when …" only if the facts file gives the reason; otherwise `[CHRIS: …]`. Live URL: `[CHRIS: live URL, or remove]`.
- **This portfolio:** keep the current live text's length (about 130 words), then add one line: `I wrote up how it's built in [How I built this site](/blog/how-i-built-this-site).` Keep `repo_url`/`live_url` as in the seed.

**`content/README.md`** (short, numbered, for Chris):
1. **Upload diagrams:** in Directus → File Library, upload each `content/diagrams/*.png`. Copy each file's ID.
2. **Swap the diagram references:** in each draft, replace `DIAGRAM:<name>.png` with `/assets/<file-id>`. The site rewrites `/assets/` to `/cms-assets/`.
3. **Project pages:** for each project in `content/projects/`, open the item in Directus → Projects and paste `summary` and the body (everything below the front matter) into Body. Set `repo_url`, `date` and `tech` from the front matter. Save.
4. **Blog post:** Directus → Posts → create with `title`, `slug`, `excerpt`, `tags` and `published_at`, Body = the markdown below the front matter, status Published.
5. **Newsletter test send:** after publishing, run the post's "Email to subscribers" Flow with test checked, then for real. See `docs/runbook.md`.
6. **FAQ:** it's seeded automatically on the deploy that adds it. Edit it later in Directus → Faq.
7. **Before pasting:** search the drafts for `[CHRIS:` and resolve every marker.

- [ ] **Step 1: Read the sources.**
- [ ] **Step 2: Write the four project files and the README.**
- [ ] **Step 3: Self-check.** Run `wc -w` on each body (400–600 for the three; about 150 for this-portfolio). Run `grep -o '\[CHRIS:[^]]*\]' content/projects/*.md` and list the markers in your report. Check every number against the facts file.
- [ ] **Step 4: Commit**

```bash
git add content/projects content/README.md
git commit -m "docs(content): draft project write-ups and the publishing guide"
```
