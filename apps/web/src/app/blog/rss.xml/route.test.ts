// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPosts } from "@/lib/directus/queries";
import type { Post } from "@/lib/directus/schemas";

import { GET } from "./route";

vi.mock("@/lib/directus/queries", () => ({ getPosts: vi.fn() }));
// The real connection() throws outside a Next request scope.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => undefined),
}));

const tricky: Post = {
  id: 1,
  slug: "tips-and-tricks",
  title: `Tips & <tricks> "quoted" 'single'`,
  published_at: "2026-10-14",
  excerpt: "Fish & chips < tacos > soup",
  body: "## Hi",
  tags: [],
  cover: null,
};
const second: Post = {
  ...tricky,
  id: 2,
  slug: "second",
  title: "Second",
  published_at: "2026-09-02",
  excerpt: "Two",
};

function parse(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
  return doc;
}

beforeEach(() => {
  vi.stubEnv("SITE_URL", "https://example.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /blog/rss.xml", () => {
  it("returns a valid RSS 2.0 feed with one escaped item per post", async () => {
    vi.mocked(getPosts).mockResolvedValue([tricky, second]);
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");

    const xml = await res.text();
    expect(xml).toContain("Tips &amp; &lt;tricks&gt; &quot;quoted&quot; &apos;single&apos;");
    expect(xml).toContain("Fish &amp; chips &lt; tacos &gt; soup");

    const doc = parse(xml);
    expect(doc.documentElement.tagName).toBe("rss");
    expect(doc.documentElement.getAttribute("version")).toBe("2.0");

    const channel = doc.getElementsByTagName("channel")[0];
    const childText = (el: Element, tag: string) =>
      Array.from(el.children).find((c) => c.tagName === tag)?.textContent;
    expect(childText(channel, "title")).toBe("Christopher Guzman");
    expect(childText(channel, "link")).toBe("https://example.test");
    expect(childText(channel, "description")).toBeTruthy();

    const items = Array.from(doc.getElementsByTagName("item"));
    expect(items).toHaveLength(2);
    expect(childText(items[0], "title")).toBe(tricky.title);
    expect(childText(items[0], "link")).toBe("https://example.test/blog/tips-and-tricks");
    const guid = Array.from(items[0].children).find((c) => c.tagName === "guid")!;
    expect(guid.getAttribute("isPermaLink")).toBe("true");
    expect(guid.textContent).toBe("https://example.test/blog/tips-and-tricks");
    expect(childText(items[0], "pubDate")).toBe("Wed, 14 Oct 2026 00:00:00 GMT");
    expect(childText(items[0], "description")).toBe(tricky.excerpt);
    expect(childText(items[1], "pubDate")).toBe("Wed, 02 Sep 2026 00:00:00 GMT");
  });

  it("returns a valid empty feed when there are no posts", async () => {
    vi.mocked(getPosts).mockResolvedValue([]);
    const res = await GET();

    expect(res.status).toBe(200);
    const doc = parse(await res.text());
    expect(doc.getElementsByTagName("channel")).toHaveLength(1);
    expect(doc.getElementsByTagName("item")).toHaveLength(0);
  });
});
