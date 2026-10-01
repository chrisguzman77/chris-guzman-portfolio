// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Post } from "@/lib/directus/schemas";

import { PostListItem } from "./post-list-item";

afterEach(cleanup);

const post: Post = {
  id: 1,
  slug: "self-hosting",
  title: "How I self-host this site on Proxmox",
  published_at: "2026-10-14",
  excerpt: "A tour of the Compose stack.",
  body: "## Hi",
  tags: ["infra", "devops"],
  cover: null,
};

describe("PostListItem", () => {
  it("shows the full date with the day, in a time element", () => {
    render(<PostListItem post={post} />);
    const date = screen.getByText("Oct 14, 2026");
    expect(date.tagName).toBe("TIME");
    expect(date.getAttribute("datetime")).toBe("2026-10-14");
  });

  it("shows title, excerpt, and tags with no reading time", () => {
    const { container } = render(<PostListItem post={post} />);
    expect(
      screen.getByRole("heading", { level: 3, name: "How I self-host this site on Proxmox" }),
    ).toBeTruthy();
    expect(screen.getByText("A tour of the Compose stack.")).toBeTruthy();
    expect(screen.getByText("infra")).toBeTruthy();
    expect(screen.getByText("devops")).toBeTruthy();
    expect(container.textContent).not.toMatch(/min read/);
  });

  it("links the Read post button to the post", () => {
    const { container } = render(<PostListItem post={post} />);
    const link = screen.getByRole("link", { name: /read post/i });
    expect(link.getAttribute("href")).toBe("/blog/self-hosting");
    expect(link.querySelector("svg")).toBeTruthy();
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });
});
