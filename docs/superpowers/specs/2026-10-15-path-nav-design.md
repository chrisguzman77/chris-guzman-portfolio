# Path navigation follow-ups: typing on refresh, full-path logo, "cd .." back link

Chris decided these on 2026-10-15, after PR #84, in a visual brainstorm. The mockups are in `.superpowers/brainstorm/9694-1792099611/content/`, which is local and not committed. The UI polish guardrails still apply: Lighthouse ≥ 95, the JS budget is not raised, axe stays clean in both themes, reduced motion and no-JS show the final state, CSP has no inline scripts, and there are no regressions.

## 1. `$ whoami` types on every refresh or fresh visit
- The home prompt types every time the home page is the document the browser loaded, whether by a refresh, a new visit or a typed URL. This replaces the "once per browser session" behaviour.
- It does **not** type when you arrive at home by client-side navigation, such as clicking the logo or `cd ..` from another page, or going back/forward to it within the same tab.
- **Implementation:**
  - The server always renders the animating hero, so the `cg-hero-seen` cookie and the `cookies()` read go away.
  - `<MarkHeroSeen>` decides in a layout effect, which runs before the browser paints. It lets the animation run only when this is the first mount in the document **and** the initial document load was `/`. It reads the initial document's URL from `performance.getEntriesByType("navigation")[0]`.
  - Otherwise it sets `html[data-hero-seen]`, which already switches the animation off.
- **Reduced motion:** unchanged; there is no animation.

## 2. Project and blog post pages: no `$ cat` line; the logo shows the full file path
- **Prompt line removed:** detail pages drop the `$ cat …` line above the title. This applies to `/blog/<slug>` and `/projects/<slug>` only. List and section pages keep their prompts (`$ cat experience.log`, `$ ls projects/` and so on), and the OG images keep theirs.
- **Full path in the logo:** on a detail page the logo shows the full path with `.md`, for example `~/chris-guzman/blog/how-i-built-this-site.md` and `~/chris-guzman/projects/this-portfolio.md`. It types and deletes the way the logo path does now, at 35 ms per character, back to the shared prefix. Other routes are unchanged: `/projects`, `/blog`, `/404` and so on.
- **The path is clickable, like breadcrumbs:**
  - `~/chris-guzman` goes home;
  - on a detail page, the section segment (`/blog`, `/projects`) goes to that list;
  - the file name, and the section on a section page, is the current page, so it is plain text, not a link.
- **Accessibility:**
  - the home link's accessible name stays `~/chris-guzman (Christopher Guzman, home)`;
  - the section link gets the name `blog folder` or `projects folder`;
  - the typed text stays decorative where it isn't a link;
  - links have a visible focus ring.
- **Phones:** a long path **wraps to two lines**. The header grows to fit (a minimum height instead of a fixed one), and nothing is cut off. The path stays hidden between 768 and 1023 px, as it is today, because the desktop nav shares that row. From 1024 px up the full path shows, and an unusually long slug wraps instead of overflowing.

## 3. "← cd .." back link above the title
- **Where:** on project and blog post pages, a back link sits above the title, where `$ cat` was. On project pages it goes below the editor tabs.
- **Where it goes:** the parent list, `/blog` or `/projects`.
- **Style ("keyboard key"):** a mint `←` sits **outside** a small mono box that reads `cd ..`.
  - The box looks like a keyboard key: card background, input-colour border, and a 2 px bottom border.
  - The arrow and the box are **one** link.
  - On hover the box border and text turn mint and the arrow nudges 3 px left.
  - Keyboard focus shows a focus ring on the box.
  - The accessible name is `cd .. (back to blog)` or `cd .. (back to projects)`.
  - Under reduced motion the arrow doesn't move.
- **Old buttons removed:** the bottom `← all posts` and `← all projects` buttons are removed, so the back link appears once. The home page's section links ("all projects", "all posts") are different and stay.

## Testing
- **Unit:**
  - the path derivation (`/blog/x` gives `/blog/x.md`, `/projects/x` gives `/projects/x.md`, and section, home and 404 paths are unchanged);
  - the breadcrumb links (home, and the section only on detail pages, with their accessible names);
  - the hero decision (first mount with initial URL `/` animates; client navigation to `/` or a second mount doesn't);
  - the back link's href and name;
  - the detail pages render no `$ cat` line and no bottom back button.
- **e2e:**
  - a project page shows `~/chris-guzman/projects/this-portfolio.md`;
  - clicking `/projects` in the logo goes to `/projects`;
  - the back link goes to the list;
  - the home prompt types again after `reload()`, and doesn't type after clicking the logo from `/projects`;
  - the header doesn't overflow at 360, 800, 1024 or 1280 px on a long-slug blog post;
  - axe passes in both themes on a blog post and a project page.

## Separate: chat bug
The third suggested question returning the canned "I don't have information" reply is a separate fix (chat history/citations). It is tracked on its own and is not part of this spec.
