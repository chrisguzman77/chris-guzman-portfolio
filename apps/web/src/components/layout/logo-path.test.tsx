// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LogoPath, MarkNotFound } from "./logo-path";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

function stubReducedMotion(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" ? reduced : false,
    })),
  );
}

const suffix = (container: HTMLElement) =>
  container.querySelector("[data-logo-suffix]")?.textContent;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  nav.pathname = "/";
});

describe("LogoPath", () => {
  it("renders the current section straight away and hides it from screen readers", () => {
    stubReducedMotion(false);
    nav.pathname = "/projects/offres-offpay";
    const { container } = render(<LogoPath />);
    expect(suffix(container)).toBe("/projects");
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("deletes back to the shared prefix, then types the new section", () => {
    stubReducedMotion(false);
    nav.pathname = "/blog";
    const { container, rerender } = render(<LogoPath />);
    nav.pathname = "/projects";
    rerender(<LogoPath />);
    act(() => vi.advanceTimersByTime(35 * 2));
    expect(suffix(container)).toBe("/bl");
    act(() => vi.advanceTimersByTime(35 * 20));
    expect(suffix(container)).toBe("/projects");
  });

  it("jumps straight to the new section with reduced motion", () => {
    stubReducedMotion(true);
    nav.pathname = "/blog";
    const { container, rerender } = render(<LogoPath />);
    nav.pathname = "/experience";
    rerender(<LogoPath />);
    act(() => vi.advanceTimersByTime(1));
    expect(suffix(container)).toBe("/experience");
  });

  it("shows /404 while the not-found page is mounted, even under a known section", () => {
    stubReducedMotion(true);
    nav.pathname = "/projects/does-not-exist";
    const { container } = render(
      <>
        <LogoPath />
        <MarkNotFound />
      </>,
    );
    act(() => vi.advanceTimersByTime(1));
    expect(suffix(container)).toBe("/404");
  });
});
