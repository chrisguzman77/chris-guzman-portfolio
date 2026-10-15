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
