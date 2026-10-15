// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function stubInitialUrl(url: string | null) {
  vi.spyOn(performance, "getEntriesByType").mockReturnValue(
    url === null ? [] : ([{ name: url }] as unknown as PerformanceEntryList),
  );
}

beforeEach(() => {
  vi.resetModules(); // fresh module state (the "played" flag) per test
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.heroSeen;
});

describe("shouldAnimateHero", () => {
  it("animates only for the first mount of a document loaded at /", async () => {
    const { shouldAnimateHero } = await import("./mark-hero-seen");
    expect(shouldAnimateHero("/", false)).toBe(true);
    expect(shouldAnimateHero("/", true)).toBe(false); // back/forward or a later visit in the tab
    expect(shouldAnimateHero("/projects", false)).toBe(false); // arrived at / by clicking a link
    expect(shouldAnimateHero(null, false)).toBe(true); // no Navigation Timing: treat as a load
    expect(shouldAnimateHero("/", false, "back_forward")).toBe(false); // restored by Back/Forward
    expect(shouldAnimateHero("/", false, "reload")).toBe(true);
    expect(shouldAnimateHero("/", false, "navigate")).toBe(true);
  });
});

describe("HeroPrompt", () => {
  it("types on a fresh load of the home page", async () => {
    stubInitialUrl("https://christopherguzman.me/");
    const { HeroPrompt } = await import("./hero-prompt");
    const { container } = render(<HeroPrompt />);
    expect(screen.getByText("$ whoami").className).toContain("hero-type");
    expect(container.querySelector(".hero-caret")?.getAttribute("aria-hidden")).toBe("true");
    expect(document.documentElement.dataset.heroSeen).toBeUndefined();
  });

  it("renders final when home is reached by client navigation", async () => {
    stubInitialUrl("https://christopherguzman.me/projects");
    const { HeroPrompt } = await import("./hero-prompt");
    render(<HeroPrompt />);
    expect(document.documentElement.dataset.heroSeen).toBe("");
  });

  it("renders final on a second mount in the same document", async () => {
    stubInitialUrl("https://christopherguzman.me/");
    const { HeroPrompt } = await import("./hero-prompt");
    render(<HeroPrompt />);
    cleanup();
    render(<HeroPrompt />);
    expect(document.documentElement.dataset.heroSeen).toBe("");
  });

  it("sets no cookie", async () => {
    stubInitialUrl("https://christopherguzman.me/");
    const { HeroPrompt } = await import("./hero-prompt");
    render(<HeroPrompt />);
    expect(document.cookie).not.toContain("cg-hero-seen");
  });
});
