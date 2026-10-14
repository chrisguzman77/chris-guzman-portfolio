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
