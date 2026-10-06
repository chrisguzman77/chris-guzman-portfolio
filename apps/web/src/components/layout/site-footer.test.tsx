// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { siteConfig } from "@/lib/site";

import { SiteFooter } from "./site-footer";

afterEach(cleanup);

describe("SiteFooter", () => {
  it("shows the copyright line with the current year", () => {
    render(<SiteFooter />);
    expect(screen.getByText(`© ${new Date().getFullYear()} Christopher Guzman`)).toBeTruthy();
  });

  it("links GitHub and LinkedIn in a new tab with icon-only labelled links", () => {
    render(<SiteFooter />);
    const github = screen.getByRole("link", { name: "GitHub" });
    const linkedin = screen.getByRole("link", { name: "LinkedIn" });
    expect(github.getAttribute("href")).toBe(siteConfig.links.github);
    expect(linkedin.getAttribute("href")).toBe(siteConfig.links.linkedin);
    for (const link of [github, linkedin]) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("links the RSS feed", () => {
    render(<SiteFooter />);
    const rss = screen.getByRole("link", { name: "RSS feed" });
    expect(rss.getAttribute("href")).toBe("/blog/rss.xml");
    expect(rss.querySelector("svg")).toBeTruthy();
  });

  it("tags GitHub and LinkedIn as outbound clicks but not the RSS feed", () => {
    render(<SiteFooter />);
    const github = screen.getByRole("link", { name: "GitHub" });
    const linkedin = screen.getByRole("link", { name: "LinkedIn" });
    expect(github.getAttribute("data-umami-event")).toBe("outbound-click");
    expect(github.getAttribute("data-umami-event-to")).toBe("github");
    expect(linkedin.getAttribute("data-umami-event")).toBe("outbound-click");
    expect(linkedin.getAttribute("data-umami-event-to")).toBe("linkedin");
    expect(screen.getByRole("link", { name: "RSS feed" }).hasAttribute("data-umami-event")).toBe(
      false,
    );
  });
});
