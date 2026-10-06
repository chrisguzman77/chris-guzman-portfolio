import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";

describe("next.config", () => {
  it("proxies the Umami tracker and collector under /stats", async () => {
    expect(await nextConfig.rewrites?.()).toEqual([
      { source: "/stats/script.js", destination: "http://umami:3000/script.js" },
      { source: "/stats/api/send", destination: "http://umami:3000/api/send" },
    ]);
  });

  it("keeps the standalone output and image formats", () => {
    expect(nextConfig.output).toBe("standalone");
    expect(nextConfig.images).toEqual({ formats: ["image/avif", "image/webp"] });
  });
});
