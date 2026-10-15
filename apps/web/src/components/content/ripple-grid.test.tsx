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
    vi.fn(function (callback: IntersectionObserverCallback) {
      const entry = { callback, disconnect: vi.fn() };
      observed.push(entry);
      return { observe: vi.fn(), disconnect: entry.disconnect };
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderGrid(rect?: { top: number; bottom: number }) {
  if (rect) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect as DOMRect);
  }
  return render(
    <RippleGrid label="1,234 GitHub contributions in the last year">
      <div>
        <span />
      </div>
    </RippleGrid>,
  );
}

describe("RippleGrid", () => {
  it("keeps the accessible image and arms the ripple when the heatmap starts off screen", () => {
    stubReducedMotion(false);
    // jsdom rects are all zeros: bottom 0, so "off screen" (bottom <= 0).
    renderGrid();
    const grid = screen.getByRole("img", { name: "1,234 GitHub contributions in the last year" });
    expect(grid.getAttribute("data-ripple")).toBe("armed");
    observed[0].callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(grid.getAttribute("data-ripple")).toBe("play");
    expect(observed[0].disconnect).toHaveBeenCalled();
  });

  it("does nothing when the heatmap is already on screen at load", () => {
    stubReducedMotion(false);
    renderGrid({ top: 100, bottom: 200 });
    expect(screen.getByRole("img").hasAttribute("data-ripple")).toBe(false);
    expect(observed).toHaveLength(0);
  });

  it("does nothing with reduced motion", () => {
    stubReducedMotion(true);
    renderGrid();
    expect(screen.getByRole("img").hasAttribute("data-ripple")).toBe(false);
    expect(observed).toHaveLength(0);
  });
});
