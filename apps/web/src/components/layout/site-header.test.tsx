// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { siteConfig } from "@/lib/site";

import { SiteHeader } from "./site-header";

vi.mock("next/navigation", () => ({ usePathname: () => "/projects/offres" }));

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SiteHeader", () => {
  it("links the ~/chris-guzman logo home with an accessible name", () => {
    render(<SiteHeader />);
    const home = screen.getByRole("link", { name: /^~\/chris-guzman/ });
    expect(home.getAttribute("href")).toBe("/");
  });

  it("gives the logo and nav links a visible focus ring", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: /^~\/chris-guzman/ }).className).toContain(
      "focus-visible:outline",
    );
    expect(screen.getByRole("link", { name: "projects folder" }).className).toContain(
      "focus-visible:outline",
    );
    const nav = screen.getByRole("navigation", { name: "Main" });
    for (const link of nav.querySelectorAll("a")) {
      expect(link.className).toContain("focus-visible:outline");
    }
  });

  it("renders all six nav links in order", () => {
    render(<SiteHeader />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual(
      siteConfig.nav.map((item) => [item.label, item.href]),
    );
  });

  it("marks the link for the current section as the current page", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: "projects" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(
      screen.getByRole("link", { name: "experience" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("exposes the theme toggle and the mobile menu button", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("button", { name: /toggle theme/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open menu" })).toBeTruthy();
  });

  it("shows the current section after the logo without changing its accessible name", () => {
    render(<SiteHeader />);
    const home = screen.getByRole("link", { name: "~/chris-guzman (Christopher Guzman, home)" });
    expect(home.getAttribute("href")).toBe("/");
    expect(document.querySelector("[data-logo-suffix]")?.textContent).toBe("/projects/offres.md");
    expect(screen.getByRole("link", { name: "projects folder" }).getAttribute("href")).toBe(
      "/projects",
    );
  });

  it("draws one decorative underline indicator in the desktop nav", () => {
    render(<SiteHeader />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const bars = nav.querySelectorAll("[data-nav-indicator]");
    expect(bars).toHaveLength(1);
    expect(bars[0].getAttribute("aria-hidden")).toBe("true");
    expect((bars[0] as HTMLElement).style.opacity).toBe("1");
    expect(screen.getByRole("link", { name: "projects" }).className).not.toContain("underline");
  });
});
