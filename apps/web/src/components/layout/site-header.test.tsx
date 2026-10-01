// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { siteConfig } from "@/lib/site";

import { SiteHeader } from "./site-header";

vi.mock("next/navigation", () => ({ usePathname: () => "/projects/offres" }));

afterEach(cleanup);

describe("SiteHeader", () => {
  it("links the ~/chris-guzman logo home with an accessible name", () => {
    render(<SiteHeader />);
    const home = screen.getByRole("link", { name: /chris-guzman/ });
    expect(home.getAttribute("href")).toBe("/");
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
});
