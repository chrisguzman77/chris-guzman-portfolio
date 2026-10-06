import { NextResponse, type NextRequest } from "next/server";

import { buildCsp } from "@/lib/csp";
import { serverEnv } from "@/lib/env";

// Next 16 proxy (formerly middleware): one nonce per page request. Next reads it from the
// request's CSP header and stamps it on its own scripts; the layout reads x-nonce for the rest.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const { publicApiUrl, siteUrl } = serverEnv();
  const csp = buildCsp({
    nonce,
    apiOrigin: new URL(publicApiUrl).origin,
    dev: process.env.NODE_ENV !== "production",
    upgradeInsecure: siteUrl.startsWith("https://"),
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|cms-assets|stats|api|\\.well-known).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
