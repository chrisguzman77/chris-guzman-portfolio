// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getProject } from "@/lib/directus/queries";
import type { Project } from "@/lib/directus/schemas";
import { renderMarkdown } from "@/lib/markdown";

import ProjectPage, { generateMetadata } from "./page";

vi.mock("@/lib/directus/queries", () => ({ getProject: vi.fn() }));
vi.mock("@/lib/markdown", () => ({ renderMarkdown: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

const full: Project = {
  id: 4,
  slug: "offres",
  title: "OFFRes / OFFPay",
  summary: "Offline payment device on a Raspberry Pi 5.",
  body: "## How it works\n\nWrite-up body.",
  type: "competition",
  award: "Capital One Best Financial Hack",
  tech: ["fastapi", "react"],
  repo_url: "https://github.com/example/offres",
  live_url: "https://offres.example.com",
  cover: "0b5c3f0e-1111-4222-8333-444455556666",
  date: "2025-10-01",
  featured: true,
};

const minimal: Project = {
  ...full,
  slug: "lakehouse",
  title: "Cyber Threat Lakehouse",
  type: "personal",
  award: null,
  repo_url: null,
  live_url: null,
  cover: null,
  body: null,
  date: null,
};

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("/projects/[slug]", () => {
  it("renders the full project: header, badge, meta, tags, links, cover, body, back link", async () => {
    vi.mocked(getProject).mockResolvedValue(full);
    vi.mocked(renderMarkdown).mockResolvedValue({
      html: '<h2 id="how-it-works">How it works</h2><p>Write-up body.</p>',
      headings: [{ id: "how-it-works", text: "How it works", depth: 2 }],
    });
    render(await ProjectPage(params("offres")));

    expect(getProject).toHaveBeenCalledWith("offres");
    expect(renderMarkdown).toHaveBeenCalledWith(full.body);
    expect(screen.getByText("$ cat projects/offres.md")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "OFFRes / OFFPay" })).toBeTruthy();
    expect(screen.getByText("Capital One Best Financial Hack")).toBeTruthy();
    expect(screen.getByText("Competition · Oct 2025")).toBeTruthy();
    expect(screen.getByText(/fastapi/)).toBeTruthy();

    const repo = screen.getByRole("link", { name: /Source code/ });
    expect(repo.getAttribute("href")).toBe(full.repo_url);
    expect(repo.getAttribute("target")).toBe("_blank");
    expect(repo.getAttribute("rel")).toBe("noopener noreferrer");
    const live = screen.getByRole("link", { name: /Live site/ });
    expect(live.getAttribute("href")).toBe(full.live_url);
    expect(live.getAttribute("target")).toBe("_blank");
    expect(live.getAttribute("rel")).toBe("noopener noreferrer");

    expect(screen.getByAltText("OFFRes / OFFPay cover image").getAttribute("src")).toBe(
      `/cms-assets/${full.cover}`,
    );
    expect(screen.getByText("Write-up body.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /all projects/ }).getAttribute("href")).toBe(
      "/projects",
    );
  });

  it("omits the badge, links, cover, date, and body when they are not set", async () => {
    vi.mocked(getProject).mockResolvedValue(minimal);
    render(await ProjectPage(params("lakehouse")));

    expect(screen.getByText("Personal project")).toBeTruthy();
    expect(screen.queryByText("Capital One Best Financial Hack")).toBeNull();
    expect(screen.queryByRole("link", { name: /Source code/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Live site/ })).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(renderMarkdown).not.toHaveBeenCalled();
  });

  it("calls notFound for an unknown or unpublished slug", async () => {
    vi.mocked(getProject).mockResolvedValue(null);
    await expect(ProjectPage(params("missing"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("builds metadata from the project, and none for a missing one", async () => {
    vi.mocked(getProject).mockResolvedValue(full);
    await expect(generateMetadata(params("offres"))).resolves.toEqual({
      title: "OFFRes / OFFPay",
      description: full.summary,
    });

    vi.mocked(getProject).mockResolvedValue(null);
    await expect(generateMetadata(params("missing"))).resolves.toEqual({});
  });

  it("tags the source and live links as repo and live outbound clicks", async () => {
    vi.mocked(getProject).mockResolvedValue(full);
    vi.mocked(renderMarkdown).mockResolvedValue({ html: "", headings: [] });
    render(await ProjectPage(params("offres")));

    const repo = screen.getByRole("link", { name: /Source code/ });
    expect(repo.getAttribute("data-umami-event")).toBe("outbound-click");
    expect(repo.getAttribute("data-umami-event-to")).toBe("repo");
    const live = screen.getByRole("link", { name: /Live site/ });
    expect(live.getAttribute("data-umami-event")).toBe("outbound-click");
    expect(live.getAttribute("data-umami-event-to")).toBe("live");
  });
});
