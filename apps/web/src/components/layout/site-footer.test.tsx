// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { siteConfig } from "@/lib/site";

import { SiteFooter } from "./site-footer";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("SiteFooter", () => {
  it("shows the copyright line with the current year", () => {
    render(<SiteFooter />);
    expect(screen.getByText(`© ${new Date().getFullYear()} Christopher Guzman`)).toBeTruthy();
  });

  it("gives every footer link a visible focus ring", () => {
    render(<SiteFooter />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).toContain("focus-visible:outline");
    }
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

  it("shows dev when the build carries no deploy info", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "");
    vi.stubEnv("NEXT_PUBLIC_BUILD_TIME", "");
    render(<SiteFooter />);
    expect(screen.getByText("dev")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^commit / })).toBeNull();
    expect(document.querySelector("footer time")).toBeNull();
  });

  it("shows when and from which commit and release the site was deployed", () => {
    const sha = "cf6681f0123456789abcdef0123456789abcdef0";
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", sha);
    vi.stubEnv("NEXT_PUBLIC_APP_RELEASE", "v1.0.0");
    vi.stubEnv("NEXT_PUBLIC_BUILD_TIME", new Date(Date.now() - 2 * 3_600_000).toISOString());
    render(<SiteFooter />);
    expect(screen.getByText("2h ago").tagName).toBe("TIME");
    const commit = screen.getByRole("link", { name: "commit cf6681f on GitHub" });
    expect(commit.textContent).toBe("cf6681f");
    expect(commit.getAttribute("href")).toBe(
      `https://github.com/chrisguzman77/chris-guzman-portfolio/commit/${sha}`,
    );
    expect(
      screen.getByRole("link", { name: "release v1.0.0 on GitHub" }).getAttribute("href"),
    ).toBe("https://github.com/chrisguzman77/chris-guzman-portfolio/releases/tag/v1.0.0");
  });

  it("gives the build links a visible focus ring", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "cf6681f0123456789abcdef0123456789abcdef0");
    vi.stubEnv("NEXT_PUBLIC_APP_RELEASE", "v1.0.0");
    vi.stubEnv("NEXT_PUBLIC_BUILD_TIME", new Date().toISOString());
    render(<SiteFooter />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).toContain("focus-visible:outline");
    }
  });
});
