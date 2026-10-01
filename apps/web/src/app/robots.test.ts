import { describe, expect, it, vi } from "vitest";

import robots from "./robots";

vi.mock("@/lib/env", () => ({
  serverEnv: () => ({
    directusUrl: undefined,
    directusToken: undefined,
    apiInternalUrl: undefined,
    revalidateSecret: undefined,
    siteUrl: "https://example.test",
  }),
}));

describe("robots", () => {
  it("allows everything except /api/ and points at the sitemap", () => {
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: "/api/" },
      sitemap: "https://example.test/sitemap.xml",
    });
  });
});
