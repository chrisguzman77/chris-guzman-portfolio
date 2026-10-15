# UI Polish PR 1 (site-wide look) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the site-wide half of the UI polish spec: a line grid with a cursor spotlight and card glow (B), a spinning mint border on the chat pill (E), a circular theme reveal (I), a logo that shows the current path plus a sliding nav underline (M), and live build info in the footer (P).

**Architecture:**
- **CSS first:** the effects live in `apps/web/src/app/globals.css`.
- **Client components:** three small ones write state the CSS reads:
  - `PointerGlow` sets pointer CSS variables;
  - `LogoPath` types the path suffix;
  - `MainNav` places the underline indicator.
- **Theme toggle:** wraps `setTheme` in `document.startViewTransition`.
- **Build info:** baked in at build time through `NEXT_PUBLIC_*` build args. The server footer formats it per request; the root layout is already dynamic because it reads `headers()`.

**Tech Stack:**
- Next.js 16 App Router, React 19, Tailwind v4, next-themes 0.4.6, TypeScript 6;
- Vitest + Testing Library (jsdom), Playwright + axe;
- GitHub Actions, Docker.

**Spec:** `docs/superpowers/specs/2026-10-14-ui-polish-design.md` (sections B, E, I, M, P).

**Setup for every task:**
- **Where:** all work happens in the worktree `/Users/christopherguzman/Desktop/coding_projects/chris-guzman-portfolio/.superpowers/worktrees/ui-polish` on branch `feat/ui-polish`. Web commands run in `apps/web`.
- **Dependencies:** if `apps/web/node_modules` is missing, run `pnpm install --frozen-lockfile` there first.
- **Playwright e2e:** needs a production build, so run `pnpm build` then `pnpm test:e2e <file>`. Its config starts the fake backend and the standalone server itself.

## Global Constraints

Copied from the spec. Every task must keep these:

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
  - inline styles are allowed.
- **No regressions:** static failover (`data-live-feature` hiding), Mermaid, the chat, existing e2e and unit tests.
- **Touch devices:** cursor effects are disabled when `(hover: none)` or `(pointer: coarse)` matches.
- **Repo rules:**
  - commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - never create, read or write `.env` / `.env.*` files;
  - match the surrounding comment density and style (short "why" comments, no narration).

---

### Task 1: Line grid, cursor spotlight and card glow (B)

**Files:**
- Create: `apps/web/src/components/layout/pointer-glow.tsx`
- Create: `apps/web/src/components/layout/pointer-glow.test.tsx`
- Create: `apps/web/e2e/polish.spec.ts`
- Modify: `apps/web/src/app/globals.css` (tokens in `:root` and `.dark`; new blocks after the reduced-motion block)
- Modify: `apps/web/src/app/layout.tsx` (mount `<PointerGlow />`)
- Modify (add the `card-glow` class):
  - `apps/web/src/components/content/project-card.tsx:12`
  - `apps/web/src/components/content/post-list-item.tsx:10`
  - `apps/web/src/components/content/status-card.tsx:43`
  - `apps/web/src/components/content/github-activity.tsx:84`
  - `apps/web/src/app/education/page.tsx:21`

**Interfaces:**
- Produces:
  - **`PointerGlow` component** (renders `null`). While the pointer moves, it sets `--spot-x` / `--spot-y` (px, viewport coordinates) and `data-spotlight` on `<html>`. It sets `--card-x` / `--card-y` (px, relative to the card) on the `.card-glow` element under the pointer.
  - **The `.card-glow` CSS class**, for any card.
  - **`apps/web/e2e/polish.spec.ts`**, which Tasks 2–5 append tests to.

- [ ] **Step 1: Write the failing unit test**

`apps/web/src/components/layout/pointer-glow.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PointerGlow, POINTER_QUERY } from "./pointer-glow";

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: query === POINTER_QUERY ? matches : false })),
  );
}

function move(target: EventTarget, clientX: number, clientY: number) {
  const event = new MouseEvent("pointermove", { bubbles: true, clientX, clientY });
  target.dispatchEvent(event);
}

beforeEach(() => {
  // Run animation frames immediately so each move paints synchronously.
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  const root = document.documentElement;
  root.removeAttribute("style");
  delete root.dataset.spotlight;
  document.body.innerHTML = "";
});

describe("PointerGlow", () => {
  it("moves the spotlight to the pointer", () => {
    stubMatchMedia(true);
    render(<PointerGlow />);
    move(document.body, 120, 340);
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--spot-x")).toBe("120px");
    expect(root.style.getPropertyValue("--spot-y")).toBe("340px");
    expect(root.dataset.spotlight).toBe("");
  });

  it("tracks the pointer inside the card under it", () => {
    stubMatchMedia(true);
    const card = document.createElement("div");
    card.className = "card-glow";
    const inner = document.createElement("span");
    card.append(inner);
    document.body.append(card);
    card.getBoundingClientRect = () => ({ left: 100, top: 300 }) as DOMRect;
    render(<PointerGlow />);
    move(inner, 130, 345);
    expect(card.style.getPropertyValue("--card-x")).toBe("30px");
    expect(card.style.getPropertyValue("--card-y")).toBe("45px");
  });

  it("hides the spotlight when the pointer leaves the page", () => {
    stubMatchMedia(true);
    render(<PointerGlow />);
    move(document.body, 10, 10);
    document.documentElement.dispatchEvent(new MouseEvent("pointerleave"));
    expect(document.documentElement.dataset.spotlight).toBeUndefined();
  });

  it("does nothing on touch screens or with reduced motion", () => {
    stubMatchMedia(false);
    render(<PointerGlow />);
    move(document.body, 120, 340);
    expect(document.documentElement.style.getPropertyValue("--spot-x")).toBe("");
    expect(document.documentElement.dataset.spotlight).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/layout/pointer-glow.test.tsx`
Expected: FAIL, because it cannot resolve `./pointer-glow`.

- [ ] **Step 3: Implement `PointerGlow`**

`apps/web/src/components/layout/pointer-glow.tsx`:

