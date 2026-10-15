// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProjectTabs } from "./project-tabs";

afterEach(cleanup);

describe("ProjectTabs", () => {
  it("marks README.md as this page and links the repo and live site in new tabs", () => {
    render(
      <ProjectTabs
        slug="offres"
        repoUrl="https://github.com/example/offres"
        liveUrl="https://offres.example.com"
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Project links" });
    const readme = screen.getByRole("link", { name: "README.md" });
    expect(readme.getAttribute("href")).toBe("/projects/offres");
    expect(readme.getAttribute("aria-current")).toBe("page");

    const repo = screen.getByRole("link", { name: "repo (opens in a new tab)" });
    const live = screen.getByRole("link", { name: "live (opens in a new tab)" });
    expect(repo.getAttribute("href")).toBe("https://github.com/example/offres");
    expect(live.getAttribute("href")).toBe("https://offres.example.com");
    for (const link of [repo, live]) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
    expect(repo.getAttribute("data-umami-event-to")).toBe("repo");
    expect(live.getAttribute("data-umami-event-to")).toBe("live");
    for (const link of nav.querySelectorAll("a")) {
      expect(link.className).toContain("focus-visible:outline");
    }
  });

  it("renders only the tabs the project has links for", () => {
    render(
      <ProjectTabs slug="lakehouse" repoUrl="https://github.com/example/lake" liveUrl={null} />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /^live/ })).toBeNull();
    cleanup();
    render(<ProjectTabs slug="lakehouse" repoUrl={null} liveUrl={null} />);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["README.md"]);
  });
});
