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
  it("is how far the 65% viewport line has moved from the first dot to the last", () => {
    // 65% of 800 = 520: dots at 24 and 1024 -> (520 - 24) / 1000
    expect(timelineProgress(24, 1024, 800)).toBeCloseTo(0.496);
    expect(timelineProgress(600, 1600, 800)).toBe(0);
    expect(timelineProgress(-2000, -1000, 800)).toBe(1);
    expect(timelineProgress(24, 24, 800)).toBe(1);
    expect(timelineProgress(100, 50, 800)).toBe(1);
  });
});

describe("Timeline", () => {
  it("shows the full line ending at the last dot, but arms nothing, with reduced motion", () => {
    stubReducedMotion(true);
    const { list } = renderTimeline([100, 900]);
    expect(list.hasAttribute("data-timeline-ready")).toBe(false);
    expect(list.hasAttribute("data-timeline-animate")).toBe(false);
    expect(list.querySelectorAll("li[data-lit]")).toHaveLength(0); // CSS lights all when not ready
    expect(list.style.getPropertyValue("--timeline-end")).toBe("76px"); // 1000 - 900 - 24
  });

  it("lights entries whose dot is above the 65% line, then more as the page scrolls", () => {
    stubReducedMotion(false);
    const { list } = renderTimeline([100, 900]);
    expect(list.hasAttribute("data-timeline-ready")).toBe(true);
    const [first, second] = list.querySelectorAll("li");
    expect(first.hasAttribute("data-lit")).toBe(true);
    expect(second.hasAttribute("data-lit")).toBe(false);
    // (520 - 124) / (924 - 124)
    expect(list.style.getPropertyValue("--timeline-progress")).toBe("0.5");

    second.setAttribute("data-top", "400");
    window.dispatchEvent(new Event("scroll"));
    expect(second.hasAttribute("data-lit")).toBe(true);
    expect(list.style.getPropertyValue("--timeline-progress")).toBe("1");
  });

  it("lights an entry exactly when its dot centre reaches the line", () => {
    stubReducedMotion(false);
    const { list } = renderTimeline([496, 497]); // dot centres 520 and 521 against a 520 line
    const [first, second] = list.querySelectorAll("li");
    expect(first.hasAttribute("data-lit")).toBe(true);
    expect(second.hasAttribute("data-lit")).toBe(false);
  });

  it("never retracts the line when scrolling back up", () => {
    stubReducedMotion(false);
    const { list } = renderTimeline([100, 900]);
    const [, second] = list.querySelectorAll("li");
    second.setAttribute("data-top", "400");
    window.dispatchEvent(new Event("scroll"));
    second.setAttribute("data-top", "900");
    window.dispatchEvent(new Event("scroll"));
    expect(list.style.getPropertyValue("--timeline-progress")).toBe("1");
    expect(second.hasAttribute("data-lit")).toBe(true);
  });

  it("allows transitions only after the dimmed state has had two frames", () => {
    stubReducedMotion(false);
    const queue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queue.push(callback);
      return queue.length;
    });
    const { list } = renderTimeline([100, 900]);
    expect(list.hasAttribute("data-timeline-ready")).toBe(true);
    expect(list.hasAttribute("data-timeline-animate")).toBe(false);
    queue.shift()!(0);
    expect(list.hasAttribute("data-timeline-animate")).toBe(false);
    queue.shift()!(0);
    expect(list.hasAttribute("data-timeline-animate")).toBe(true);
  });

  it("cancels the pending frames on unmount", () => {
    stubReducedMotion(false);
    vi.stubGlobal("requestAnimationFrame", () => 7);
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const { unmount } = renderTimeline([100, 900]);
    unmount();
    expect(cancel).toHaveBeenCalledWith(7);
  });
});
