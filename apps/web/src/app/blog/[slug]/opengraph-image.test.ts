import { afterEach, describe, expect, it, vi } from "vitest";

import { getPost } from "@/lib/directus/queries";
import type { Post } from "@/lib/directus/schemas";
import { ogImage } from "@/lib/og";

import Image, { contentType, size } from "./opengraph-image";

vi.mock("@/lib/directus/queries", () => ({ getPost: vi.fn() }));
vi.mock("@/lib/og", () => ({ ogImage: vi.fn(() => new Response("png")) }));

const post: Post = {
  id: 2,
  slug: "self-hosting",
  title: "How I self-host this site on Proxmox",
  published_at: "2026-10-14",
  excerpt: "Excerpt.",
  body: "Body.",
  tags: [],
  cover: null,
};

afterEach(() => vi.clearAllMocks());

describe("post Open Graph image", () => {
  it("uses the post title and prompt", async () => {
    vi.mocked(getPost).mockResolvedValue(post);
    await Image({ params: Promise.resolve({ slug: "self-hosting" }) });

    expect(getPost).toHaveBeenCalledWith("self-hosting");
    expect(ogImage).toHaveBeenCalledWith({
      title: "How I self-host this site on Proxmox",
      prompt: "$ cat posts/self-hosting.md",
    });
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
  });

  it("falls back to a generic image without echoing an unknown slug", async () => {
    vi.mocked(getPost).mockResolvedValue(null);
    await Image({ params: Promise.resolve({ slug: "<nope>" }) });

    expect(ogImage).toHaveBeenCalledWith({ title: "Blog", prompt: "$ ls posts/" });
  });
});
