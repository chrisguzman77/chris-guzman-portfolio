import { connection } from "next/server";

import { getPosts } from "@/lib/directus/queries";
import { serverEnv } from "@/lib/env";
import { siteConfig } from "@/lib/site";

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

// Control characters that XML 1.0 forbids even when escaped (tab, LF, CR are allowed).
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function escapeXml(value: string): string {
  return value.replace(XML_ILLEGAL, "").replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch]);
}

// Date-only values are midnight UTC; datetimes without a zone are read as UTC, never server-local.
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** RFC 822 date, e.g. "Wed, 14 Oct 2026 09:30:00 GMT". */
function rfc822(timestamp: string): string {
  const iso = timestamp.includes("T") && !HAS_ZONE.test(timestamp) ? `${timestamp}Z` : timestamp;
  return new Date(iso).toUTCString();
}

export async function GET(): Promise<Response> {
  await connection();
  const { siteUrl } = serverEnv();
  const posts = await getPosts();

  const items = posts.map((post) => {
    const link = escapeXml(`${siteUrl}/blog/${post.slug}`);
    return [
      "    <item>",
      `      <title>${escapeXml(post.title)}</title>`,
      `      <link>${link}</link>`,
      `      <guid isPermaLink="true">${link}</guid>`,
      `      <pubDate>${rfc822(post.published_at)}</pubDate>`,
      `      <description>${escapeXml(post.excerpt)}</description>`,
      "    </item>",
    ].join("\n");
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(siteConfig.name)}</title>`,
    `    <link>${escapeXml(siteUrl)}</link>`,
    `    <description>${escapeXml(siteConfig.description)}</description>`,
    "    <language>en-us</language>",
    `    <atom:link href="${escapeXml(`${siteUrl}/blog/rss.xml`)}" rel="self" type="application/rss+xml" />`,
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");

  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
