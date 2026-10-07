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

  it("sends the static security headers on every route and hides x-powered-by", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(await nextConfig.headers?.()).toEqual([
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ]);
  });
});
