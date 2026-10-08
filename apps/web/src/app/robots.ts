import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { absoluteUrl } from "@/lib/seo";

export default async function robots(): Promise<MetadataRoute.Robots> {
  // Opt out of build-time prerendering so the sitemap URL follows the runtime SITE_URL.
  await connection();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin"] },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
