import { describe, expect, it } from "vitest";

import { baseOpenGraph, pageMetadata, rootOgImage } from "./metadata";

describe("pageMetadata", () => {
  it("mirrors the title and trimmed description into Open Graph, with the URL and root image", () => {
    expect(
      pageMetadata({ title: "Projects", description: "Things I built. ", path: "/projects" }),
    ).toEqual({
      title: "Projects",
      description: "Things I built.",
      openGraph: {
        ...baseOpenGraph,
        title: "Projects",
        description: "Things I built.",
        url: "/projects",
        images: [rootOgImage],
      },
    });
  });

  it("keeps the root Open Graph defaults", () => {
    expect(baseOpenGraph).toEqual({
      type: "website",
      siteName: "Christopher Guzman",
      locale: "en_US",
    });
    expect(rootOgImage).toMatchObject({ url: "/opengraph-image", width: 1200, height: 630 });
  });

  it("leaves images unset for a route with its own opengraph-image file", () => {
    const { openGraph } = pageMetadata({
      title: "A project",
      description: "Summary.",
      path: "/projects/a",
      ownImage: true,
    });
    expect(openGraph).not.toHaveProperty("images");
  });

  it("marks an article with its published time", () => {
    const { openGraph } = pageMetadata({
      title: "A post",
      description: "Excerpt.",
      path: "/blog/a",
      ownImage: true,
      article: { publishedTime: "2026-10-14" },
    });
    expect(openGraph).toMatchObject({ type: "article", publishedTime: "2026-10-14" });
  });

  it("omits article:published_time when the post has no date", () => {
    const { openGraph } = pageMetadata({
      title: "A post",
      description: "Excerpt.",
      path: "/blog/a",
      ownImage: true,
      article: { publishedTime: "" },
    });
    expect(openGraph).toMatchObject({ type: "article" });
    expect(openGraph).not.toHaveProperty("publishedTime");
  });
});
