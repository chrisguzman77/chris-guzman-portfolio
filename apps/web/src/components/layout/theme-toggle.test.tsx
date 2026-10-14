// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { revealRadius, ThemeToggle } from "./theme-toggle";

const setTheme = vi.hoisted(() => vi.fn());
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark", setTheme }) }));

function stubReducedMotion(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" ? reduced : false,
    })),
  );
}

let animate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  animate = vi.fn();
  document.documentElement.animate = animate as unknown as typeof document.documentElement.animate;
});

afterEach(() => {
  cleanup();
  setTheme.mockReset();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "startViewTransition");
});

function withViewTransitions() {
  const start = vi.fn((update: () => void) => {
    update();
    return { ready: Promise.resolve(), finished: Promise.resolve() };
  });
  Object.defineProperty(document, "startViewTransition", { value: start, configurable: true });
  return start;
}

describe("ThemeToggle", () => {
  it("has a visible focus ring", () => {
    stubReducedMotion(false);
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Toggle theme" }).className).toContain(
      "focus-visible:outline",
    );
  });

  it("reveals the new theme in a circle from the button when view transitions exist", async () => {
    stubReducedMotion(false);
    const start = withViewTransitions();
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(start).toHaveBeenCalledOnce();
    expect(setTheme).toHaveBeenCalledWith("light");
    await vi.waitFor(() => expect(animate).toHaveBeenCalledOnce());
    const [keyframes, options] = animate.mock.calls[0];
    expect(keyframes.clipPath[0]).toMatch(/^circle\(0px at /);
    expect(options).toMatchObject({
      duration: 650,
      easing: "ease-in-out",
      pseudoElement: "::view-transition-new(root)",
    });
  });

  it("switches instantly without the View Transitions API", () => {
    stubReducedMotion(false);
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(setTheme).toHaveBeenCalledWith("light");
    expect(animate).not.toHaveBeenCalled();
  });

  it("switches instantly with reduced motion even when view transitions exist", () => {
    stubReducedMotion(true);
    const start = withViewTransitions();
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(start).not.toHaveBeenCalled();
    expect(setTheme).toHaveBeenCalledWith("light");
  });
});

describe("revealRadius", () => {
  it("reaches the farthest corner of the viewport", () => {
    expect(revealRadius(0, 0, 300, 400)).toBe(500);
    expect(revealRadius(1240, 28, 1280, 800)).toBeCloseTo(Math.hypot(1240, 772));
  });
});
