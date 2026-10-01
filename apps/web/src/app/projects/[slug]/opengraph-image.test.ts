import { afterEach, describe, expect, it, vi } from "vitest";

import { getProject } from "@/lib/directus/queries";
import type { Project } from "@/lib/directus/schemas";
import { ogImage } from "@/lib/og";

import Image, { contentType, size } from "./opengraph-image";

vi.mock("@/lib/directus/queries", () => ({ getProject: vi.fn() }));
vi.mock("@/lib/og", () => ({ ogImage: vi.fn(() => new Response("png")) }));

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
  date: null,
  featured: true,
};

afterEach(() => vi.clearAllMocks());

describe("project Open Graph image", () => {
  it("uses the project title and prompt", async () => {
    vi.mocked(getProject).mockResolvedValue(project);
    await Image({ params: Promise.resolve({ slug: "lakehouse" }) });

    expect(getProject).toHaveBeenCalledWith("lakehouse");
    expect(ogImage).toHaveBeenCalledWith({
      title: "Cyber Threat Lakehouse",
      prompt: "$ cat projects/lakehouse.md",
    });
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
  });

  it("falls back to a generic image without echoing an unknown slug", async () => {
    vi.mocked(getProject).mockResolvedValue(null);
    await Image({ params: Promise.resolve({ slug: "<nope>" }) });

    expect(ogImage).toHaveBeenCalledWith({ title: "Projects", prompt: "$ ls projects/" });
  });
});
