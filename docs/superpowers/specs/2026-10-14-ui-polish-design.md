# UI polish: a cooler, more alive site

Decisions made by Chris on 2026-10-14 in a visual brainstorm. The mockups are in `.superpowers/brainstorm/45903-1792011564/content/`, which is local and not committed.

## Goal
Make christopherguzman.me feel more crafted and memorable to recruiters and engineers. Keep the terminal-editorial identity (dark-first, mint accent `--accent-brand`, monospace prompts) and every existing guarantee.

## Guardrails (bind every item)
- **Performance:**
  - mobile and desktop Lighthouse stay ≥ 95 on `/`, `/projects`, a project page, the blog post and `/contact`;
  - the CI JS budget (`apps/web/e2e/budgets.json`) is not raised;
  - effects are CSS-first, with small client components only where needed.
- **Accessibility:**
  - axe stays clean in both themes;
  - everything works by keyboard, with focus visible;
  - screen-reader text is unchanged or better.
- **Reduced motion:** with `prefers-reduced-motion: reduce`, every animation is off or instant and the content shows in its final state.
- **CSP:**
  - no inline `<script>` or event-handler attributes (the CSP is nonce + `strict-dynamic`); all behaviour lives in bundled components;
  - inline styles are already allowed (`style-src 'unsafe-inline'`).
- **No regressions:** static failover (`data-live-feature` hiding), Mermaid, the chat, existing e2e and unit tests.
- **Touch devices:** cursor effects are disabled when `(hover: none)` or `(pointer: coarse)` matches.

## PR 1: site-wide look

### B. Line grid + cursor spotlight + card glow (whole site)
- **Grid:**
  - a faint line grid fixed behind every page: a `body::before` or app-shell layer, `position: fixed`, `pointer-events: none`, below all content;
  - about 32 px squares, with a line colour token of roughly `rgba(148,163,184,.05)` in dark, and an equivalent subtle token in light;
  - text contrast is unaffected (axe passes).
- **Spotlight:**
  - a soft mint radial glow, about 520 px, two-stop fade to transparent, that follows the pointer anywhere on the page;
  - one small client component listens to `pointermove` on `window` and writes `--spot-x`/`--spot-y` once per animation frame;
  - the glow layer is a fixed CSS element;
  - it never clips to an element box (the mockup bug Chris spotted must not exist);
  - off for touch and reduced motion.
- **Card hover:**
  - the existing card class (project cards, post cards, involvement and certification cards, the status card) lifts 2 px, and its border turns mint;
  - an inner glow follows the cursor inside the card, using the same pointer-variable approach scoped to the hovered card;
  - keyboard focus on a card's link gets the same treatment, minus the cursor glow.

### E. Glowing "Ask about Chris" button
- **The effect:** an animated conic-gradient border (a mint arc) circles the chat launcher pill, using `@property --angle` and a 3.5 s linear loop.
- **Fallbacks:**
  - without `@property` support, the border is a static mint gradient;
  - reduced motion shows a static mint border.
- **Unchanged:** the pill's existing behaviour (lazy chat, ⌘K, failover hiding via `data-live-feature`).

### I. Circular theme switch
- **The effect:** the toggle calls `document.startViewTransition(() => setTheme(next))`, and the new theme is revealed by animating `::view-transition-new(root)` with `clip-path: circle()` from the toggle's centre to the farthest corner, over about 650 ms ease-in-out.
- **Fallbacks:** browsers without the API, and reduced motion, switch instantly (as today).
- **Rules:**
  - next-themes stays the source of truth;
  - there's no flash of the wrong theme on first load (unchanged);
  - the toggle's accessible name and its state announcement are unchanged.

### M. The logo shows where you are
- **The logo:** `~/chris-guzman` plus the first path segment of the current route (`/projects/x` shows `~/chris-guzman/projects`), with a blinking block cursor.
  - **On navigation:** the suffix deletes back to the shared prefix, then types the new one (about 35 ms per character).
  - **Source:** client component using `usePathname`.
- **Accessibility:**
  - the link's accessible name stays "Christopher Guzman, home" (or the current name), and the path is `aria-hidden`;
  - the cursor blink stops under reduced motion.
- **Unknown routes** (the 404) show `~/chris-guzman/404`.
- **Desktop nav:** the active link gets a mint underline that slides to the new link on navigation, using a CSS transition on a single indicator element. The mobile nav keeps its current style.