```tsx
"use client";

import { useEffect } from "react";

// Cursor effects need a mouse that can hover, and a visitor who is fine with motion.
export const POINTER_QUERY =
  "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";

// Writes the pointer position into CSS variables once per frame. globals.css draws the
// page spotlight (body::after) and the glow inside the hovered .card-glow from them.
export function PointerGlow() {
  useEffect(() => {
    if (!window.matchMedia(POINTER_QUERY).matches) return;
    const root = document.documentElement;
    let frame = 0;
    let last: PointerEvent | null = null;

    function paint() {
      frame = 0;
      if (!last) return;
      root.style.setProperty("--spot-x", `${last.clientX}px`);
      root.style.setProperty("--spot-y", `${last.clientY}px`);
      root.dataset.spotlight = "";
      const card =
        last.target instanceof Element ? last.target.closest<HTMLElement>(".card-glow") : null;
      if (card) {
        const rect = card.getBoundingClientRect();
        card.style.setProperty("--card-x", `${last.clientX - rect.left}px`);
        card.style.setProperty("--card-y", `${last.clientY - rect.top}px`);
      }
    }
    function onMove(event: PointerEvent) {
      last = event;
      if (!frame) frame = window.requestAnimationFrame(paint);
    }
    function onLeave() {
      delete root.dataset.spotlight;
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    root.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      if (frame) window.cancelAnimationFrame(frame);
      delete root.dataset.spotlight;
    };
  }, []);
  return null;
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `pnpm vitest run src/components/layout/pointer-glow.test.tsx`
Expected: 4 tests PASS.

- [ ] **Step 5: Add the CSS**

In `apps/web/src/app/globals.css`, add these tokens at the end of the `:root { … }` block (the light theme):

```css
  /* Line grid, cursor spotlight and card glow (see "Grid, spotlight, card glow" below). */
  --grid-line: rgb(15 23 42 / 0.045);
  --spot-strong: color-mix(in srgb, var(--accent-brand) 9%, transparent);
  --spot-soft: color-mix(in srgb, var(--accent-brand) 4%, transparent);
  --card-glow: color-mix(in srgb, var(--accent-brand) 8%, transparent);
```

Add these at the end of the `.dark { … }` block:

```css
  --grid-line: rgb(148 163 184 / 0.05);
  --spot-strong: color-mix(in srgb, var(--accent-brand) 12%, transparent);
  --spot-soft: color-mix(in srgb, var(--accent-brand) 5%, transparent);
  --card-glow: color-mix(in srgb, var(--accent-brand) 12%, transparent);
```

Then insert this block right after the `@media (prefers-reduced-motion: reduce) { … }` block:

```css
/* Grid, spotlight, card glow. Both page layers are fixed behind all content (z-index -1 in the
   root stacking context paints above the canvas background that body's colour propagates to).
   The spotlight is a 1040px disc moved with transform, so following the pointer never repaints;
   <PointerGlow> sets --spot-x/--spot-y and data-spotlight. */
body::before,
body::after {
  content: "";
  position: fixed;
  z-index: -1;
  pointer-events: none;
}
body::before {
  inset: 0;
  background-image:
    linear-gradient(var(--grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
  background-size: 32px 32px;
}
body::after {
  top: 0;
  left: 0;
  width: 1040px;
  height: 1040px;
  border-radius: 50%;
  background: radial-gradient(
    closest-side,
    var(--spot-strong),
    var(--spot-soft) 35%,
    transparent 70%
  );
  transform: translate(calc(var(--spot-x, -2000px) - 520px), calc(var(--spot-y, -2000px) - 520px));
  opacity: 0;
  transition: opacity 0.3s ease;
}
html[data-spotlight] body::after {
  opacity: 1;
}
@media (hover: none), (pointer: coarse), (prefers-reduced-motion: reduce) {
  body::after {
    display: none;
  }
}

@layer components {
  /* Cards lift and turn mint on hover or keyboard focus; on hover a glow follows the cursor
     (--card-x/--card-y from <PointerGlow>). isolation keeps the glow above the card's own
     background but under its text. */
  .card-glow {
    position: relative;
    isolation: isolate;
    transition:
      transform 0.25s ease,
      border-color 0.25s ease,
      box-shadow 0.25s ease;
  }
  .card-glow::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.25s ease;
    background: radial-gradient(
      260px circle at var(--card-x, 50%) var(--card-y, 50%),
      var(--card-glow),
      transparent 60%
    );
  }
  .card-glow:focus-visible,
  .card-glow:has(:focus-visible) {
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--accent-brand) 55%, transparent);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--accent-brand) 25%, transparent),
      0 10px 30px -12px color-mix(in srgb, var(--accent-brand) 35%, transparent);
  }
  @media (hover: hover) and (pointer: fine) {
    .card-glow:hover {
      transform: translateY(-2px);
      border-color: color-mix(in srgb, var(--accent-brand) 55%, transparent);
      box-shadow:
        0 0 0 1px color-mix(in srgb, var(--accent-brand) 25%, transparent),
        0 10px 30px -12px color-mix(in srgb, var(--accent-brand) 35%, transparent);
    }
    .card-glow:hover::after {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .card-glow:hover,
    .card-glow:focus-visible,
    .card-glow:has(:focus-visible) {
      transform: none;
    }
  }
}
```

- [ ] **Step 6: Mount `PointerGlow` and tag the cards**

`apps/web/src/app/layout.tsx`:
- add `import { PointerGlow } from "@/components/layout/pointer-glow";` next to the other layout imports (alphabetical order);
- render `<PointerGlow />` directly after `<SkipLink />`.

Add `card-glow` to each card's class string. On the two link cards, also drop `transition-colors hover:border-input`, because `.card-glow` now owns hover:

- `project-card.tsx:12`:
  `className="card-glow flex h-full flex-col rounded-[10px] border border-border bg-card p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand"`
- `github-activity.tsx:84`:
  `className="card-glow block rounded-[10px] border border-border bg-card p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand"`
- `post-list-item.tsx:10`:
  `<article className="card-glow rounded-[10px] border border-border bg-card p-4">`
- `status-card.tsx:43`: prefix the existing string with `card-glow `.
- `education/page.tsx:21`:
  `const card = "card-glow rounded-[10px] border border-border bg-card p-4";` (covers the school, involvement and certification cards).

- [ ] **Step 7: Write the e2e check for the real media gating**

Create `apps/web/e2e/polish.spec.ts`:

```ts
import { expect, expectNoAxeViolations, test } from "./helpers";

test("grid behind every page; spotlight follows a mouse but never a touch screen", async ({
  page,
  isMobile,
}) => {
  await page.goto("/projects");
  const grid = await page.evaluate(
    () => getComputedStyle(document.body, "::before").backgroundImage,
  );
  expect(grid).toContain("linear-gradient");

  await page.mouse.move(200, 300);
  await page.mouse.move(240, 320);
  const html = page.locator("html");
  if (isMobile) {
    await expect(html).not.toHaveAttribute("data-spotlight");
    const display = await page.evaluate(
      () => getComputedStyle(document.body, "::after").display,
    );
    expect(display).toBe("none");
  } else {
    await expect(html).toHaveAttribute("data-spotlight", "");
    await expect(html).toHaveCSS("--spot-x", "240px");
  }
  await expectNoAxeViolations(page);
});

