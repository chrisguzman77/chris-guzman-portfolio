# UI Polish PR 2 (page features) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the page-level half of the UI polish spec:
- **A:** the `$ whoami` prompt types itself on the first home view;
- **G:** the experience timeline draws itself as you scroll;
- **L1:** project pages get an editor-tab header;
- **K:** an interactive 404 terminal;
- **O:** the GitHub heatmap ripples in.

**Architecture:**
- **CSS-first:** the effects live in `apps/web/src/app/globals.css`. Small client components only write state that CSS reads: an attribute, a CSS variable or a cookie.
- **No flash for repeat visitors:** the home page is already dynamic (the root layout reads `headers()`). So the server reads a session cookie to decide whether the hero animates, and repeat views render in their final state.
- **Final state by default:** every effect's no-JS and reduced-motion state is the final state.

**Tech Stack:**
- Next.js 16 App Router (async `cookies()` from `next/headers`), React 19, Tailwind v4;
- Vitest + Testing Library (jsdom), Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-14-ui-polish-design.md`, "PR 2: page features" (A, G, L1, K, O). PR 1 (B, E, I, M, P) is merged, and B was later narrowed to the home hero.

**Setup for every task:**
- **Where:** all work happens in the worktree `/Users/christopherguzman/Desktop/coding_projects/chris-guzman-portfolio/.superpowers/worktrees/ui-polish` on branch `feat/ui-polish-2` (based on `origin/main` cf76b16). Web commands run in `apps/web`; node_modules and Playwright chromium are installed.
- **e2e:** `pnpm build`, then `pnpm test:e2e <files>`. Playwright reuses servers already on ports 3100/3101 locally, so make sure none are stale before a run (`lsof -i :3100 -i :3101`), and stop any you start.
- **Shared e2e file:** `apps/web/e2e/polish.spec.ts` already exists from PR 1. Tasks append to it.

## Global Constraints

These are copied from the spec. Every task must keep them.

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
- **No regressions:** static failover (`data-live-feature` hiding), Mermaid, the chat, and the existing e2e and unit tests.
- **Touch devices:** cursor effects are disabled when `(hover: none)` or `(pointer: coarse)` matches. None of PR 2's effects are cursor-driven.
- **LCP (A):** the name `<h1>`, the intro paragraph and the photo are the page's LCP candidates. They are visible from first paint and never animate from `opacity: 0`.
- **Repo rules:**
  - commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - never create, read or write `.env` / `.env.*` files;
  - pre-commit hooks run prettier; re-add and commit again if they change files (no `--no-verify`);
  - match the surrounding comment density (short "why" comments).

## Deliberate deviations from the spec (decided by the controller; implementers follow them)

1. **A, "once per session":** the spec says a `sessionStorage` flag. This plan uses a **session cookie** (`cg-hero-seen`, no expiry) that the server reads instead. A `sessionStorage` flag is only known after hydration: the server would always render the prompt, the client would hide it, and then type it, which flashes. A cookie lets later views render final from the first byte. It is first-party and functional, and it lasts until the browser session ends.
2. **G, dot lighting:** the spec says one IntersectionObserver. This plan lights each dot from the same per-frame scroll measurement that grows the line: a dot lights when its entry's top passes 65% of the viewport, or at the bottom of the page. Both effects follow one rule, and dots already in view are lit before the "ready" state applies, so nothing flickers grey-then-mint on load.
3. **O, wave direction:** the delay is `(weeks from the newest + row) × 20 ms`, so the wave starts at today's column and sweeps back. On phones only the newest 22 weeks are visible, so the wave starts right away there.
4. **L1, duplicate links:** the `repo ↗` and `live ↗` tabs **replace** the "Source code" and "Live site" buttons, so each link appears once.

---

### Task 1: The `$ whoami` prompt types itself on the first home view (A)

**Files:**
- Create: `apps/web/src/lib/hero.ts`
- Create: `apps/web/src/components/content/hero-prompt.tsx`
- Create: `apps/web/src/components/content/mark-hero-seen.tsx`
- Create: `apps/web/src/components/content/hero-prompt.test.tsx`
- Modify: `apps/web/src/app/page.tsx` (hero prompt; `hero-fade` on the buttons, socials and status wrapper)
- Modify: `apps/web/src/app/page.test.tsx` (mock `next/headers`; two new cases)
- Modify: `apps/web/src/app/globals.css` (append the hero block)
- Modify: `apps/web/e2e/polish.spec.ts` (append)

**Interfaces:**
- Produces:
  - `HERO_SEEN_COOKIE = "cg-hero-seen"` (from `@/lib/hero`);
  - `<HeroPrompt animate: boolean />` (server component);
  - `<MarkHeroSeen />` (client; sets the cookie on mount);
  - CSS classes `hero-type`, `hero-caret` and `hero-fade`.

- [ ] **Step 1: Write the failing component tests**

`apps/web/src/components/content/hero-prompt.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HERO_SEEN_COOKIE } from "@/lib/hero";

import { HeroPrompt } from "./hero-prompt";

afterEach(() => {
  cleanup();
  document.cookie = `${HERO_SEEN_COOKIE}=; path=/; max-age=0`;
});

describe("HeroPrompt", () => {
  it("types the prompt with a caret on the first view and remembers it for the session", () => {
    const { container } = render(<HeroPrompt animate />);
    expect(screen.getByText("$ whoami").className).toContain("hero-type");
    expect(container.querySelector(".hero-caret")?.getAttribute("aria-hidden")).toBe("true");
    expect(document.cookie).toContain(`${HERO_SEEN_COOKIE}=1`);
  });

  it("renders the prompt in its final state on later views", () => {
    const { container } = render(<HeroPrompt animate={false} />);
    expect(screen.getByText("$ whoami").className).not.toContain("hero-type");
    expect(container.querySelector(".hero-caret")).toBeNull();
    expect(document.cookie).not.toContain(HERO_SEEN_COOKIE);
  });
});
```

Run: `pnpm vitest run src/components/content/hero-prompt.test.tsx`
Expected: FAIL, because `./hero-prompt` cannot be resolved.

- [ ] **Step 2: Implement**

`apps/web/src/lib/hero.ts`:

```ts
// Session cookie (no expiry) set after the home hero's first view, so the server renders later
// views in their final state instead of typing the prompt again.
export const HERO_SEEN_COOKIE = "cg-hero-seen";
```

`apps/web/src/components/content/mark-hero-seen.tsx`:

```tsx
"use client";

import { useEffect } from "react";

import { HERO_SEEN_COOKIE } from "@/lib/hero";

