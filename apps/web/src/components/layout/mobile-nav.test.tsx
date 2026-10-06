// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { siteConfig } from "@/lib/site";

import { MobileNav } from "./mobile-nav";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

afterEach(() => {
  cleanup();
  nav.pathname = "/";
});

describe("MobileNav", () => {
  it("starts closed with a labelled disclosure button", () => {
    render(<MobileNav />);
    const button = screen.getByRole("button", { name: "Open menu" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBe("mobile-menu");
    expect(screen.queryByRole("link", { name: "blog" })).toBeNull();
  });

  it("gives the toggle button and links a visible focus ring", () => {
    render(<MobileNav />);
    const button = screen.getByRole("button", { name: "Open menu" });
    expect(button.className).toContain("focus-visible:outline");
    fireEvent.click(button);
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).toContain("focus-visible:outline");
    }
  });

  it("opens to show all six links", () => {
    render(<MobileNav />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const button = screen.getByRole("button", { name: "Close menu" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(siteConfig.nav.map((i) => i.href));
  });

  it("closes on Escape and returns focus to the button", () => {
    render(<MobileNav />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    fireEvent.keyDown(document, { key: "Escape" });
    const button = screen.getByRole("button", { name: "Open menu" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it("closes when the route changes", () => {
    const { rerender } = render(<MobileNav />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    nav.pathname = "/blog";
    rerender(<MobileNav />);
    expect(screen.getByRole("button", { name: "Open menu" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("closes when a link is clicked", () => {
    render(<MobileNav />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    fireEvent.click(screen.getByRole("link", { name: "contact" }));
    const button = screen.getByRole("button", { name: "Open menu" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("mobile-menu")?.hidden).toBe(true);
  });

  it("stays closed when navigating away and back to the page it was opened on", () => {
    const { rerender } = render(<MobileNav />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    nav.pathname = "/projects";
    rerender(<MobileNav />);
    nav.pathname = "/";
    rerender(<MobileNav />);
    const button = screen.getByRole("button", { name: "Open menu" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("mobile-menu")?.hidden).toBe(true);
  });
});
