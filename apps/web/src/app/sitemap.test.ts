import { connection } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { getPosts, getProjects } from "@/lib/directus/queries";
import type { Post, Project } from "@/lib/directus/schemas";

import sitemap from "./sitemap";

vi.mock("next/server", () => ({ connection: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/directus/queries", () => ({ getProjects: vi.fn(), getPosts: vi.fn() }));
vi.mock("@/lib/env", () => ({
  serverEnv: () => ({
    directusUrl: undefined,
    directusToken: undefined,
    apiInternalUrl: undefined,
    revalidateSecret: undefined,
    siteUrl: "https://example.test",
  }),
}));

const project: Project = {
  id: 1,
  slug: "lakehouse",
  title: "Cyber Threat Lakehouse",
  summary: "Summary.",
  body: null,
  type: "personal",
  award: null,
  tech: [],
  repo_url: null,
  live_url: null,
  cover: null,
  date: "2026-05-01",
  featured: true,
};

const post: Post = {
  id: 2,
  slug: "self-hosting",
  title: "How I self-host this site",
  published_at: "2026-10-14",
  excerpt: "Excerpt.",
  body: "Body.",
  tags: [],
  cover: null,
};

describe("sitemap", () => {
  it("lists static pages, projects, and posts with absolute URLs", async () => {
    vi.mocked(getProjects).mockResolvedValue([project]);
    vi.mocked(getPosts).mockResolvedValue([post]);

    const entries = await sitemap();

    expect(connection).toHaveBeenCalled();
    expect(entries.map((e) => e.url)).toEqual([
      "https://example.test/",
      "https://example.test/experience",
      "https://example.test/education",
      "https://example.test/projects",
      "https://example.test/blog",
      "https://example.test/resume",
      "https://example.test/contact",
      "https://example.test/projects/lakehouse",
      "https://example.test/blog/self-hosting",
    ]);
    expect(entries.find((e) => e.url.endsWith("/blog/self-hosting"))?.lastModified).toBe(
      "2026-10-14",
    );
  });

  it("still lists the static pages when the CMS returns nothing", async () => {
    vi.mocked(getProjects).mockResolvedValue([]);
    vi.mocked(getPosts).mockResolvedValue([]);

    expect(await sitemap()).toHaveLength(7);
  });
});
