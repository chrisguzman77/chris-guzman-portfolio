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

// Each <li> reports a fixed viewport top (its data-top); the list spans 0..1000. The rects are
// stubbed before render, because the effect measures once on mount.
function renderTimeline(tops: number[]) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.tagName === "OL") return { top: 0, height: 1000 } as DOMRect;
    return { top: Number(this.getAttribute("data-top")) } as DOMRect;
  });
  const result = render(
    <Timeline>
      {tops.map((top) => (
        <li key={top} data-top={top}>
          entry at {top}
        </li>
      ))}
    </Timeline>,
  );
  return { ...result, list: result.container.querySelector("ol")! };
}

beforeEach(() => {
  vi.stubGlobal("innerHeight", 800);
  // jsdom reports 0, which would count as "scrolled to the bottom" and light every entry.
  vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(5000);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
    expect(list.hasAttribute("data-timeline-ready")).toBe(true);
    const [first, second] = list.querySelectorAll("li");
    expect(first.hasAttribute("data-lit")).toBe(true);
    expect(second.hasAttribute("data-lit")).toBe(false);
    expect(list.style.getPropertyValue("--timeline-progress")).toBe("0.52");

    second.setAttribute("data-top", "400");
    window.dispatchEvent(new Event("scroll"));
    expect(second.hasAttribute("data-lit")).toBe(true);
  });
});
