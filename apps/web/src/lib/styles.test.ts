import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { outlineButton } from "./styles";

const pages = [
  "app/page.tsx",
  "app/experience/page.tsx",
  "app/projects/[slug]/page.tsx",
  "app/blog/[slug]/page.tsx",
];

describe("outlineButton", () => {
  it("includes the focus ring", () => {
    expect(outlineButton).toContain("focus-visible:outline-accent-brand");
  });

  it.each(pages)("%s imports the shared class instead of redefining it", (page) => {
    const src = readFileSync(join(__dirname, "..", page), "utf8");
    expect(src).toContain('from "@/lib/styles"');
    expect(src).not.toContain("const outlineButton");
  });
});