test("project cards lift and turn mint on hover", async ({ page, isMobile }) => {
  test.skip(isMobile, "hover effects are mouse-only");
  await page.goto("/projects");
  const card = page.getByRole("link", { name: /^This portfolio/ });
  await card.hover();
  await expect(card).not.toHaveCSS("transform", "none");
});
```

- [ ] **Step 8: Build and run the new e2e plus the existing journey**

Run: `pnpm build && pnpm test:e2e e2e/polish.spec.ts e2e/journey.spec.ts e2e/failover.spec.ts`
Expected: all PASS on the `mobile` and `desktop` projects. The journey's axe runs (dark, plus the light-theme test) stay clean.

- [ ] **Step 9: Lint, typecheck, format, unit suite**

Run: `pnpm lint && pnpm typecheck && pnpm format && pnpm test`
Expected: all pass. If `pnpm format` fails, run `pnpm format:write` and re-check.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/components/layout/pointer-glow.tsx apps/web/src/components/layout/pointer-glow.test.tsx apps/web/e2e/polish.spec.ts apps/web/src/app/globals.css apps/web/src/app/layout.tsx apps/web/src/components/content/project-card.tsx apps/web/src/components/content/post-list-item.tsx apps/web/src/components/content/status-card.tsx apps/web/src/components/content/github-activity.tsx apps/web/src/app/education/page.tsx
git commit -m "feat(web): line grid, cursor spotlight and card glow across the site

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Spinning mint border on "Ask about Chris" (E)

**Files:**
- Modify: `apps/web/src/app/globals.css`: replace the `chat-pill-glow` block at the end of the file (the comment, the `@keyframes chat-pill-glow` and the `.chat-pill-glow::after` rule)
- Modify: `apps/web/e2e/polish.spec.ts` (append)

**Interfaces:**
- Consumes: `apps/web/e2e/polish.spec.ts` from Task 1.
- Produces: nothing new. The pill keeps its `chat-pill-glow` class in `chat-launcher.tsx`, which this task does not modify.

- [ ] **Step 1: Write the failing e2e test**

Append to `apps/web/e2e/polish.spec.ts`:

```ts
test("the chat pill's mint arc spins, and stands still as a full ring with reduced motion", async ({
  page,
}) => {
  await page.goto("/");
  const pill = page.getByRole("button", { name: /Ask about Chris/ });
  await expect(pill).toBeVisible();
  const arc = () =>
    pill.evaluate((element) => {
      const style = getComputedStyle(element, "::after");
      return { animation: style.animationName, background: style.backgroundImage };
    });
  expect(await arc()).toMatchObject({ animation: "chat-arc-spin" });
  expect((await arc()).background).toContain("conic-gradient");

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await arc()).toMatchObject({ animation: "none", background: "none" });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm build && pnpm test:e2e e2e/polish.spec.ts -g "chat pill"`
Expected: FAIL, because the animation is `chat-pill-glow`, not `chat-arc-spin`.

- [ ] **Step 3: Replace the pill CSS**

In `apps/web/src/app/globals.css`, delete everything from the comment `/* "Ask about Chris" pill: two 1 s accent glows …` to the end of the file. Put this in its place:

```css
/* "Ask about Chris" pill: a mint arc circles its border every 3.5 s. The arc is a conic gradient
   masked down to a 1.5px ring; registering --chat-arc lets the angle animate smoothly. Browsers
   without @property show the arc standing still; reduced motion shows a full static ring. */
@property --chat-arc {
  syntax: "<angle>";
  inherits: false;
  initial-value: 0deg;
}
@keyframes chat-arc-spin {
  to {
    --chat-arc: 360deg;
  }
}
.chat-pill-glow::after {
  content: "";
  position: absolute;
  inset: -1px;
  padding: 1.5px;
  border-radius: inherit;
  pointer-events: none;
  background: conic-gradient(
    from var(--chat-arc),
    transparent 0 60%,
    var(--accent-brand) 75%,
    color-mix(in srgb, var(--accent-brand) 55%, white) 82%,
    transparent 95%
  );
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#000 0 0) content-box exclude,
    linear-gradient(#000 0 0);
  animation: chat-arc-spin 3.5s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .chat-pill-glow::after {
    animation: none;
    background: none;
    background-color: var(--accent-brand);
  }
}
```

The reduced-motion rule uses `background: none` plus `background-color`, so `backgroundImage` reads `none` (the test asserts that) while the ring stays solid mint.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm build && pnpm test:e2e e2e/polish.spec.ts e2e/journey.spec.ts e2e/failover.spec.ts`
Expected: all PASS. The journey's chat tests and the failover test still pass, so the pill still opens the chat and still hides in failover.

- [ ] **Step 5: Check it by eye**

Take screenshots of the pill in both themes for the report:

```bash
pnpm exec playwright screenshot --viewport-size=1280,800 --wait-for-timeout=1500 http://127.0.0.1:3100/ /private/tmp/claude-501/pill-dark.png
```

The `bash e2e/serve.sh` and `node e2e/fake-backend.mjs` servers must be running in the background for this. Also capture the light theme with an init script, or toggle the theme manually in a headed run. If the ring has gaps or doubles the 1px border, adjust only `inset` or `padding`, then note it in the report.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/globals.css apps/web/e2e/polish.spec.ts
git commit -m "feat(web): spinning mint border on the Ask about Chris pill

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Circular theme reveal (I)

**Files:**
- Modify: `apps/web/src/components/layout/theme-toggle.tsx`
- Modify: `apps/web/src/components/layout/theme-toggle.test.tsx`
- Modify: `apps/web/src/app/globals.css` (append the view-transition rule)
- Modify: `apps/web/e2e/polish.spec.ts` (append)

**Interfaces:**
- Produces: `export function revealRadius(x: number, y: number, width: number, height: number): number`, plus the unchanged `ThemeToggle` (same `aria-label="Toggle theme"`).

- [ ] **Step 1: Write the failing unit tests**

Replace `apps/web/src/components/layout/theme-toggle.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { revealRadius, ThemeToggle } from "./theme-toggle";

const setTheme = vi.hoisted(() => vi.fn());
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark", setTheme }) }));

function stubReducedMotion(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" ? reduced : false,
    })),
  );
}

let animate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  animate = vi.fn();
  document.documentElement.animate = animate as unknown as typeof document.documentElement.animate;
});

afterEach(() => {
  cleanup();
  setTheme.mockReset();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "startViewTransition");
});

function withViewTransitions() {
  const start = vi.fn((update: () => void) => {
    update();
    return { ready: Promise.resolve(), finished: Promise.resolve() };
  });
  Object.defineProperty(document, "startViewTransition", { value: start, configurable: true });
  return start;
}

describe("ThemeToggle", () => {
  it("has a visible focus ring", () => {
    stubReducedMotion(false);
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Toggle theme" }).className).toContain(
      "focus-visible:outline",
    );
  });

  it("reveals the new theme in a circle from the button when view transitions exist", async () => {
    stubReducedMotion(false);
    const start = withViewTransitions();
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(start).toHaveBeenCalledOnce();
    expect(setTheme).toHaveBeenCalledWith("light");
    await vi.waitFor(() => expect(animate).toHaveBeenCalledOnce());
    const [keyframes, options] = animate.mock.calls[0];
    expect(keyframes.clipPath[0]).toMatch(/^circle\(0px at /);
    expect(options).toMatchObject({
      duration: 650,
      easing: "ease-in-out",
      pseudoElement: "::view-transition-new(root)",
    });
  });

  it("switches instantly without the View Transitions API", () => {
    stubReducedMotion(false);
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(setTheme).toHaveBeenCalledWith("light");
    expect(animate).not.toHaveBeenCalled();
  });

  it("switches instantly with reduced motion even when view transitions exist", () => {
    stubReducedMotion(true);
    const start = withViewTransitions();
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(start).not.toHaveBeenCalled();
    expect(setTheme).toHaveBeenCalledWith("light");
  });
});

describe("revealRadius", () => {
  it("reaches the farthest corner of the viewport", () => {
    expect(revealRadius(0, 0, 300, 400)).toBe(500);
    expect(revealRadius(1240, 28, 1280, 800)).toBeCloseTo(Math.hypot(1240, 772));
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/components/layout/theme-toggle.test.tsx`
Expected: FAIL, because `revealRadius` is not exported and `startViewTransition` is never called.

- [ ] **Step 3: Implement the toggle**

Replace `apps/web/src/components/layout/theme-toggle.tsx` with:

```tsx
"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import type { MouseEvent } from "react";
import { flushSync } from "react-dom";

import { Button } from "@/components/ui/button";

const REVEAL_MS = 650;

// Distance from (x, y) to the farthest viewport corner: the circle that covers the whole page.
export function revealRadius(x: number, y: number, width: number, height: number): number {
  return Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  function toggle(event: MouseEvent<HTMLButtonElement>) {
    const next = resolvedTheme === "dark" ? "light" : "dark";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || reduced) {
      setTheme(next);
      return;
    }
    const button = event.currentTarget.getBoundingClientRect();
    const x = button.left + button.width / 2;
    const y = button.top + button.height / 2;
    // flushSync applies the new theme class inside the callback, before the browser
    // captures the "after" snapshot.
    const transition = document.startViewTransition(() => flushSync(() => setTheme(next)));
    transition.ready
      .then(() => {
        const radius = revealRadius(x, y, window.innerWidth, window.innerHeight);
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: REVEAL_MS, easing: "ease-in-out", pseudoElement: "::view-transition-new(root)" },
        );
      })
      .catch(() => {}); // a skipped transition rejects `ready`; the theme has still changed
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      className="focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand"
      onClick={toggle}
    >
      <Sun className="size-5 dark:hidden" />
      <Moon className="hidden size-5 dark:block" />
    </Button>
  );
}
```

Append to `apps/web/src/app/globals.css`:

```css
/* Theme switch: <ThemeToggle> animates the new snapshot's clip-path from the button outward,
   so the browser's default cross-fade is turned off. */
::view-transition-old(root),
::view-transition-new(root) {
  animation: none;
  mix-blend-mode: normal;
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `pnpm vitest run src/components/layout/theme-toggle.test.tsx src/components/layout/site-header.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Add the e2e check (real Chromium has view transitions)**

Append to `apps/web/e2e/polish.spec.ts`:

```ts
test("theme toggle switches the theme through the circular reveal", async ({ page }) => {
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).toHaveClass(/\bdark\b/);
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(html).not.toHaveClass(/\bdark\b/);
  await page.waitForTimeout(800); // let the 650 ms reveal finish before axe reads colours
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(html).toHaveClass(/\bdark\b/);
});
```

Run: `pnpm build && pnpm test:e2e e2e/polish.spec.ts e2e/journey.spec.ts`
Expected: all PASS. The journey's mermaid test also clicks the toggle and checks the diagram follows the theme.

- [ ] **Step 6: Lint, typecheck, format; then commit**

Run: `pnpm lint && pnpm typecheck && pnpm format`

```bash
git add apps/web/src/components/layout/theme-toggle.tsx apps/web/src/components/layout/theme-toggle.test.tsx apps/web/src/app/globals.css apps/web/e2e/polish.spec.ts
git commit -m "feat(web): circular theme reveal from the toggle via view transitions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Logo shows where you are, plus a sliding nav underline (M)

**Files:**
- Create: `apps/web/src/lib/logo-path.ts`, `apps/web/src/lib/logo-path.test.ts`
- Create: `apps/web/src/components/layout/logo-path.tsx`, `apps/web/src/components/layout/logo-path.test.tsx`
- Create: `apps/web/src/components/layout/main-nav.tsx`
- Modify: `apps/web/src/components/layout/site-header.tsx`, `apps/web/src/components/layout/site-header.test.tsx`
- Modify: `apps/web/src/components/layout/nav-link.tsx` (new `underline` prop)
- Modify: `apps/web/src/app/not-found.tsx` (render `<MarkNotFound />`)
- Modify: `apps/web/src/app/globals.css` (append the caret and indicator rules)
- Modify: `apps/web/e2e/polish.spec.ts` (append)

**Interfaces:**
- Produces:
  - `logoSuffix(pathname: string): string`: `""`, or `/<section>`, or `/404`.
  - `nextFrame(current: string, target: string): string`: one typing step.
  - `<LogoPath />`, the aria-hidden suffix plus caret.
  - `<MarkNotFound />`, rendered by the 404 page.
  - `<MainNav />`, the desktop nav with its indicator.
  - `NavLink`'s new prop `underline?: boolean`, default `true`. PR 2 (K, the interactive 404) relies on `<MarkNotFound />` staying in `not-found.tsx`.

- [ ] **Step 1: Write the failing pure-function tests**

`apps/web/src/lib/logo-path.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { logoSuffix, nextFrame } from "./logo-path";

describe("logoSuffix", () => {
  it("is empty at home", () => {
    expect(logoSuffix("/")).toBe("");
  });

  it("shows the first path segment of a known section", () => {
    expect(logoSuffix("/projects")).toBe("/projects");
    expect(logoSuffix("/projects/offres-offpay")).toBe("/projects");
    expect(logoSuffix("/blog/hello-world")).toBe("/blog");
    expect(logoSuffix("/newsletter/confirm")).toBe("/newsletter");
  });

  it("shows /404 for an unknown section", () => {
    expect(logoSuffix("/nope")).toBe("/404");
    expect(logoSuffix("/nope/deeper")).toBe("/404");
  });
});

describe("nextFrame", () => {
  it("deletes back to the shared prefix, then types the new suffix", () => {
    const frames: string[] = [];
    let current = "/blog";
    while (current !== "/projects") {
      current = nextFrame(current, "/projects");
      frames.push(current);
    }
    expect(frames).toEqual([
      "/blo",
      "/bl",
      "/b",
      "/",
      "/p",
      "/pr",
      "/pro",
      "/proj",
      "/proje",
      "/projec",
      "/project",
      "/projects",
    ]);
  });

  it("deletes everything when going home", () => {
    expect(nextFrame("/b", "")).toBe("");
  });

  it("stays put once it has arrived", () => {
    expect(nextFrame("/blog", "/blog")).toBe("/blog");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/lib/logo-path.test.ts`
Expected: FAIL, because it cannot resolve `./logo-path`.

- [ ] **Step 3: Implement the pure functions**

`apps/web/src/lib/logo-path.ts`:

```ts
import { siteConfig } from "@/lib/site";

// Top-level routes that exist; anything else is a 404. Admin and newsletter pages aren't in the nav.
const SECTIONS = new Set<string>([
  ...siteConfig.nav.map((item) => item.href.slice(1)),
  "newsletter",
  "admin",
]);

// The part of the header logo after ~/chris-guzman: "/projects" for /projects/x.
export function logoSuffix(pathname: string): string {
  const section = pathname.split("/")[1] ?? "";
  if (section === "") return "";
  return SECTIONS.has(section) ? `/${section}` : "/404";
}

// One keystroke of the logo's typing animation: delete until `current` is a prefix of
// `target`, then type the next character.
export function nextFrame(current: string, target: string): string {
  if (!target.startsWith(current)) return current.slice(0, -1);
  return target.slice(0, current.length + 1);
}
```

Run: `pnpm vitest run src/lib/logo-path.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing component tests**

`apps/web/src/components/layout/logo-path.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LogoPath, MarkNotFound } from "./logo-path";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

function stubReducedMotion(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" ? reduced : false,
    })),
  );
}

const suffix = (container: HTMLElement) =>
  container.querySelector("[data-logo-suffix]")?.textContent;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  nav.pathname = "/";
});

describe("LogoPath", () => {
  it("renders the current section straight away and hides it from screen readers", () => {
    stubReducedMotion(false);
    nav.pathname = "/projects/offres-offpay";
    const { container } = render(<LogoPath />);
    expect(suffix(container)).toBe("/projects");
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("deletes back to the shared prefix, then types the new section", () => {
    stubReducedMotion(false);
    nav.pathname = "/blog";
    const { container, rerender } = render(<LogoPath />);
    nav.pathname = "/projects";
    rerender(<LogoPath />);
    act(() => vi.advanceTimersByTime(35 * 2));
    expect(suffix(container)).toBe("/bl");
    act(() => vi.advanceTimersByTime(35 * 20));
    expect(suffix(container)).toBe("/projects");
  });

  it("jumps straight to the new section with reduced motion", () => {
    stubReducedMotion(true);
    nav.pathname = "/blog";
    const { container, rerender } = render(<LogoPath />);
    nav.pathname = "/experience";
    rerender(<LogoPath />);
    act(() => vi.advanceTimersByTime(1));
    expect(suffix(container)).toBe("/experience");
  });

  it("shows /404 while the not-found page is mounted, even under a known section", () => {
    stubReducedMotion(true);
    nav.pathname = "/projects/does-not-exist";
    const { container } = render(
      <>
        <LogoPath />
        <MarkNotFound />
      </>,
    );
    act(() => vi.advanceTimersByTime(1));
    expect(suffix(container)).toBe("/404");
  });
});
```

Run: `pnpm vitest run src/components/layout/logo-path.test.tsx`
Expected: FAIL, because it cannot resolve `./logo-path`.

- [ ] **Step 5: Implement `LogoPath` and `MarkNotFound`**

`apps/web/src/components/layout/logo-path.tsx`:

```tsx
"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { logoSuffix, nextFrame } from "@/lib/logo-path";

const TYPE_MS = 35;

// A 404 under a real section (/projects/nope) can't be told apart by its path, so the
// not-found page flags itself through this tiny store while it is mounted.
let notFound = false;
const listeners = new Set<() => void>();
function setNotFound(value: boolean) {
  notFound = value;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function MarkNotFound() {
  useEffect(() => {
    setNotFound(true);
    return () => setNotFound(false);
  }, []);
  return null;
}

// The header logo's live path (~/chris-guzman + this). Decorative: the link's accessible
// name stays "~/chris-guzman (Christopher Guzman, home)".
export function LogoPath() {
  const pathname = usePathname();
  const isNotFound = useSyncExternalStore(
    subscribe,
    () => notFound,
    () => false,
  );
  const target = isNotFound ? "/404" : logoSuffix(pathname);
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);

  useEffect(() => {
    if (shownRef.current === target) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setInterval(
      () => {
        const next = reduced ? target : nextFrame(shownRef.current, target);
        shownRef.current = next;
        setShown(next);
        if (next === target) window.clearInterval(timer);
      },
      reduced ? 0 : TYPE_MS,
    );
    return () => window.clearInterval(timer);
  }, [target]);

  return (
    <span aria-hidden="true" className="md:max-lg:hidden">
      <span data-logo-suffix="" className="text-foreground">
        {shown}
      </span>
      <span className="logo-caret" />
    </span>
  );
}
```

`md:max-lg:hidden` hides the suffix between 768 px and 1024 px. At those widths the six desktop nav links share the row, and `~/chris-guzman/experience` would overflow it. Below `md` the nav is a menu button, and from `lg` up there's room.

Append to `apps/web/src/app/globals.css`:

```css
/* Header logo caret. The global reduced-motion rule ends the blink after one instant cycle,
   leaving a steady block. */
.logo-caret {
  display: inline-block;
  width: 0.6em;
  height: 1.15em;
  margin-left: 2px;
  vertical-align: -0.25em;
  background: var(--accent-brand);
  animation: logo-caret-blink 1s step-end infinite;
}
@keyframes logo-caret-blink {
  50% {
    opacity: 0;
  }
}
/* Desktop nav underline: <MainNav> positions it; it transitions only after its first placement
   (data-ready) so it never slides in from the left edge on load. */
.nav-indicator[data-ready] {
  transition:
    transform 0.3s ease,
    width 0.3s ease,
    opacity 0.2s ease;
}
```

Run: `pnpm vitest run src/components/layout/logo-path.test.tsx`
Expected: 4 tests PASS.

- [ ] **Step 6: Implement `MainNav` and the `NavLink` prop**

In `apps/web/src/components/layout/nav-link.tsx`:
- add `underline = true` to the destructured props, with the type `underline?: boolean`;
- change the active class line to:

```tsx
        active && "text-foreground",
        active && underline && "underline decoration-accent-brand underline-offset-4",
```

The mobile menu keeps the default (`underline` true), so its look is unchanged.

`apps/web/src/components/layout/main-nav.tsx`:

```tsx
"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";

import { siteConfig } from "@/lib/site";

import { NavLink } from "./nav-link";

// Desktop nav. One mint bar sits under the current section's link and slides to the next one
// on navigation; it is drawn by measuring the link, so it is placed straight from the DOM.
export function MainNav() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const bar = barRef.current;
    if (!nav || !bar) return;
    function place() {
      const active = nav!.querySelector<HTMLElement>('a[aria-current="page"]');
      if (!active) {
        bar!.style.opacity = "0";
        return;
      }
      bar!.style.width = `${active.offsetWidth}px`;
      bar!.style.transform = `translateX(${active.offsetLeft}px)`;
      bar!.style.opacity = "1";
    }
    place();
    const frame = window.requestAnimationFrame(() => {
      bar.dataset.ready = "";
    });
    // Web fonts swapping in change link widths.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(nav);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [pathname]);

  return (
    <nav ref={navRef} aria-label="Main" className="relative hidden items-center gap-4 md:flex">
      {siteConfig.nav.map((item) => (
        <NavLink key={item.href} href={item.href} underline={false}>
          {item.label}
        </NavLink>
      ))}
      <span
        ref={barRef}
        aria-hidden="true"
        data-nav-indicator=""
        className="nav-indicator pointer-events-none absolute -bottom-1.5 left-0 h-0.5 rounded-full bg-accent-brand opacity-0"
      />
    </nav>
  );
}
```

If `pnpm lint` flags the non-null assertions, capture `const navEl = nav; const barEl = bar;` after the guard and use those inside `place`.

- [ ] **Step 7: Wire the header and the 404 page**

`apps/web/src/components/layout/site-header.tsx`:
- import `LogoPath` from `./logo-path` and `MainNav` from `./main-nav`;
- remove the `siteConfig` and `NavLink` imports, which are now unused;
- replace the logo `<Link>` contents and the `<nav>` element:

```tsx
        <Link
          href="/"
          className="shrink-0 text-accent-brand hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand"
        >
          ~/chris-guzman
          <LogoPath />
          <span className="sr-only"> (Christopher Guzman, home)</span>
        </Link>
        <div className="flex items-center gap-4">
          <MainNav />
          <div className="flex items-center gap-1 md:border-l md:border-input md:pl-3">
```

(The theme toggle, mobile nav and closing tags are unchanged.)

`apps/web/src/app/not-found.tsx`:
- add `import { MarkNotFound } from "@/components/layout/logo-path";`;
- render `<MarkNotFound />` as the first child of the outer `<div>`.

- [ ] **Step 8: Extend the header tests**

Append these cases inside the `describe("SiteHeader", …)` block of `apps/web/src/components/layout/site-header.test.tsx`. That file already mocks `usePathname` to return `/projects/offres`. Add `vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })))` in a `beforeEach`, and `vi.unstubAllGlobals()` in `afterEach`.

```tsx
  it("shows the current section after the logo without changing its accessible name", () => {
    render(<SiteHeader />);
    const home = screen.getByRole("link", { name: "~/chris-guzman (Christopher Guzman, home)" });
    expect(home.querySelector("[data-logo-suffix]")?.textContent).toBe("/projects");
  });

  it("draws one decorative underline indicator in the desktop nav", () => {
    render(<SiteHeader />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const bars = nav.querySelectorAll("[data-nav-indicator]");
    expect(bars).toHaveLength(1);
    expect(bars[0].getAttribute("aria-hidden")).toBe("true");
    expect((bars[0] as HTMLElement).style.opacity).toBe("1");
    expect(screen.getByRole("link", { name: "projects" }).className).not.toContain("underline");
  });
```

Run: `pnpm vitest run src/components/layout src/lib/logo-path.test.ts src/app/not-found.test.tsx`
Expected: all PASS, including the existing header, mobile-nav and not-found tests.

- [ ] **Step 9: Add the e2e checks**

Append to `apps/web/e2e/polish.spec.ts`:

```ts
test("the logo shows the section you are in", async ({ page, isMobile }) => {
  await page.goto("/");
  const suffix = page.locator("[data-logo-suffix]");
  await expect(suffix).toHaveText("");
  if (isMobile) await page.getByRole("button", { name: "Open menu" }).click();
  const nav = page.getByRole("navigation", { name: isMobile ? "Mobile" : "Main" });
  await nav.getByRole("link", { name: "projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(suffix).toHaveText("/projects");
  if (!isMobile) {
    await expect(page.locator("[data-nav-indicator]")).toHaveCSS("opacity", "1");
  }
});

test.describe("missing pages", () => {
  test.use({ allowedDocumentStatus: [404] });

  test("the logo shows /404 on a missing page, nested or not", async ({ page }) => {
    for (const path of ["/nope", "/projects/does-not-exist"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.locator("[data-logo-suffix]")).toHaveText("/404");
    }
  });
});

test("the header never overflows the viewport", async ({ page }) => {
  for (const width of [360, 800, 1024, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/experience");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
  }
});
```

(`test.use` sits in a `describe` block, the same pattern as the 404 test in `e2e/journey.spec.ts`.)

Run: `pnpm build && pnpm test:e2e e2e/polish.spec.ts e2e/journey.spec.ts`
Expected: all PASS on both projects.

- [ ] **Step 10: Lint, typecheck, format; then commit**

Run: `pnpm lint && pnpm typecheck && pnpm format && pnpm test`

```bash
git add apps/web/src/lib/logo-path.ts apps/web/src/lib/logo-path.test.ts apps/web/src/components/layout/logo-path.tsx apps/web/src/components/layout/logo-path.test.tsx apps/web/src/components/layout/main-nav.tsx apps/web/src/components/layout/nav-link.tsx apps/web/src/components/layout/site-header.tsx apps/web/src/components/layout/site-header.test.tsx apps/web/src/app/not-found.tsx apps/web/src/app/globals.css apps/web/e2e/polish.spec.ts
git commit -m "feat(web): header logo types the current path; sliding nav underline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Live build info in the footer (P)

**Files:**
- Create: `apps/web/src/lib/build-info.ts`, `apps/web/src/lib/build-info.test.ts`
- Create: `apps/web/src/components/layout/build-info.tsx`
- Modify: `apps/web/src/components/layout/site-footer.tsx`, `apps/web/src/components/layout/site-footer.test.tsx`
- Modify: `apps/web/Dockerfile` (build stage ARG/ENV)
- Modify: `.github/workflows/release.yml` (checkout with tags, a build-info step, build args)
- Modify: `.github/workflows/ci.yml` (fixed build-info env on the web `pnpm build` and `pnpm test:e2e` steps only)
- Modify: `apps/web/e2e/polish.spec.ts` (append)

**Interfaces:**
- Consumes: `formatAgo(iso: string, now?: number): string` from `apps/web/src/lib/status.ts`. It returns `"1m ago"`, `"5h ago"` or `"3d ago"`.
- Produces:
  - `buildInfo(env: BuildEnv, now?: number): BuildInfo | null`;
  - `type BuildEnv = { version?: string; release?: string; builtAt?: string }`;
  - `type BuildInfo = { sha: string; shaUrl: string; release: string | null; releaseUrl: string | null; builtAt: string; ago: string }`;
  - `<BuildInfo />`, a server component.

- [ ] **Step 1: Write the failing formatter tests**

`apps/web/src/lib/build-info.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildInfo } from "./build-info";

const SHA = "cf6681f0123456789abcdef0123456789abcdef0";
const NOW = Date.parse("2026-10-14T12:00:00Z");
const REPO = "https://github.com/chrisguzman77/chris-guzman-portfolio";

describe("buildInfo", () => {
  it("formats a release build", () => {
    expect(
      buildInfo({ version: SHA, release: "v1.0.0", builtAt: "2026-10-14T10:00:00Z" }, NOW),
    ).toEqual({
      sha: "cf6681f",
      shaUrl: `${REPO}/commit/${SHA}`,
      release: "v1.0.0",
      releaseUrl: `${REPO}/releases/tag/v1.0.0`,
      builtAt: "2026-10-14T10:00:00Z",
      ago: "2h ago",
    });
  });

  it("leaves the release out when no tag was reachable", () => {
    const info = buildInfo({ version: SHA, release: "", builtAt: "2026-10-14T11:55:00Z" }, NOW);
    expect(info).toMatchObject({ release: null, releaseUrl: null, ago: "5m ago" });
  });

  it("is null for local and unstamped builds", () => {
    expect(buildInfo({}, NOW)).toBeNull();
    expect(buildInfo({ version: "dev", builtAt: "2026-10-14T10:00:00Z" }, NOW)).toBeNull();
    expect(buildInfo({ version: SHA }, NOW)).toBeNull();
    expect(buildInfo({ version: SHA, builtAt: "not a date" }, NOW)).toBeNull();
  });
});
```

Run: `pnpm vitest run src/lib/build-info.test.ts`
Expected: FAIL, because it cannot resolve `./build-info`.

- [ ] **Step 2: Implement the formatter**

`apps/web/src/lib/build-info.ts`:

```ts
import { formatAgo } from "@/lib/status";

const REPO = "https://github.com/chrisguzman77/chris-guzman-portfolio";

export type BuildEnv = { version?: string; release?: string; builtAt?: string };

export type BuildInfo = {
  sha: string;
  shaUrl: string;
  release: string | null;
  releaseUrl: string | null;
  builtAt: string;
  ago: string;
};

// The footer's "deployed 2h ago · cf6681f · v1.0.0". Null when the build wasn't stamped by
// release.yml (local dev, the CI image check), which the footer shows as "dev".
export function buildInfo(env: BuildEnv, now: number = Date.now()): BuildInfo | null {
  const { version, release, builtAt } = env;
  if (!version || version === "dev" || !builtAt || Number.isNaN(Date.parse(builtAt))) {
    return null;
  }
  return {
    sha: version.slice(0, 7),
    shaUrl: `${REPO}/commit/${version}`,
    release: release || null,
    releaseUrl: release ? `${REPO}/releases/tag/${release}` : null,
    builtAt,
    ago: formatAgo(builtAt, now),
  };
}
```

Run: `pnpm vitest run src/lib/build-info.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 3: Write the failing footer tests**

In `apps/web/src/components/layout/site-footer.test.tsx`:
- add `vi` and `beforeEach` to the vitest import;
- add `vi.unstubAllEnvs();` to `afterEach` (keep `cleanup`);
- append these cases inside the `describe`:

```tsx
  it("shows dev when the build carries no deploy info", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "");
    vi.stubEnv("NEXT_PUBLIC_BUILD_TIME", "");
    render(<SiteFooter />);
    expect(screen.getByText("dev")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^commit / })).toBeNull();
    expect(document.querySelector("footer time")).toBeNull();
  });

  it("shows when and from which commit and release the site was deployed", () => {
    const sha = "cf6681f0123456789abcdef0123456789abcdef0";
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", sha);
    vi.stubEnv("NEXT_PUBLIC_APP_RELEASE", "v1.0.0");
    vi.stubEnv("NEXT_PUBLIC_BUILD_TIME", new Date(Date.now() - 2 * 3_600_000).toISOString());
    render(<SiteFooter />);
    expect(screen.getByText("2h ago").tagName).toBe("TIME");
    const commit = screen.getByRole("link", { name: "commit cf6681f on GitHub" });
    expect(commit.textContent).toBe("cf6681f");
    expect(commit.getAttribute("href")).toBe(
      `https://github.com/chrisguzman77/chris-guzman-portfolio/commit/${sha}`,
    );
    expect(screen.getByRole("link", { name: "release v1.0.0 on GitHub" }).getAttribute("href")).toBe(
      "https://github.com/chrisguzman77/chris-guzman-portfolio/releases/tag/v1.0.0",
    );
  });
```

Add one more case, so the new links are held to the existing focus-ring rule:

```tsx
  it("gives the build links a visible focus ring", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "cf6681f0123456789abcdef0123456789abcdef0");
    vi.stubEnv("NEXT_PUBLIC_APP_RELEASE", "v1.0.0");
    vi.stubEnv("NEXT_PUBLIC_BUILD_TIME", new Date().toISOString());
    render(<SiteFooter />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).toContain("focus-visible:outline");
    }
  });
