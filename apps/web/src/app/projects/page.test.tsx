// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getProjects } from "@/lib/directus/queries";
import type { Project } from "@/lib/directus/schemas";

import ProjectsPage, { metadata } from "./page";

vi.mock("@/lib/directus/queries", () => ({ getProjects: vi.fn() }));

function project(over: Partial<Project> & Pick<Project, "id" | "slug" | "title">): Project {
  return {
    summary: `${over.title} summary`,
    body: null,
    type: "personal",
    award: null,
    tech: ["next.js"],
    repo_url: null,
    live_url: null,
    cover: null,
    date: "2026-01-01",
    featured: false,
    ...over,
  };
}

const personal = [
  project({ id: 1, slug: "lakehouse", title: "Cyber Threat Lakehouse" }),
  project({ id: 2, slug: "acm", title: "ACM@AU platform" }),
  project({ id: 3, slug: "portfolio", title: "This portfolio" }),
];
const competition = project({
  id: 4,
  slug: "offres",
  title: "OFFRes / OFFPay",
  type: "competition",
  award: "Capital One Best Financial Hack",
});

function numberedHeadings(): string[] {
  return screen
    .queryAllByRole("heading", { level: 2 })
    .map((h) => (h.textContent ?? "").replace(/\s+/g, ""))
    .filter((t) => /^\d{2}/.test(t));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("/projects", () => {
  it("sets the page title", () => {
    expect(metadata.title).toBe("Projects");
  });

  it("renders Personal projects then Competitions with counts and card links", async () => {
    vi.mocked(getProjects).mockResolvedValue([competition, ...personal]);
    const { container } = render(await ProjectsPage());

    expect(screen.getByText("$ ls projects/")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Projects" })).toBeTruthy();
    expect(numberedHeadings()).toEqual([
      expect.stringMatching(/^01Personalprojects/),
      expect.stringMatching(/^02Competitions/),
    ]);
    expect(screen.getByText("3 projects")).toBeTruthy();
    expect(screen.getByText("1 project")).toBeTruthy();

    const text = container.textContent ?? "";
    expect(text.indexOf("This portfolio")).toBeLessThan(text.indexOf("OFFRes / OFFPay"));
    expect(screen.getByRole("link", { name: /OFFRes \/ OFFPay/ }).getAttribute("href")).toBe(
      "/projects/offres",
    );
    expect(screen.getByText("Capital One Best Financial Hack")).toBeTruthy();
  });

  it("does not render an empty section and renumbers the other", async () => {
    vi.mocked(getProjects).mockResolvedValue([competition]);
    render(await ProjectsPage());

    expect(numberedHeadings()).toEqual([expect.stringMatching(/^01Competitions/)]);
    expect(screen.queryByText(/Personal projects/)).toBeNull();
  });

  it("shows the empty state when no projects are published", async () => {
    vi.mocked(getProjects).mockResolvedValue([]);
    render(await ProjectsPage());

    expect(numberedHeadings()).toEqual([]);
    expect(screen.getByText("No projects published yet.")).toBeTruthy();
  });
});