### P. Live build info in the footer
- **The line:** `● deployed <relative time> · <short sha> · <version>`, in the footer on every page. The short sha links to `https://github.com/chrisguzman77/chris-guzman-portfolio/commit/<sha>`, and the version links to the GitHub release.
- **Data, baked at build time:**
  - `NEXT_PUBLIC_APP_VERSION` (already the commit sha);
  - new `NEXT_PUBLIC_BUILD_TIME`: an ISO timestamp, set in `.github/workflows/release.yml` (for example from the workflow's start time or `date -u`);
  - new `NEXT_PUBLIC_APP_RELEASE`: the latest `v*` tag reachable from the commit (`git describe --tags --abbrev=0 --match 'v*'`, which needs a checkout with tags). It is empty when there is none.
  - These are passed as Docker build args and declared in `apps/web/Dockerfile`.
- **Rendering:**
  - a `<time dateTime=…>` with a relative label computed on the server at request time;
  - a client refresh of the relative label is optional.
  - **Local dev:** missing values render as `dev` and hide the link and the time.
- **The static failover snapshot** shows the build info as of the snapshot. That's acceptable, and it's labelled "deployed", which stays true.

## PR 2: page features

### A. Live terminal hero (home)
- **The constraint:**
  - the name `<h1>` and intro paragraph are the page's LCP candidates, so they're **visible from first paint**;
  - they may slide up by about 8 px but must never start invisible (no `opacity: 0` start), so LCP isn't delayed.
- **The effect:**
  - only the `$ whoami` prompt types itself (about 0.6 s) with a blinking cursor;
  - the CTA buttons and the status card may fade in after it, since they aren't LCP.
  - The full text is in the server HTML, for SEO, no-JS visitors and screen readers.
- **Once per browser session:** the first home view in a tab session animates (a `sessionStorage` flag). Later views render in the final state.
- **Reduced motion:** no animation.

### G. Timeline that draws itself (`/experience`)
- **The effect:** a vertical mint line grows down the experience list as the visitor scrolls, and each entry's dot lights up when its entry enters the viewport (one IntersectionObserver).
- **Fallbacks:** without JS, or with reduced motion, the line is full and every dot is lit.
- **Unchanged:** the list's semantics.

### L1. Project pages: editor tabs
- **The header:** each project page's header becomes an editor-style tab bar above the title.
  - `README.md` is the active tab (this page, `aria-current="page"`).
  - `repo ↗` links to `repo_url`, and `live ↗` links to `live_url`. Each is rendered only when the project has that link.
- **Accessibility:** they're links (navigation), not ARIA tabs. External links open in a new tab with `rel="noopener"` and announce it.
- **Look:** the active tab has a mint top border; the style is neutral and not tied to any operating system.
- **Duplicates:** existing repo and live buttons on the page are replaced by the tabs, or kept, whichever avoids duplicate links. The implementer decides with a note.

### K. Interactive 404
- **The page:** `app/not-found.tsx` renders a terminal:
  - `bash: <path>: No such file or directory (404)`, a hint line, and a text input with the prompt `visitor@chris:~$`;
  - commands: `help`, `ls` (lists pages), `cd <page>` (navigates), `cat resume` (goes to /resume), `whoami`, `clear`;
  - unknown input prints `command not found: <x> (try help)`;
  - output is escaped, with no HTML injection.
- **Accessibility and no-JS:**
  - the input has a visible label or `aria-label`, and output is announced through `aria-live="polite"`;
  - a plain list of links to every main page is always rendered below the terminal.
- **Rules:**
  - the 404 status code is unchanged;
  - the page's metadata title stays as is;
  - the logo (M) shows `~/chris-guzman/404`.

### O. Activity heatmap ripple (home)
- **The effect:** the GitHub heatmap's cells animate in as a diagonal wave (scale and opacity from small, with a delay of (column + row) × about 20 ms) the first time the heatmap scrolls into view, through IntersectionObserver plus a CSS class.
- **Fallbacks:** reduced motion or no JS shows the cells immediately.
- **Unchanged:** the data and accessibility (labels and tooltips).

## Testing
- **Unit (vitest):**
  - the logo path derivation (root, nested, 404);
  - the build-info formatter (relative time, missing values);
  - the 404 command parser (each command, unknown input, escaping, `cd` targets);
  - the theme toggle calls `startViewTransition` when it's available and falls back otherwise;
  - the hero session flag;
  - project tabs render only for existing links.
- **e2e (Playwright):**
  - **404:** typing `cd projects` and pressing Enter navigates to `/projects`.
  - **Logo:** it shows `/projects` after clicking Projects.
  - **Footer:** shows the version from env in the e2e server.
  - **Reduced motion:** with `reducedMotion: "reduce"`, the hero is in its final state immediately and the timeline is full.
  - **axe:** passes on all touched pages in both themes.
  - **Budgets and failover:** the JS budget passes unchanged, and the existing failover e2e still passes.
- **Live (after each deploy):** Lighthouse mobile median of 3 on the five key pages stays ≥ 95.

## Out of scope
- Scroll reveal (C), live-stats bento (D), tech-stack ticker (F), blog reading polish (J), aurora (H), "decrypt" headings (N) and brand polish (Q). These weren't chosen.
- Any change to content, data models or the API, except build args for P.