```

Import only `vi` (not `beforeEach`) from vitest.

Run: `pnpm vitest run src/components/layout/site-footer.test.tsx`
Expected: the new cases FAIL (no "dev" text, no commit link).

- [ ] **Step 4: Implement `BuildInfo` and add it to the footer**

`apps/web/src/components/layout/build-info.tsx`:

```tsx
import { buildInfo } from "@/lib/build-info";

const link =
  "text-accent-brand hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand";

// Written out in full so Next inlines each NEXT_PUBLIC_ value at build time.
export function BuildInfo() {
  const info = buildInfo({
    version: process.env.NEXT_PUBLIC_APP_VERSION,
    release: process.env.NEXT_PUBLIC_APP_RELEASE,
    builtAt: process.env.NEXT_PUBLIC_BUILD_TIME,
  });
  const dot = (
    <span aria-hidden="true" className="text-live">
      ●
    </span>
  );
  if (!info) {
    return (
      <p className="flex items-center gap-1.5">
        {dot}
        <span>dev</span>
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-1.5">
      {dot}
      <span>
        deployed <time dateTime={info.builtAt}>{info.ago}</time>
      </span>
      <span aria-hidden="true">·</span>
      <a
        href={info.shaUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`commit ${info.sha} on GitHub`}
        className={link}
      >
        {info.sha}
      </a>
      {info.release && info.releaseUrl ? (
        <>
          <span aria-hidden="true">·</span>
          <a
            href={info.releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`release ${info.release} on GitHub`}
            className={link}
          >
            {info.release}
          </a>
        </>
      ) : null}
    </p>
  );
}
```

In `apps/web/src/components/layout/site-footer.tsx`:
- import `BuildInfo` from `./build-info`;
- render `<BuildInfo />` between the copyright `<p>` and the social `<nav>`. The row already wraps (`flex-wrap … justify-between gap-4`), so on phones it drops to its own line.

Run: `pnpm vitest run src/components/layout/site-footer.test.tsx src/lib/build-info.test.ts src/app/api/healthz/route.test.ts`
Expected: all PASS (healthz still reports `"dev"`).

- [ ] **Step 5: Stamp real builds**

In `apps/web/Dockerfile`, make the build stage's ARG/ENV lines:

```dockerfile
FROM base AS build
ARG NEXT_PUBLIC_APP_VERSION=dev
ARG NEXT_PUBLIC_APP_RELEASE=
ARG NEXT_PUBLIC_BUILD_TIME=
ENV NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION \
    NEXT_PUBLIC_APP_RELEASE=$NEXT_PUBLIC_APP_RELEASE \
    NEXT_PUBLIC_BUILD_TIME=$NEXT_PUBLIC_BUILD_TIME \
    NEXT_TELEMETRY_DISABLED=1
```

In `.github/workflows/release.yml`, `build` job:

1. Give the checkout full history, so `git describe` can find tags:

```yaml
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0 # tags and history for git describe (footer build info)
```

2. Right after the checkout, add:

```yaml
      - name: Build info
        id: info
        run: |
          echo "release=$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)" >> "$GITHUB_OUTPUT"
          echo "time=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$GITHUB_OUTPUT"
```

3. Extend the `Build` step's `build-args`:

```yaml
          build-args: |
            NEXT_PUBLIC_APP_VERSION=${{ github.sha }}
            NEXT_PUBLIC_APP_RELEASE=${{ steps.info.outputs.release }}
            NEXT_PUBLIC_BUILD_TIME=${{ steps.info.outputs.time }}
```

In `.github/workflows/ci.yml`, web job, add the same fixed values to the env of exactly two steps: `- run: pnpm build` and `- run: pnpm test:e2e`. Keep the existing `NEXT_TELEMETRY_DISABLED` / `CI` entries. Do not put them at job level, because the unit tests (`pnpm test`) expect the unstamped `dev`.

```yaml
          NEXT_PUBLIC_APP_VERSION: 0123456789abcdef0123456789abcdef01234567
          NEXT_PUBLIC_APP_RELEASE: v9.9.9
          NEXT_PUBLIC_BUILD_TIME: "2026-01-01T00:00:00Z"
```

- [ ] **Step 6: Add the e2e check**

Append to `apps/web/e2e/polish.spec.ts`. Playwright reads the same env that the CI build step stamped. Locally, with an unstamped build, it expects `dev`.

```ts
test("footer shows the build it was deployed from", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  const release = process.env.NEXT_PUBLIC_APP_RELEASE;
  if (release) {
    const sha = process.env.NEXT_PUBLIC_APP_VERSION!.slice(0, 7);
    await expect(footer.getByRole("link", { name: `commit ${sha} on GitHub` })).toHaveText(sha);
    await expect(
      footer.getByRole("link", { name: `release ${release} on GitHub` }),
    ).toHaveAttribute(
      "href",
      `https://github.com/chrisguzman77/chris-guzman-portfolio/releases/tag/${release}`,
    );
    await expect(footer.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d\d-\d\dT/);
  } else {
    await expect(footer.getByText("dev", { exact: true })).toBeVisible();
  }
  await expectNoAxeViolations(page);
});
```

Run the stamped path locally exactly as CI will:

```bash
export NEXT_PUBLIC_APP_VERSION=0123456789abcdef0123456789abcdef01234567 NEXT_PUBLIC_APP_RELEASE=v9.9.9 NEXT_PUBLIC_BUILD_TIME=2026-01-01T00:00:00Z
pnpm build && pnpm test:e2e e2e/polish.spec.ts
```

Expected: PASS. Then run `unset NEXT_PUBLIC_APP_VERSION NEXT_PUBLIC_APP_RELEASE NEXT_PUBLIC_BUILD_TIME`, rebuild, and re-run to check the `dev` branch also passes.

- [ ] **Step 7: Validate the workflow and Dockerfile edits**

Run from the worktree root:

```bash
docker build --build-arg NEXT_PUBLIC_APP_VERSION=ci -t ci-web apps/web
```

Expected: the build succeeds. The empty ARG defaults are fine. If `actionlint` is installed, also run `actionlint .github/workflows/release.yml .github/workflows/ci.yml`. If it isn't, check the YAML indentation by eye against the neighbouring steps.

- [ ] **Step 8: Lint, typecheck, format; then commit**

Run (in `apps/web`): `pnpm lint && pnpm typecheck && pnpm format && pnpm test`

```bash
git add apps/web/src/lib/build-info.ts apps/web/src/lib/build-info.test.ts apps/web/src/components/layout/build-info.tsx apps/web/src/components/layout/site-footer.tsx apps/web/src/components/layout/site-footer.test.tsx apps/web/Dockerfile .github/workflows/release.yml .github/workflows/ci.yml apps/web/e2e/polish.spec.ts
git commit -m "feat(web): footer shows when, from which commit and release, the site was deployed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Whole-PR verification

