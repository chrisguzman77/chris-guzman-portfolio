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

// jsdom's MouseEvent has no pointerType, so add it.
function move(target: EventTarget, clientX: number, clientY: number, pointerType = "mouse") {
  const event = new MouseEvent("pointermove", { bubbles: true, clientX, clientY });
  Object.defineProperty(event, "pointerType", { value: pointerType });
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

  it("ignores touch and pen pointers", () => {
    stubMatchMedia(true);
    render(<PointerGlow />);
    move(document.body, 120, 340, "touch");
    move(document.body, 120, 340, "pen");
    expect(document.documentElement.style.getPropertyValue("--spot-x")).toBe("");
    expect(document.documentElement.dataset.spotlight).toBeUndefined();
  });

  it("cancels a pending frame when the pointer leaves, so the spotlight stays hidden", () => {
    stubMatchMedia(true);
    const queued: FrameRequestCallback[] = [];
    const cancel = vi.fn((id: number) => {
      queued[id - 1] = () => {};
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queued.push(callback);
      return queued.length;
    });
    vi.stubGlobal("cancelAnimationFrame", cancel);
    render(<PointerGlow />);
    move(document.body, 10, 10);
    document.documentElement.dispatchEvent(new MouseEvent("pointerleave"));
    expect(cancel).toHaveBeenCalled();
    for (const callback of queued) callback(0);
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
