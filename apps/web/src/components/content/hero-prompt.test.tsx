// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HERO_SEEN_COOKIE } from "@/lib/hero";

import { HeroPrompt } from "./hero-prompt";

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.heroSeen;
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

describe("HeroPrompt remounted in the same page session", () => {
  it("is switched to its final state before paint (back/forward replay)", async () => {
    vi.resetModules(); // fresh module-level "played" flag
    const { HeroPrompt: Fresh } = await import("./hero-prompt");
    render(<Fresh animate />);
    expect(document.documentElement.hasAttribute("data-hero-seen")).toBe(false);
    cleanup();
    render(<Fresh animate />);
    expect(document.documentElement.hasAttribute("data-hero-seen")).toBe(true);
  });
});
