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
  document.body.innerHTML = "";
});

function withRect(element: HTMLElement, left: number, top: number) {
  element.getBoundingClientRect = () => ({ left, top }) as DOMRect;
}

function hero() {
  const section = document.createElement("section");
  section.className = "hero-glow";
  const inner = document.createElement("span");
  section.append(inner);
  document.body.append(section);
  withRect(section, 40, 100);
  return { section, inner };
}

describe("PointerGlow", () => {
  it("moves the hero spotlight relative to the hero", () => {
    stubMatchMedia(true);
    const { section, inner } = hero();
    render(<PointerGlow />);
    move(inner, 120, 340);
    expect(section.style.getPropertyValue("--hero-x")).toBe("80px");
    expect(section.style.getPropertyValue("--hero-y")).toBe("240px");
    expect(document.documentElement.style.getPropertyValue("--spot-x")).toBe("");
  });

  it("tracks the pointer inside the card under it", () => {
    stubMatchMedia(true);
    const card = document.createElement("div");
    card.className = "card-glow";
    const inner = document.createElement("span");
    card.append(inner);
    document.body.append(card);
    withRect(card, 100, 300);
    render(<PointerGlow />);
    move(inner, 130, 345);
    expect(card.style.getPropertyValue("--card-x")).toBe("30px");
    expect(card.style.getPropertyValue("--card-y")).toBe("45px");
  });

  it("updates both the hero and a card inside it", () => {
    stubMatchMedia(true);
    const { section } = hero();
    const card = document.createElement("div");
    card.className = "card-glow";
    const inner = document.createElement("span");
    card.append(inner);
    section.append(card);
    withRect(card, 100, 300);
    render(<PointerGlow />);
    move(inner, 130, 345);
    expect(section.style.getPropertyValue("--hero-x")).toBe("90px");
    expect(section.style.getPropertyValue("--hero-y")).toBe("245px");
    expect(card.style.getPropertyValue("--card-x")).toBe("30px");
    expect(card.style.getPropertyValue("--card-y")).toBe("45px");
  });

  it("ignores moves outside the hero and cards", () => {
    stubMatchMedia(true);
    const plain = document.createElement("div");
    document.body.append(plain);
    render(<PointerGlow />);
    move(plain, 120, 340);
    expect(plain.getAttribute("style")).toBeNull();
    expect(document.documentElement.getAttribute("style")).toBeNull();
  });

  it("ignores touch and pen pointers", () => {
    stubMatchMedia(true);
    const { section, inner } = hero();
    render(<PointerGlow />);
    move(inner, 120, 340, "touch");
    move(inner, 120, 340, "pen");
    expect(section.style.getPropertyValue("--hero-x")).toBe("");
  });

  it("does nothing on touch screens or with reduced motion", () => {
    stubMatchMedia(false);
    const { section, inner } = hero();
    render(<PointerGlow />);
    move(inner, 120, 340);
    expect(section.style.getPropertyValue("--hero-x")).toBe("");
  });

  it("cancels a pending frame on unmount", () => {
    stubMatchMedia(true);
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", () => 7);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const { inner } = hero();
    const { unmount } = render(<PointerGlow />);
    move(inner, 10, 10);
    unmount();
    expect(cancel).toHaveBeenCalledWith(7);
  });
});