export function MarkHeroSeen() {
  useEffect(() => {
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${HERO_SEEN_COOKIE}=1; path=/; samesite=lax${secure}`;
  }, []);
  return null;
}
```

`apps/web/src/components/content/hero-prompt.tsx`:

```tsx
import { MarkHeroSeen } from "./mark-hero-seen";

// The home hero's "$ whoami". On the first view per browser session it types itself (CSS, see
// "Home hero" in globals.css); the full text is always in the HTML for SEO and screen readers.
export function HeroPrompt({ animate }: { animate: boolean }) {
  return (
    <p className="font-mono text-xs text-accent-brand">
      <span className={animate ? "hero-type" : undefined}>$ whoami</span>
      {animate ? (
        <>
          <span aria-hidden="true" className="hero-caret" />
          <MarkHeroSeen />
        </>
      ) : null}
    </p>
  );
}
```

Append to `apps/web/src/app/globals.css`:

```css
/* Home hero, first view per browser session (<HeroPrompt animate>): "$ whoami" types itself
   (8 monospace characters in 0.6 s) with a caret that blinks and then goes, and the buttons and
   status card fade in after it. The name, intro and photo never animate: they are the page's
   largest paint. */
.hero-type {
  display: inline-block;
  overflow: hidden;
  white-space: nowrap;
  vertical-align: bottom;
  animation: hero-type 0.6s steps(8, end) both;
}
@keyframes hero-type {
  from {
    width: 0;
  }
  to {
    width: 8ch;
  }
}
.hero-caret {
  display: inline-block;
  width: 0.6em;
  height: 1.15em;
  margin-left: 2px;
  vertical-align: -0.25em;
  background: var(--accent-brand);
  animation: hero-caret 1.6s step-end both;
}
@keyframes hero-caret {
  0%,
  45%,
  75% {
    opacity: 1;
  }
  30%,
  60%,
  100% {
    opacity: 0;
  }
}
.hero-fade {
  animation: hero-fade 0.4s ease 0.65s both;
}
@keyframes hero-fade {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
/* The global reduced-motion rule shortens durations but keeps delays, which would leave the
   faded blocks invisible for 0.65 s, so switch these off outright. */
@media (prefers-reduced-motion: reduce) {
  .hero-type,
  .hero-fade {
    animation: none;
  }
  .hero-caret {
    display: none;
  }
}
```

Run: `pnpm vitest run src/components/content/hero-prompt.test.tsx`
Expected: 2 tests PASS.

- [ ] **Step 3: Wire it into the home page (failing page tests first)**

In `apps/web/src/app/page.test.tsx`:
- add `import { cookies } from "next/headers";` and `vi.mock("next/headers", () => ({ cookies: vi.fn() }));` next to the other mocks;
- in the existing `beforeEach` (or a new one if there is none), add `vi.mocked(cookies).mockResolvedValue({ has: () => false } as unknown as Awaited<ReturnType<typeof cookies>>);`;
- append these cases inside the top-level `describe`. Copy the render helper the file already uses for `HomePage`, typically `render(await HomePage())`, and its existing query mocks:

```tsx
  it("types the hero prompt and fades in the actions on the first view of the session", async () => {
    render(await HomePage());
    expect(screen.getByText("$ whoami").className).toContain("hero-type");
    expect(document.querySelectorAll(".hero-fade").length).toBe(3);
    expect(screen.getByRole("heading", { level: 1 }).closest(".hero-fade")).toBeNull();
  });

  it("renders the hero in its final state once the session has seen it", async () => {
    vi.mocked(cookies).mockResolvedValue({
      has: (name: string) => name === "cg-hero-seen",
    } as unknown as Awaited<ReturnType<typeof cookies>>);
    render(await HomePage());
    expect(screen.getByText("$ whoami").className).not.toContain("hero-type");
    expect(document.querySelectorAll(".hero-fade").length).toBe(0);
  });
```

Run: `pnpm vitest run src/app/page.test.tsx`
Expected: the two new cases FAIL.

In `apps/web/src/app/page.tsx`:
- add `import { cookies } from "next/headers";`, `import { HeroPrompt } from "@/components/content/hero-prompt";` and `import { HERO_SEEN_COOKIE } from "@/lib/hero";` (alphabetical with the existing imports; also import `cn` from `@/lib/utils` if the file doesn't already);
- after the data fetches, add `const animateHero = !(await cookies()).has(HERO_SEEN_COOKIE);`;
- replace `<p className="font-mono text-xs text-accent-brand">$ whoami</p>` with `<HeroPrompt animate={animateHero} />`;
- add `hero-fade` (only when `animateHero`) to exactly three wrappers:
  - the buttons row: `className={cn("flex flex-wrap items-center gap-2.5", animateHero && "hero-fade")}`;
  - the GitHub/LinkedIn row: `className={cn("mt-2 flex flex-wrap items-center gap-2.5", animateHero && "hero-fade")}`;
  - the status card wrapper: `className={cn("mt-5", animateHero && "hero-fade")}`.

Leave the `<h1>`, the intro `<p>` and the `<Image>` alone.

Run: `pnpm vitest run src/app/page.test.tsx src/components/content/hero-prompt.test.tsx`
Expected: all PASS.

- [ ] **Step 4: e2e**

Append to `apps/web/e2e/polish.spec.ts`:

```ts
test("the hero prompt types once per browser session", async ({ page }) => {
  await page.goto("/");
  const prompt = page.getByText("$ whoami", { exact: true });
  await expect(prompt).toHaveClass(/hero-type/);
  await expect(page.getByRole("link", { name: "Download resume" })).toHaveCSS("opacity", "1");
  await page.reload();
  await expect(prompt).not.toHaveClass(/hero-type/);
  await expect(page.locator(".hero-fade")).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the hero shows its final state immediately", async ({ page }) => {
    await page.goto("/");
    const prompt = page.getByText("$ whoami", { exact: true });
    await expect(prompt).toHaveCSS("animation-name", "none");
    await expect(page.locator(".hero-caret")).toBeHidden();
    // No 0.65 s delay: the actions are fully visible at once.
    expect(
      await page
        .getByRole("link", { name: "Download resume" })
        .evaluate((element) => getComputedStyle(element.closest(".hero-fade")!).opacity),
    ).toBe("1");
  });
});
```

The first test's opacity assertion is auto-waiting: it passes once the 1.05 s fade has finished. If the "Download resume" link's accessible name differs, read `page.tsx` and use its exact text.

Run: `pnpm build && pnpm test:e2e e2e/polish.spec.ts e2e/journey.spec.ts e2e/failover.spec.ts`
Expected: all PASS on both projects.

- [ ] **Step 5: Lint, typecheck, format, unit suite; then commit**

Run: `pnpm lint && pnpm typecheck && pnpm format && pnpm test`

```bash
git add apps/web/src/lib/hero.ts apps/web/src/components/content/hero-prompt.tsx apps/web/src/components/content/mark-hero-seen.tsx apps/web/src/components/content/hero-prompt.test.tsx apps/web/src/app/page.tsx apps/web/src/app/page.test.tsx apps/web/src/app/globals.css apps/web/e2e/polish.spec.ts
git commit -m "feat(web): the home prompt types itself once per session

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The experience timeline draws itself (G)

**Files:**
- Create: `apps/web/src/components/content/timeline.tsx`
- Create: `apps/web/src/components/content/timeline.test.tsx`
- Modify: `apps/web/src/app/experience/page.tsx` (use `<Timeline>` for the `<ol>`)
- Modify: `apps/web/src/app/globals.css` (append the timeline block)
- Modify: `apps/web/e2e/polish.spec.ts` (append)

**Interfaces:**
- Produces:
  - `timelineProgress(top: number, height: number, viewport: number): number`, in 0..1;
  - `<Timeline>{li…}</Timeline>`, which renders an `<ol class="timeline …">` and sets `data-timeline-ready`, `--timeline-progress`, `--timeline-end` and each `li[data-lit]`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/content/timeline.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Timeline, timelineProgress } from "./timeline";

function stubReducedMotion(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" ? reduced : false,
    })),
  );
}

// Each <li> reports a fixed viewport top; the list spans 0..1000.
function renderTimeline(tops: number[]) {
  const result = render(
    <Timeline>
      {tops.map((top) => (
        <li key={top} data-top={top}>
          entry at {top}
        </li>
      ))}
    </Timeline>,
  );
  const list = result.container.querySelector("ol")!;
  list.getBoundingClientRect = () => ({ top: 0, height: 1000 }) as DOMRect;
  for (const item of list.querySelectorAll("li")) {
    const top = Number(item.getAttribute("data-top"));
    item.getBoundingClientRect = () => ({ top }) as DOMRect;
  }
  return { ...result, list };
}

beforeEach(() => {
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("timelineProgress", () => {
  it("is how far the 65% viewport line has moved down the list", () => {
    expect(timelineProgress(0, 1000, 800)).toBeCloseTo(0.52);
    expect(timelineProgress(600, 1000, 800)).toBe(0);
    expect(timelineProgress(-2000, 1000, 800)).toBe(1);
    expect(timelineProgress(0, 0, 800)).toBe(1);
  });
});

describe("Timeline", () => {
  it("renders a full, fully lit timeline with reduced motion", () => {
    stubReducedMotion(true);
    const { list } = renderTimeline([100, 900]);
    expect(list.hasAttribute("data-timeline-ready")).toBe(false);
    expect(list.querySelectorAll("li[data-lit]")).toHaveLength(0); // CSS lights all when not ready
  });

  it("lights entries above the 65% line, then more as the page scrolls", () => {
    stubReducedMotion(false);
    const { list } = renderTimeline([100, 900]);
    // jsdom has no layout, so re-measure once the rect stubs exist.
    window.dispatchEvent(new Event("scroll"));
    expect(list.hasAttribute("data-timeline-ready")).toBe(true);
    const [first, second] = list.querySelectorAll("li");
    expect(first.hasAttribute("data-lit")).toBe(true);
    expect(second.hasAttribute("data-lit")).toBe(false);
    expect(list.style.getPropertyValue("--timeline-progress")).toBe("0.52");

    second.getBoundingClientRect = () => ({ top: 400 }) as DOMRect;
    window.dispatchEvent(new Event("scroll"));
    expect(second.hasAttribute("data-lit")).toBe(true);
  });
});
```

Run: `pnpm vitest run src/components/content/timeline.test.tsx`
Expected: FAIL, because `./timeline` cannot be resolved.

- [ ] **Step 2: Implement**

`apps/web/src/components/content/timeline.tsx`:

```tsx
"use client";

import { type ReactNode, useEffect, useRef } from "react";

// Entries light, and the line reaches, this far down the viewport.
const LIGHT_AT = 0.65;
// Distance from an entry's top to its dot's centre (matches .timeline > li::before in globals.css).
const DOT_CENTER = 24;

// How far the LIGHT_AT line has moved down a list whose top is `top` px from the viewport top.
export function timelineProgress(top: number, height: number, viewport: number): number {
  if (height <= 0) return 1;
  return Math.min(1, Math.max(0, (viewport * LIGHT_AT - top) / height));
}

// /experience: a mint line grows down the list as the visitor scrolls and each entry's dot lights
// as it passes. Without JS or with reduced motion the list keeps its final state (full line, every
// dot lit), because the CSS only dims anything once data-timeline-ready is set.
export function Timeline({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = ref.current;
    if (!list || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;

    function update() {
      frame = 0;
      const items = Array.from(list!.children) as HTMLElement[];
      const rect = list!.getBoundingClientRect();
      const tops = items.map((item) => item.getBoundingClientRect().top);
      const doc = document.documentElement;
      const atBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 2;
      const progress = atBottom ? 1 : timelineProgress(rect.top, rect.height, window.innerHeight);
      const last = tops.at(-1);
      list!.style.setProperty("--timeline-progress", String(Math.round(progress * 100) / 100));
      if (last !== undefined) {
        list!.style.setProperty("--timeline-end", `${rect.height - (last - rect.top) - DOT_CENTER}px`);
      }
      items.forEach((item, index) => {
        if (atBottom || tops[index] < window.innerHeight * LIGHT_AT) item.dataset.lit = "";
      });
    }
    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(update);
    }

    update(); // light what is already in view before dimming the rest: no flicker
    list.dataset.timelineReady = "";
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <ol ref={ref} className="timeline divide-y divide-dashed divide-border">
      {children}
    </ol>
  );
}
```

The test expects `--timeline-progress` to be `"0.52"`, and the rounding to 2 decimals keeps that value stable. If lint objects to the non-null assertions inside `update`, capture `const el = list;` after the guard and use `el` instead.

Append to `apps/web/src/app/globals.css`:

```css
/* /experience timeline (<Timeline>). ::before is the track, ::after the mint fill scaled by
   --timeline-progress; each entry's ::before is its dot. Until data-timeline-ready is set (no JS,
   reduced motion) the fill is full and every dot lit. --timeline-end ends the line at the last
   dot. Dots sit 24px below each entry's top (DOT_CENTER in timeline.tsx). */
.timeline {
  position: relative;
  padding-left: 1.75rem;
}
.timeline::before,
.timeline::after {
  content: "";
  position: absolute;
  left: 5px;
  top: 24px;
  bottom: var(--timeline-end, 2rem);
  width: 2px;
  border-radius: 1px;
}
.timeline::before {
  background: var(--border);
}
.timeline::after {
  background: linear-gradient(
    var(--accent-brand),
    color-mix(in srgb, var(--accent-brand) 40%, transparent)
  );
  transform-origin: top;
  transform: scaleY(var(--timeline-progress, 1));
  transition: transform 0.15s linear;
}
.timeline > li {
  position: relative;
}
.timeline > li::before {
  content: "";
  position: absolute;
  left: calc(-1.75rem + 1px);
  top: 19px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--accent-brand);
  background: var(--accent-brand);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-brand) 18%, transparent);
  transition:
    background-color 0.3s ease,
    border-color 0.3s ease,
    box-shadow 0.3s ease;
}
.timeline[data-timeline-ready] > li:not([data-lit])::before {
  border-color: var(--input);
  background: var(--background);
  box-shadow: none;
}
```

In `apps/web/src/app/experience/page.tsx`:
- import `Timeline` from `@/components/content/timeline`;
- replace `<ol className="divide-y divide-dashed divide-border">` … `</ol>` with `<Timeline>` … `</Timeline>`, keeping the `<li>` children exactly as they are.

Run: `pnpm vitest run src/components/content/timeline.test.tsx src/app/experience/page.test.tsx`
Expected: all PASS. The existing experience page tests run the effect too. If one fails because jsdom's `matchMedia` is undefined there, add the same `matchMedia` stub (reduced motion `false`) to that file's setup.

- [ ] **Step 3: e2e plus a visual check**

Append to `apps/web/e2e/polish.spec.ts`:

```ts
test("the experience timeline lights each entry as you scroll", async ({ page }) => {
  await page.goto("/experience");
  const list = page.locator("ol.timeline");
  await expect(list).toHaveAttribute("data-timeline-ready", "");
  await expect(list.locator("li").first()).toHaveAttribute("data-lit", "");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(list.locator("li").last()).toHaveAttribute("data-lit", "");
  await expect(list).toHaveCSS("--timeline-progress", "1");
  await expectNoAxeViolations(page);
});
```

Inside the existing `test.describe("reduced motion", …)` block from Task 1, append:

```ts
  test("the experience timeline is full and lit", async ({ page }) => {
    await page.goto("/experience");
    const list = page.locator("ol.timeline");
    await expect(list.locator("li").first()).toBeVisible();
    await expect(list).not.toHaveAttribute("data-timeline-ready");
    const fill = await list.evaluate((element) => getComputedStyle(element, "::after").transform);
    expect(fill === "none" || fill === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
  });
```

Run: `pnpm build && pnpm test:e2e e2e/polish.spec.ts e2e/journey.spec.ts`
Expected: all PASS.

Then screenshot `/experience` at 1280×800 and 390×844, with both the fake backend and the server running, into `/private/tmp/claude-501/-Users-christopherguzman-Desktop-coding-projects-chris-guzman-portfolio/c9749902-65e8-4cc5-949e-62067941e349/scratchpad/pr2/` as `timeline-desktop.png` and `timeline-mobile.png`. View them and check:
- each dot sits centred on its entry's company-name line, and the line runs through the dots' centres;
- the line ends at the last dot.

If not, adjust only the `top: 19px` dot offset, the `top: 24px` line offset and `DOT_CENTER` together, and note it in the report.

- [ ] **Step 4: Lint, typecheck, format, unit suite; then commit**

Run: `pnpm lint && pnpm typecheck && pnpm format && pnpm test`

```bash
git add apps/web/src/components/content/timeline.tsx apps/web/src/components/content/timeline.test.tsx apps/web/src/app/experience/page.tsx apps/web/src/app/globals.css apps/web/e2e/polish.spec.ts
git commit -m "feat(web): experience timeline draws itself as you scroll

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add `apps/web/src/app/experience/page.test.tsx` if Step 2 needed the `matchMedia` stub there.)

---

### Task 3: Project pages get editor tabs (L1)

**Files:**
- Create: `apps/web/src/components/content/project-tabs.tsx`
- Create: `apps/web/src/components/content/project-tabs.test.tsx`
- Modify: `apps/web/src/app/projects/[slug]/page.tsx` (tabs above the header; remove the Source code / Live site buttons)
- Modify: `apps/web/src/app/projects/[slug]/page.test.tsx` (link assertions)
- Modify: `apps/web/e2e/polish.spec.ts` (append)

**Interfaces:**
- Produces: `<ProjectTabs slug: string repoUrl: string | null liveUrl: string | null />`, a server component.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/content/project-tabs.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProjectTabs } from "./project-tabs";

afterEach(cleanup);

describe("ProjectTabs", () => {
  it("marks README.md as this page and links the repo and live site in new tabs", () => {
    render(
      <ProjectTabs
        slug="offres"
        repoUrl="https://github.com/example/offres"
        liveUrl="https://offres.example.com"
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Project links" });
    const readme = screen.getByRole("link", { name: "README.md" });
    expect(readme.getAttribute("href")).toBe("/projects/offres");
    expect(readme.getAttribute("aria-current")).toBe("page");

    const repo = screen.getByRole("link", { name: "repo (opens in a new tab)" });
    const live = screen.getByRole("link", { name: "live (opens in a new tab)" });
    expect(repo.getAttribute("href")).toBe("https://github.com/example/offres");
    expect(live.getAttribute("href")).toBe("https://offres.example.com");
    for (const link of [repo, live]) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
    expect(repo.getAttribute("data-umami-event-to")).toBe("repo");
    expect(live.getAttribute("data-umami-event-to")).toBe("live");
    for (const link of nav.querySelectorAll("a")) {
      expect(link.className).toContain("focus-visible:outline");
    }
  });

  it("renders only the tabs the project has links for", () => {
    render(<ProjectTabs slug="lakehouse" repoUrl="https://github.com/example/lake" liveUrl={null} />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /^live/ })).toBeNull();
    cleanup();
    render(<ProjectTabs slug="lakehouse" repoUrl={null} liveUrl={null} />);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["README.md"]);
  });
});
```

Run: `pnpm vitest run src/components/content/project-tabs.test.tsx`
Expected: FAIL, because `./project-tabs` cannot be resolved.

- [ ] **Step 2: Implement**

`apps/web/src/components/content/project-tabs.tsx`:

```tsx
import Link from "next/link";

import { outboundProps } from "@/lib/analytics";
import { cn } from "@/lib/utils";

const tab =
  "inline-flex shrink-0 items-center gap-1 border-r border-border px-3.5 py-2 font-mono text-xs focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-brand";
const inactive = "text-muted-foreground transition-colors hover:bg-card hover:text-foreground";

function ExternalTab({ href, label }: { href: string; label: "repo" | "live" }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(tab, inactive)}
      {...outboundProps(label)}
    >
      {label}
      <span aria-hidden="true">↗</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

// Project page header styled as an editor's tab bar: this page is the open README.md; the repo
// and live site are the other "tabs". Links, not ARIA tabs: each one navigates.
export function ProjectTabs({
  slug,
  repoUrl,
  liveUrl,
}: {
  slug: string;
  repoUrl: string | null;
  liveUrl: string | null;
}) {
  return (
    <nav
      aria-label="Project links"
      className="flex overflow-x-auto rounded-t-[10px] border-b border-border"
    >
      <Link
        href={`/projects/${slug}`}
        aria-current="page"
        className={cn(tab, "bg-card text-foreground shadow-[inset_0_2px_0_var(--accent-brand)]")}
      >
        README.md
      </Link>
      {repoUrl ? <ExternalTab href={repoUrl} label="repo" /> : null}
      {liveUrl ? <ExternalTab href={liveUrl} label="live" /> : null}
    </nav>
  );
}
```

Check that `outboundProps` accepts `"repo"` and `"live"`; the page already calls it with those values. If its parameter type is a union, these fit.

Run: `pnpm vitest run src/components/content/project-tabs.test.tsx`
Expected: 2 tests PASS.

- [ ] **Step 3: Use the tabs on the project page**

In `apps/web/src/app/projects/[slug]/page.tsx`:
- import `ProjectTabs` from `@/components/content/project-tabs`;
- render `<ProjectTabs slug={project.slug} repoUrl={project.repo_url} liveUrl={project.live_url} />` as the first child of the `<article>`, directly above `<PageHeader …/>`, and give the `PageHeader` a little room with a `<div className="mt-6">` wrapper;
- delete the whole `{project.repo_url || project.live_url ? ( <div className="mt-5 flex flex-wrap gap-2.5"> … </div> ) : null}` block;
- remove the imports this leaves unused (`ExternalLink`, `GitHubIcon`, and `outboundProps` if nothing else uses it). Keep `outlineButton`, which "← all projects" uses.

In `apps/web/src/app/projects/[slug]/page.test.tsx`, update the assertions that looked up `/Source code/` and `/Live site/` (around lines 81–86):
- look up `repo (opens in a new tab)` and `live (opens in a new tab)` instead, and keep the href, target and rel checks;
- for the minimal project (no links), assert there is no `repo` or `live` link and that the `README.md` link exists.

Run: `pnpm vitest run "src/app/projects/[slug]/page.test.tsx" src/components/content/project-tabs.test.tsx`
Expected: all PASS.

- [ ] **Step 4: e2e plus a visual check**

Append to `apps/web/e2e/polish.spec.ts`:

```ts
test("project pages open with editor tabs", async ({ page }) => {
  await page.goto("/projects/this-portfolio");
  const tabs = page.getByRole("navigation", { name: "Project links" });
  await expect(tabs.getByRole("link", { name: "README.md" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: /Source code|Live site/ })).toHaveCount(0);
  await expectNoAxeViolations(page);
});
```

Run: `pnpm build && pnpm test:e2e e2e/polish.spec.ts e2e/journey.spec.ts`
Expected: all PASS. The journey's "projects: list to detail" still finds the `<h1>`.

Screenshot `/projects/this-portfolio` at 1280×800 in dark and light, and at 390×844, into the `pr2/` scratchpad folder (`tabs-dark.png`, `tabs-light.png`, `tabs-mobile.png`). View them and check that the active tab reads as an open file (card background, mint top edge), that the bar's bottom border lines up, and that nothing overflows at 390 px.

- [ ] **Step 5: Lint, typecheck, format, unit suite; then commit**

Run: `pnpm lint && pnpm typecheck && pnpm format && pnpm test`

```bash
git add apps/web/src/components/content/project-tabs.tsx apps/web/src/components/content/project-tabs.test.tsx "apps/web/src/app/projects/[slug]/page.tsx" "apps/web/src/app/projects/[slug]/page.test.tsx" apps/web/e2e/polish.spec.ts
git commit -m "feat(web): project pages open as editor tabs (README.md, repo, live)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Interactive 404 terminal (K)

**Files:**
- Create: `apps/web/src/lib/not-found-terminal.ts`
- Create: `apps/web/src/lib/not-found-terminal.test.ts`
- Create: `apps/web/src/components/layout/not-found-terminal.tsx`
- Create: `apps/web/src/components/layout/not-found-terminal.test.tsx`
- Modify: `apps/web/src/app/not-found.tsx`
- Modify: `apps/web/src/app/not-found.test.tsx`
- Modify: `apps/web/e2e/polish.spec.ts` (append)

**Interfaces:**
- Consumes: `MarkNotFound` (already rendered by `not-found.tsx`; keep it), `siteConfig.nav`.
- Produces:
  - `TERMINAL_PAGES: readonly string[]`;
  - `runCommand(input: string): TerminalResult`, where `type TerminalResult = { output: string[]; navigate?: string; clear?: boolean }`;
  - `<NotFoundTerminal />` (client).

- [ ] **Step 1: Write the failing parser tests**

`apps/web/src/lib/not-found-terminal.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { runCommand, TERMINAL_PAGES } from "./not-found-terminal";

describe("runCommand", () => {
  it("lists the commands", () => {
    const { output } = runCommand("help");
    for (const command of ["help", "ls", "cd <page>", "cat resume", "whoami", "clear"]) {
      expect(output.join("\n")).toContain(command);
    }
  });

  it("lists every page", () => {
    expect(TERMINAL_PAGES).toEqual([
      "home",
      "experience",
      "education",
      "projects",
      "blog",
      "resume",
      "contact",
    ]);
    expect(runCommand("ls").output).toEqual([TERMINAL_PAGES.join("  ")]);
  });

  it("cd navigates to a page, however it is written", () => {
    expect(runCommand("cd projects").navigate).toBe("/projects");
    expect(runCommand("  CD  /blog/ ").navigate).toBe("/blog");
    expect(runCommand("cd ~/contact").navigate).toBe("/contact");
    expect(runCommand("cd home").navigate).toBe("/");
    expect(runCommand("cd ~").navigate).toBe("/");
    expect(runCommand("cd").navigate).toBe("/");
  });

  it("cd refuses pages that do not exist", () => {
    expect(runCommand("cd secrets")).toEqual({ output: ["cd: no such page: secrets"] });
  });

  it("cat resume opens the resume", () => {
    expect(runCommand("cat resume").navigate).toBe("/resume");
    expect(runCommand("cat resume.pdf").navigate).toBe("/resume");
    expect(runCommand("cat passwords.txt")).toEqual({
      output: ["cat: passwords.txt: No such file or directory"],
    });
  });

  it("whoami answers, clear clears, empty input does nothing", () => {
    expect(runCommand("whoami").output[0]).toBe("visitor");
    expect(runCommand("clear")).toEqual({ output: [], clear: true });
    expect(runCommand("   ")).toEqual({ output: [] });
  });

  it("anything else is not found, echoed back as plain text", () => {
    expect(runCommand("sudo rm -rf /")).toEqual({
      output: ["command not found: sudo (try help)"],
    });
    expect(runCommand("<img src=x onerror=alert(1)>").output).toEqual([
      "command not found: <img (try help)",
    ]);
  });
});
```

Run: `pnpm vitest run src/lib/not-found-terminal.test.ts`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 2: Implement the parser**

`apps/web/src/lib/not-found-terminal.ts`:

```ts
import { siteConfig } from "@/lib/site";

export type TerminalResult = { output: string[]; navigate?: string; clear?: boolean };

export const TERMINAL_PAGES: readonly string[] = [
  "home",
  ...siteConfig.nav.map((item) => item.href.slice(1)),
];

const HELP = [
  "commands:",
  "  help          show this list",
  "  ls            list the pages",
  "  cd <page>     go to a page",
  "  cat resume    open the resume",
  "  whoami        who are you?",
  "  clear         clear the screen",
];

// "projects", "/projects/", "~/projects" → "/projects"; "", "~", "home" → "/".
function pageHref(name: string): string | null {
  const page = name.toLowerCase().replace(/^~/, "").replace(/^\/|\/$/g, "");
  if (page === "" || page === "home") return "/";
  return TERMINAL_PAGES.includes(page) ? `/${page}` : null;
}

// The 404 page's toy shell. Output is plain strings; React renders them as text, so input can't
// inject markup.
export function runCommand(input: string): TerminalResult {
  const [command = "", ...args] = input.trim().split(/\s+/);
  const arg = args.join(" ");
  switch (command.toLowerCase()) {
    case "":
      return { output: [] };
    case "help":
      return { output: HELP };
    case "ls":
      return { output: [TERMINAL_PAGES.join("  ")] };
    case "cd": {
      const href = pageHref(arg);
      return href ? { output: [], navigate: href } : { output: [`cd: no such page: ${arg}`] };
    }
    case "cat":
      return /^resume(\.pdf)?$/i.test(arg)
        ? { output: [], navigate: "/resume" }
        : { output: [`cat: ${arg}: No such file or directory`] };
    case "whoami":
      return { output: ["visitor", "(looking for Chris? try: cd ~)"] };
    case "clear":
      return { output: [], clear: true };
    default:
      return { output: [`command not found: ${command} (try help)`] };
  }
}
```

Run: `pnpm vitest run src/lib/not-found-terminal.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing component tests**

`apps/web/src/components/layout/not-found-terminal.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotFoundTerminal } from "./not-found-terminal";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname: () => "/nope",
  useRouter: () => ({ push }),
}));

afterEach(() => {
  cleanup();
  push.mockReset();
});

function run(command: string) {
  const input = screen.getByRole("textbox", { name: /terminal command/i });
  fireEvent.change(input, { target: { value: command } });
  fireEvent.submit(input.closest("form")!);
}

describe("NotFoundTerminal", () => {
  it("reports the missing path", () => {
    render(<NotFoundTerminal />);
    expect(screen.getByText("bash: /nope: No such file or directory (404)")).toBeTruthy();
  });

  it("echoes each command with its output in a polite live region", () => {
    const { container } = render(<NotFoundTerminal />);
    run("ls");
    const log = container.querySelector("[aria-live='polite']")!;
    expect(log.textContent).toContain("visitor@chris:~$ ls");
    expect(log.textContent).toContain("projects");
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  });

  it("navigates on cd", () => {
    render(<NotFoundTerminal />);
    run("cd projects");
    expect(push).toHaveBeenCalledWith("/projects");
  });

  it("clear empties the log", () => {
    const { container } = render(<NotFoundTerminal />);
    run("help");
    run("clear");
    expect(container.querySelector("[aria-live='polite']")!.textContent).toBe("");
  });

  it("prints input as text, never as markup", () => {
    const { container } = render(<NotFoundTerminal />);
    run("<img src=x onerror=alert(1)>");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
```

Run: `pnpm vitest run src/components/layout/not-found-terminal.test.tsx`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 4: Implement the terminal**

`apps/web/src/components/layout/not-found-terminal.tsx`:

```tsx
"use client";

import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { runCommand } from "@/lib/not-found-terminal";

const PROMPT = "visitor@chris:~$";

// The 404 page's terminal. Plain links to every page are always rendered below it (not-found.tsx),
// so the page works without JS.
export function NotFoundTerminal() {
  const pathname = usePathname();
  const router = useRouter();
  const [lines, setLines] = useState<string[]>([]);
  const [value, setValue] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = runCommand(value);
    setValue("");
    if (result.clear) {
      setLines([]);
      return;
    }
    setLines((previous) => [...previous, `${PROMPT} ${value}`, ...result.output]);
    if (result.navigate) router.push(result.navigate);
  }

  return (
    <section
      aria-label="Terminal"
      className="mt-6 rounded-[10px] border border-border bg-card p-4 font-mono text-[13px] leading-relaxed"
    >
      <p className="break-words text-foreground">
        {`bash: ${pathname}: No such file or directory (404)`}
      </p>
      <p className="text-muted-foreground">
        type <span className="text-accent-brand">help</span> for commands, or{" "}
        <span className="text-accent-brand">ls</span> to list the pages
      </p>
      <div aria-live="polite" className="mt-2 whitespace-pre-wrap break-words text-foreground">
        {lines.map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </div>
      <form onSubmit={submit} className="mt-1 flex items-center gap-2">
        <span aria-hidden="true" className="shrink-0 text-accent-brand">
          {PROMPT}
        </span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label="Terminal command (try help)"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-sm bg-transparent px-1 text-foreground caret-accent-brand focus-visible:outline-2 focus-visible:outline-accent-brand"
        />
      </form>
    </section>
  );
}
```

`onSubmit` and `onChange` are React props attached by the bundled client code, not inline HTML handler attributes, so the CSP is unaffected. The `<p>` lines use index keys, which is safe because the log is append-only and `clear` replaces it wholesale.

Run: `pnpm vitest run src/components/layout/not-found-terminal.test.tsx src/lib/not-found-terminal.test.ts`
Expected: all PASS.

- [ ] **Step 5: Put it on the 404 page**

Replace `apps/web/src/app/not-found.tsx` with:

```tsx
import Link from "next/link";

import { PageHeader } from "@/components/content/page-header";
import { MarkNotFound } from "@/components/layout/logo-path";
import { NotFoundTerminal } from "@/components/layout/not-found-terminal";
import { siteConfig } from "@/lib/site";

const LINKS = [{ href: "/", label: "home" }, ...siteConfig.nav];

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <MarkNotFound />
      <PageHeader prompt="$ cd: no such page" title="Page not found" />
      <NotFoundTerminal />
      <nav aria-label="Main pages" className="mt-6">
        <ul className="flex flex-wrap gap-3">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="inline-flex items-center rounded-md border border-input px-3.5 py-2 font-mono text-sm text-foreground transition-colors hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
```

Keep the existing import order if prettier or eslint sorts it differently.

In `apps/web/src/app/not-found.test.tsx`:
- add the same `next/navigation` mock as the terminal test (`usePathname: () => "/nope"`, `useRouter: () => ({ push: vi.fn() })`), and import `vi`;
- change the links test to expect every page:

```tsx
    expect(hrefs).toEqual(
      ["/", "/blog", "/contact", "/education", "/experience", "/projects", "/resume"],
    );
```

Run: `pnpm vitest run src/app/not-found.test.tsx src/components/layout src/lib/not-found-terminal.test.ts`
Expected: all PASS.

- [ ] **Step 6: e2e**

Append to `apps/web/e2e/polish.spec.ts`:

```ts
test.describe("404 terminal", () => {
  test.use({ allowedDocumentStatus: [404] });

  test("cd projects goes to the projects page", async ({ page }) => {
    const response = await page.goto("/nope");
    expect(response?.status()).toBe(404);
    await expect(page.getByText("bash: /nope: No such file or directory (404)")).toBeVisible();
    await expectNoAxeViolations(page);
    const input = page.getByRole("textbox", { name: /terminal command/i });
    await input.fill("help");
    await input.press("Enter");
    await expect(page.getByText("cd <page>", { exact: false })).toBeVisible();
    await input.fill("cd projects");
    await input.press("Enter");
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Projects");
  });
});
```

Run: `pnpm build && pnpm test:e2e e2e/polish.spec.ts e2e/journey.spec.ts`
Expected: all PASS, including the journey's existing 404 test (status 404, `<h1>` "Page not found", axe) and PR 1's "/404 in the logo" test.

Screenshot `/nope` at 1280×800 and 390×844 after running `help`, into the `pr2/` scratchpad folder (`404-desktop.png`, `404-mobile.png`), and view them.

- [ ] **Step 7: Lint, typecheck, format, unit suite; then commit**

Run: `pnpm lint && pnpm typecheck && pnpm format && pnpm test`

```bash
git add apps/web/src/lib/not-found-terminal.ts apps/web/src/lib/not-found-terminal.test.ts apps/web/src/components/layout/not-found-terminal.tsx apps/web/src/components/layout/not-found-terminal.test.tsx apps/web/src/app/not-found.tsx apps/web/src/app/not-found.test.tsx apps/web/e2e/polish.spec.ts
git commit -m "feat(web): interactive terminal on the 404 page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The GitHub heatmap ripples in (O)

**Files:**
- Create: `apps/web/src/components/content/ripple-grid.tsx`
- Create: `apps/web/src/components/content/ripple-grid.test.tsx`
- Modify: `apps/web/src/components/content/github-activity.tsx` (the `role="img"` grid becomes `<RippleGrid>`; each week column gets `--col`)
- Modify: `apps/web/src/app/globals.css` (append the ripple block)
- Modify: `apps/web/e2e/polish.spec.ts` (append)

**Interfaces:**
- Produces: `<RippleGrid label: string>{week columns}</RippleGrid>` (client), which renders `<div role="img" aria-label={label} class="ripple-grid flex gap-[3px]">` and sets `data-ripple="armed"`, then `"play"`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/content/ripple-grid.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RippleGrid } from "./ripple-grid";

let observed: { callback: IntersectionObserverCallback; disconnect: ReturnType<typeof vi.fn> }[];

function stubReducedMotion(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" ? reduced : false,
    })),
  );
}

beforeEach(() => {
  observed = [];
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn((callback: IntersectionObserverCallback) => {
      const entry = { callback, disconnect: vi.fn() };
      observed.push(entry);
      return { observe: vi.fn(), disconnect: entry.disconnect };
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderGrid(top: number) {
  const result = render(
    <RippleGrid label="1,234 GitHub contributions in the last year">
      <div>
        <span />
      </div>
    </RippleGrid>,
  );
  return result;
}

describe("RippleGrid", () => {
  it("keeps the accessible image and arms the ripple when the heatmap starts off screen", () => {
    stubReducedMotion(false);
    // jsdom rects are all zeros: top 0, bottom 0, so "off screen" (bottom <= 0).
    renderGrid(2000);
    const grid = screen.getByRole("img", { name: "1,234 GitHub contributions in the last year" });
    expect(grid.getAttribute("data-ripple")).toBe("armed");
    observed[0].callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(grid.getAttribute("data-ripple")).toBe("play");
    expect(observed[0].disconnect).toHaveBeenCalled();
  });

  it("does nothing with reduced motion", () => {
    stubReducedMotion(true);
    renderGrid(2000);
    expect(screen.getByRole("img").hasAttribute("data-ripple")).toBe(false);
    expect(observed).toHaveLength(0);
  });
});
```

The component skips the ripple when the grid is already on screen at load. jsdom reports a zero rect (`bottom` 0), which counts as off screen, so the first test exercises the armed path. Drop the unused `top` parameter of `renderGrid` if lint complains, or use it to stub `getBoundingClientRect` and add a third case: a rect `{ top: 100, bottom: 200 }` means no `data-ripple` attribute.

Run: `pnpm vitest run src/components/content/ripple-grid.test.tsx`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 2: Implement**

`apps/web/src/components/content/ripple-grid.tsx`:

```tsx
"use client";

import { type ReactNode, useEffect, useRef } from "react";

// The home heatmap's cells pop in as a wave the first time it scrolls into view (CSS in
// globals.css, "Heatmap ripple"). Skipped when it is already on screen at load (no hide-then-show
// flash), with reduced motion, and without JS: the cells are simply there.
export function RippleGrid({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const grid = ref.current;
    if (!grid || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = grid.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < window.innerHeight) return;
    grid.dataset.ripple = "armed";
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        grid.dataset.ripple = "play";
        observer.disconnect();
      },
      { threshold: 0.3 },
    );
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} role="img" aria-label={label} className="ripple-grid flex gap-[3px]">
      {children}
    </div>
  );
}
```

Append to `apps/web/src/app/globals.css`:

```css
/* Heatmap ripple (<RippleGrid>): once armed the cells wait at their "from" frame; on "play" they
   pop in as a diagonal wave, newest week first: delay = (weeks back + row) × 20 ms. --col is set
   per week column in github-activity.tsx; rows come from the cell's position in its column. */
.ripple-grid[data-ripple] > div > span {
  animation: heat-pop 0.45s ease both paused;
  animation-delay: calc((var(--col, 0) + var(--row, 0)) * 20ms);
}
.ripple-grid[data-ripple="play"] > div > span {
  animation-play-state: running;
}
.ripple-grid > div > span:nth-child(2) {
  --row: 1;
}
.ripple-grid > div > span:nth-child(3) {
  --row: 2;
}
.ripple-grid > div > span:nth-child(4) {
  --row: 3;
}
.ripple-grid > div > span:nth-child(5) {
  --row: 4;
}
.ripple-grid > div > span:nth-child(6) {
  --row: 5;
}
.ripple-grid > div > span:nth-child(7) {
  --row: 6;
}
@keyframes heat-pop {
  from {
    opacity: 0;
    transform: scale(0.2);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ripple-grid[data-ripple] > div > span {
    animation: none;
  }
}
```

In `apps/web/src/components/content/github-activity.tsx`:
- import `RippleGrid` from `./ripple-grid`, and `type CSSProperties` from `react`;
- replace the `<div role="img" aria-label={…} className="flex gap-[3px]">` opening and closing tags with `<RippleGrid label={`${totalText} GitHub ${plural(total)} in the last year`}>` … `</RippleGrid>`, keeping the same label expression;
- on each week column `<div key=… className={cn(…)}>`, add `style={{ "--col": weeks.length - 1 - index } as CSSProperties}`.

Keep the existing comment about small cells. Cells stay unstyled inline; only the 53 columns get a style.

Run: `pnpm vitest run src/components/content/ripple-grid.test.tsx src/components/content/github-activity.test.tsx src/app/page.test.tsx`
Expected: all PASS. The existing github-activity tests still find `role="img"` with the same name.

- [ ] **Step 3: e2e**

Append to `apps/web/e2e/polish.spec.ts`:

```ts
test("the GitHub heatmap ripples in when it scrolls into view", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 }); // keep the heatmap below the fold
  await page.goto("/");
  const grid = page.getByRole("img", { name: /GitHub contributions in the last year/ });
  await expect(grid).toHaveAttribute("data-ripple", "armed");
  await grid.scrollIntoViewIfNeeded();
  await expect(grid).toHaveAttribute("data-ripple", "play");
  // The last cell to pop has settled once the wave is done (~1.6 s).
  await expect(grid.locator("span").last()).toHaveCSS("opacity", "1", { timeout: 4000 });
});
```

Inside the `test.describe("reduced motion", …)` block, append:

```ts
  test("the heatmap is simply there", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 500 });
    await page.goto("/");
    const grid = page.getByRole("img", { name: /GitHub contributions in the last year/ });
    await expect(grid).not.toHaveAttribute("data-ripple");
  });
```

The first test is desktop-sized by its own `setViewportSize`. If the mobile project makes the selector ambiguous or the heatmap is absent there, skip the test on mobile with `test.skip(isMobile, "desktop viewport check")` and add `isMobile` to its fixtures.

Run: `pnpm build && pnpm test:e2e e2e/polish.spec.ts e2e/journey.spec.ts e2e/budget.spec.ts`
Expected: all PASS. The budget test confirms the home page stays within `budgets.json`.

- [ ] **Step 4: Lint, typecheck, format, unit suite; then commit**

Run: `pnpm lint && pnpm typecheck && pnpm format && pnpm test`

```bash
git add apps/web/src/components/content/ripple-grid.tsx apps/web/src/components/content/ripple-grid.test.tsx apps/web/src/components/content/github-activity.tsx apps/web/src/app/globals.css apps/web/e2e/polish.spec.ts
git commit -m "feat(web): GitHub heatmap ripples in the first time it scrolls into view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Whole-PR verification

**Files:** none change unless a check fails. A fix goes in a separate commit, and its message names the check.

- [ ] **Step 1:** In `apps/web`, run `pnpm lint && pnpm typecheck && pnpm format && pnpm test && pnpm build && pnpm test:e2e` (the full suite, both projects). Then check that `git diff origin/main -- apps/web/e2e/budgets.json` is empty.
- [ ] **Step 2:** Run `pnpm perf:lighthouse --serve` and record each page's mobile median. Note the machine's load from `uptime`. Re-run once when the machine is idle if a page is under 95.
- [ ] **Step 3: Screenshots.** Run both the fake backend and the standalone server, and save to `/private/tmp/claude-501/-Users-christopherguzman-Desktop-coding-projects-chris-guzman-portfolio/c9749902-65e8-4cc5-949e-62067941e349/scratchpad/pr2/final/`:
  - `/` on first view, mid-typing at about 300 ms;
  - `/` after reload, in its final state;
  - `/experience` scrolled halfway;
  - `/projects/this-portfolio`, dark and light;
  - `/nope` after `help`;
  - the heatmap mid-ripple.

  View them all.

---

## Self-review notes

- **Spec coverage:**
  - **A:** Task 1. The prompt types for 0.6 s, the CTAs and status card fade, the h1, intro and photo never animate, and it runs once per session (via a session cookie, deviation 1). It has a reduced-motion final state, and the full text is in the HTML.
  - **G:** Task 2. The line grows with scroll, the dots light (deviation 2), and the no-JS and reduced-motion state is full and lit. List semantics are unchanged (`<ol>`/`<li>`).
  - **L1:** Task 3. The README.md tab is marked `aria-current`, the repo and live tabs render only when the project has those links, links open in a new tab with an announcement, the active tab has a mint top border, the style is OS-neutral, and there are no duplicate buttons (deviation 4).
  - **K:** Task 4. Covers the bash line, the hint, and the prompt input with `aria-label`. Supports help, ls, cd, cat resume, whoami and clear; unknown commands get "command not found". Output is escaped (rendered as text) in a polite live region, and a plain link list is always present. The 404 status and title are unchanged, and `MarkNotFound` is kept for the `/404` logo.
  - **O:** Task 5. The wave starts on first scroll into view (deviation 3). Reduced motion or no JS shows the cells immediately, and the data and labels are unchanged (`role="img"` and its label, and the cell `title`s).
- **Testing section of the spec:**
  - the unit tests for the hero session flag, project tabs and the 404 command parser are in Tasks 1, 3 and 4;
  - the e2e tests for 404 `cd projects`, the reduced-motion hero and timeline, and axe on the touched pages are in Tasks 1, 2, 4 and 5;
  - the JS budget and failover checks are in Task 6.
- **Names used consistently across tasks:**
  - `HERO_SEEN_COOKIE`, `HeroPrompt`, `MarkHeroSeen`;
  - `timelineProgress`, `Timeline`;
  - `ProjectTabs`;
  - `runCommand`, `TERMINAL_PAGES`, `NotFoundTerminal`;
  - `RippleGrid`.
