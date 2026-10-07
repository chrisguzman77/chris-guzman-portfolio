import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { config, proxy } from "./proxy";

afterEach(() => vi.unstubAllEnvs());

function cspOf(res: Response): string {
  return res.headers.get("content-security-policy") ?? "";
}

describe("proxy", () => {
  it("sets a CSP with a fresh nonce on every response", () => {
    vi.stubEnv("PUBLIC_API_URL", "https://api.example.test/");
    const a = cspOf(proxy(new NextRequest("https://example.test/")));
    const b = cspOf(proxy(new NextRequest("https://example.test/")));
    const nonceA = /'nonce-([A-Za-z0-9+/=]+)'/.exec(a)?.[1];
    const nonceB = /'nonce-([A-Za-z0-9+/=]+)'/.exec(b)?.[1];
    expect(nonceA).toHaveLength(24); // 16 bytes, base64
    expect(nonceA).not.toBe(nonceB);
    expect(a).toContain("connect-src 'self' https://api.example.test ");
  });

  it("passes the nonce and CSP to the app on the request", () => {
    const res = proxy(new NextRequest("https://example.test/"));
    // NextResponse.next({ request: { headers } }) encodes overrides in x-middleware-request-*.
    const nonce = res.headers.get("x-middleware-request-x-nonce");
    expect(nonce).toBeTruthy();
    expect(res.headers.get("x-middleware-request-content-security-policy")).toContain(
      `'nonce-${nonce}'`,
    );
  });

  it("skips static assets, CMS assets, analytics, API routes and .well-known", () => {
    const source = config.matcher[0].source;
    for (const path of [
      "_next/static",
      "_next/image",
      "favicon.ico",
      "cms-assets",
      "stats",
      "api",
      "\\.well-known",
    ]) {
      expect(source).toContain(path);
    }
  });
});
