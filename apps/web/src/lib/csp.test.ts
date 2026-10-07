import { describe, expect, it } from "vitest";

import { buildCsp } from "./csp";

describe("buildCsp", () => {
  it("builds the production policy", () => {
    expect(
      buildCsp({
        nonce: "abc",
        apiOrigin: "https://api.christopherguzman.me",
        dev: false,
        upgradeInsecure: true,
      }),
    ).toBe(
      [
        "default-src 'self'",
        "script-src 'self' 'nonce-abc' 'strict-dynamic' https://challenges.cloudflare.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self' https://api.christopherguzman.me https://challenges.cloudflare.com",
        "frame-src https://challenges.cloudflare.com",
        "object-src 'self'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests",
      ].join("; "),
    );
  });

  it("allows eval in development and skips the upgrade over http", () => {
    const csp = buildCsp({
      nonce: "n",
      apiOrigin: "http://localhost:8000",
      dev: true,
      upgradeInsecure: false,
    });
    expect(csp).toContain("'strict-dynamic' https://challenges.cloudflare.com 'unsafe-eval';");
    expect(csp).toContain("connect-src 'self' http://localhost:8000 ");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});
