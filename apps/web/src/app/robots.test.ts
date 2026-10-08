import { connection } from "next/server";
import { describe, expect, it, vi } from "vitest";

import robots from "./robots";

vi.mock("next/server", () => ({ connection: vi.fn().mockResolvedValue(undefined) }));
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
  it("allows everything except /api/ and /admin and points at the sitemap", async () => {
    await expect(robots()).resolves.toEqual({
      rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin"] },
      sitemap: "https://example.test/sitemap.xml",
    });
  });

  // A static metadata route is rendered at build time, when SITE_URL is not the production
  // value. Awaiting connection() makes it render per request, so SITE_URL is read at runtime.
  it("waits for a request before reading SITE_URL", async () => {
    await robots();
    expect(connection).toHaveBeenCalled();
  });
});