**Files:** none changed unless a check fails. Fixes go in a separate commit with a message that names the check.

- [ ] **Step 1: Full web suite on an unstamped build**

Run in `apps/web`:

```bash
pnpm lint && pnpm typecheck && pnpm format && pnpm test && pnpm build && pnpm test:e2e
```

Expected: everything passes, including `e2e/budget.spec.ts`, with `budgets.json` untouched (check with `git diff main -- apps/web/e2e/budgets.json`, which should be empty), and `e2e/failover.spec.ts`.

- [ ] **Step 2: Lighthouse on the production build**

Run: `pnpm perf:lighthouse --serve`
Expected: each page's mobile median performance is ≥ 95 when the machine is idle. If a page is under 95, re-run once while the machine is idle before treating it as real. Record the scores in the report. Live Lighthouse on the five key pages happens after deploy and is the controller's job.

- [ ] **Step 3: Screenshots for Chris**

With the standalone server and fake backend running, capture these into the scratchpad and list the paths in the report:
- `/` in dark and light at 1280×800 and 390×844;
- `/projects` at 1280×800, with the mouse over a card;
- the footer.

---

## Self-review notes

**Spec coverage:**
- **B:** Task 1, including the e2e for touch and reduced-motion gating.
- **E:** Task 2, including the reduced-motion ring.
- **I:** Task 3, covering the fallback when the API is missing, reduced motion, and the unchanged label.
- **M:** Task 4: logo, `/404` (top-level and nested), aria-hidden suffix, caret that stops blinking, desktop sliding underline, mobile style unchanged.
- **P:** Task 5: formatter, `dev` fallback, links, Dockerfile, `release.yml` with tags, CI env.
- **Guardrails:** Task 6.
- The spec's "a client refresh of the relative label is optional" is deliberately left out. The root layout reads `headers()`, so every page renders per request and the server label is current.

**Interface types:**
- `logoSuffix` / `nextFrame` / `LogoPath` / `MarkNotFound` / `MainNav` names are consistent between Task 4 and its tests.
- So are `buildInfo` / `BuildInfo` / `BuildEnv` in Task 5.
- `polish.spec.ts` is created in Task 1 and only appended to afterwards.
