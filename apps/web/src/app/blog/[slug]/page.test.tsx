// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPost } from "@/lib/directus/queries";
import type { Post } from "@/lib/directus/schemas";
import { renderMarkdown } from "@/lib/markdown";

import PostPage, { generateMetadata } from "./page";

vi.mock("@/lib/directus/queries", () => ({ getPost: vi.fn() }));
vi.mock("@/lib/markdown", () => ({ renderMarkdown: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

const post: Post = {
  id: 1,
  slug: "self-hosting",
  title: "How I self-host this site on Proxmox",
  published_at: "2026-10-14",
  excerpt: "A tour of the Compose stack.",
  body: "## Setup\n\n### Details\n\n## Wrap up",
  tags: ["infra", "devops"],
  cover: null,
};

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("/blog/[slug]", () => {
  it("renders header, date and tag meta line, body, table of contents, and back link", async () => {
    vi.mocked(getPost).mockResolvedValue(post);
    vi.mocked(renderMarkdown).mockResolvedValue({
      html: '<h2 id="setup">Setup</h2><p>Body paragraph.</p><h3 id="details">Details</h3><h2 id="wrap-up">Wrap up</h2>',
      headings: [
        { id: "setup", text: "Setup", depth: 2 },
        { id: "details", text: "Details", depth: 3 },
        { id: "wrap-up", text: "Wrap up", depth: 2 },
      ],
    });
    render(await PostPage(params("self-hosting")));

    expect(getPost).toHaveBeenCalledWith("self-hosting");
    expect(renderMarkdown).toHaveBeenCalledWith(post.body);
    expect(screen.getByText("$ cat posts/self-hosting.md")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: post.title })).toBeTruthy();
    expect(screen.getByText("Oct 14, 2026")).toBeTruthy();
    expect(screen.getByText("infra")).toBeTruthy();
    expect(screen.getByText("devops")).toBeTruthy();
    expect(screen.queryByText(/min read/)).toBeNull();
    expect(screen.getByText("Body paragraph.")).toBeTruthy();

    const toc = screen.getByRole("navigation", { name: "On this page" });
    const aside = toc.closest("aside")!;
    expect(aside.className.split(/\s+/)).toEqual(expect.arrayContaining(["hidden", "lg:block"]));
    expect(screen.getByRole("link", { name: "1. Setup" }).getAttribute("href")).toBe("#setup");
    const details = screen.getByRole("link", { name: "Details" });
    expect(details.getAttribute("href")).toBe("#details");
    expect(details.closest("li")!.className).toContain("pl-3");
    expect(screen.getByRole("link", { name: "2. Wrap up" }).getAttribute("href")).toBe("#wrap-up");

    expect(screen.getByRole("link", { name: /all posts/ }).getAttribute("href")).toBe("/blog");
  });

  it("omits the table of contents when the body has no headings", async () => {
    vi.mocked(getPost).mockResolvedValue({ ...post, tags: [] });
    vi.mocked(renderMarkdown).mockResolvedValue({ html: "<p>Just text.</p>", headings: [] });
    render(await PostPage(params("self-hosting")));

    expect(screen.queryByRole("navigation", { name: "On this page" })).toBeNull();
    expect(screen.queryByText("·")).toBeNull();
    expect(screen.getByText("Just text.")).toBeTruthy();
  });

  it("calls notFound for an unknown or unpublished slug", async () => {
    vi.mocked(getPost).mockResolvedValue(null);
    await expect(PostPage(params("missing"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("builds metadata from the post, and none for a missing one", async () => {
    vi.mocked(getPost).mockResolvedValue(post);
    await expect(generateMetadata(params("self-hosting"))).resolves.toEqual({
      title: post.title,
      description: post.excerpt,
    });

    vi.mocked(getPost).mockResolvedValue(null);
    await expect(generateMetadata(params("missing"))).resolves.toEqual({});
  });
});
