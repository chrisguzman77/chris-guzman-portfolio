import { describe, expect, it } from "vitest";

import { renderMarkdown, rewriteAssetUrls } from "./markdown";

const ID = "123e4567-e89b-12d3-a456-426614174000";

describe("rewriteAssetUrls", () => {
  it("rewrites relative and absolute Directus asset URLs to /cms-assets", () => {
    expect(rewriteAssetUrls(`![a](/assets/${ID})`)).toBe(`![a](/cms-assets/${ID})`);
    expect(rewriteAssetUrls(`![a](https://cms.christopherguzman.me/assets/${ID}?width=800)`)).toBe(
      `![a](/cms-assets/${ID}?width=800)`,
    );
  });

  it("leaves already-rewritten and unrelated URLs alone", () => {
    expect(rewriteAssetUrls(`/cms-assets/${ID}`)).toBe(`/cms-assets/${ID}`);
    expect(rewriteAssetUrls(`https://example.com/static/assets/${ID}`)).toBe(
      `https://example.com/static/assets/${ID}`,
    );
    expect(rewriteAssetUrls("/assets/not-a-uuid")).toBe("/assets/not-a-uuid");
  });
});

describe("renderMarkdown", () => {
  it("renders GFM tables", async () => {
    const { html } = await renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });

  it("adds heading ids without a clobber prefix and lists h2/h3 headings", async () => {
    const { html, headings } = await renderMarkdown(
      "## Why a Cloudflare Tunnel\n\n### Sub `x`\n\n#### Deep\n",
    );
    expect(html).toContain('<h2 id="why-a-cloudflare-tunnel">');
    expect(headings).toEqual([
      { id: "why-a-cloudflare-tunnel", text: "Why a Cloudflare Tunnel", depth: 2 },
      { id: "sub-x", text: "Sub x", depth: 3 },
    ]);
  });

  it("demotes markdown h1 headings to h2 so the post title stays the only h1", async () => {
    const { html, headings } = await renderMarkdown("# Intro\n\nText\n\n## Next\n");
    expect(html).not.toContain("<h1");
    expect(html).toContain('<h2 id="intro">Intro</h2>');
    expect(headings.map((h) => h.id)).toEqual(["intro", "next"]);
  });

  it("gives duplicate headings unique ids", async () => {
    const { html, headings } = await renderMarkdown("## Setup\n\ntext\n\n## Setup\n");
    expect(headings.map((h) => h.id)).toEqual(["setup", "setup-1"]);
    expect(html).toContain('id="setup-1"');
  });

  it("strips script tags and event handlers", async () => {
    const { html } = await renderMarkdown(
      'Hi\n\n<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[x](javascript:alert(1))\n',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
  });

  it("rewrites asset URLs in images", async () => {
    const { html } = await renderMarkdown(
      `![one](/assets/${ID})\n\n![two](https://cms.christopherguzman.me/assets/${ID})\n`,
    );
    expect(html).not.toContain(`"/assets/${ID}`);
    expect(html.match(new RegExp(`src="/cms-assets/${ID}"`, "g"))).toHaveLength(2);
  });

  it("highlights fenced code with both Shiki themes", async () => {
    const { html } = await renderMarkdown("```ts\nconst x: number = 1;\n```\n");
    expect(html).toContain("data-rehype-pretty-code-figure");
    expect(html).toContain("--shiki-dark:");
    expect(html).toContain("--shiki-light:");
  }, 20000);

  it("keeps inline code as plain code", async () => {
    const { html } = await renderMarkdown("run `make deploy` now");
    expect(html).toContain("<code>make deploy</code>");
  });
});
