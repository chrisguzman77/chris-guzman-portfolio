// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { renderMarkdown } from "@/lib/markdown";

describe("Shiki markup assumed by globals.css", () => {
  it("puts data-theme on code and --shiki-light/--shiki-dark on token spans", async () => {
    const { html } = await renderMarkdown("```ts\nconst a = 1\n```");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const code = doc.querySelector("code[data-theme]");
    expect(code).toBeTruthy();
    const span = code?.querySelector("span span");
    expect(span?.getAttribute("style")).toContain("--shiki-dark");
    expect(span?.getAttribute("style")).toContain("--shiki-light");
  });
});
