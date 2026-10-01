// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPosts } from "@/lib/directus/queries";
import type { Post } from "@/lib/directus/schemas";

import BlogPage, { metadata } from "./page";

vi.mock("@/lib/directus/queries", () => ({ getPosts: vi.fn() }));

function post(over: Partial<Post> & Pick<Post, "id" | "slug" | "title">): Post {
  return {
    published_at: "2026-10-14",
    excerpt: `${over.title} excerpt`,
    body: "## Hello",
    tags: ["infra"],
    cover: null,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("/blog", () => {
  it("sets the title and advertises the RSS feed", () => {
    expect(metadata.title).toBe("Blog");
    expect(metadata.alternates?.types).toEqual({ "application/rss+xml": "/blog/rss.xml" });
  });

  it("renders every post in query order with dashed separators", async () => {
    vi.mocked(getPosts).mockResolvedValue([
      post({ id: 2, slug: "newer", title: "Newer post", published_at: "2026-10-28" }),
      post({ id: 1, slug: "older", title: "Older post", published_at: "2026-10-14" }),
    ]);
    const { container } = render(await BlogPage());

    expect(screen.getByText("$ ls posts/")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Blog" })).toBeTruthy();

    const list = container.querySelector("ol.divide-dashed");
    expect(list).not.toBeNull();
    expect(list!.children).toHaveLength(2);

    const text = container.textContent ?? "";
    expect(text.indexOf("Newer post")).toBeGreaterThan(-1);
    expect(text.indexOf("Newer post")).toBeLessThan(text.indexOf("Older post"));
    expect(screen.queryByText(/First post coming soon/)).toBeNull();
  });

  it("shows the terminal-style empty state when there are no posts", async () => {
    vi.mocked(getPosts).mockResolvedValue([]);
    const { container } = render(await BlogPage());

    expect(screen.getByText("$ ls posts/ → nothing yet. First post coming soon.")).toBeTruthy();
    expect(container.querySelector("ol")).toBeNull();
  });
});
