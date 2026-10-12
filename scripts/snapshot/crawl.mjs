#!/usr/bin/env node
// Snapshot the live public site for the failover Worker.
//
//   node scripts/snapshot/crawl.mjs --origin https://christopherguzman.me --out snapshot
//
// Writes <out>/files/<sha256 of key> and <out>/manifest.json (see
// .superpowers/sdd/failover/manifest-interface.md). Nothing is written if the
// safety checks fail; the process exits 1 instead. Dependency-free Node 24.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  assetKey,
  checkSafety,
  extractCssRefs,
  extractHtmlRefs,
  extractJsChunkRefs,
  fileName,
  isExcluded,
  isImageKey,
  isSameOrigin,
  pageKey,
} from "./lib.mjs";

const USER_AGENT = "portfolio-snapshot (+https://github.com/chrisguzman77/chris-guzman-portfolio)";
const CONCURRENCY = 4;
const TIMEOUT_MS = 15_000;

const { values: args } = parseArgs({ options: { origin: { type: "string" }, out: { type: "string" } } });
if (!args.origin || !args.out) {
  console.error("usage: node scripts/snapshot/crawl.mjs --origin https://example.com --out <dir>");
  process.exit(2);
}
const origin = new URL(args.origin).origin;

/** Fetch one key. Redirects are not followed: a redirect is not something the snapshot can serve. */
async function get(kind, key) {
  const headers = { "User-Agent": USER_AGENT, "Accept-Encoding": "identity" };
  if (kind === "page") headers.Accept = "text/html";
  else if (isImageKey(key)) headers.Accept = "image/avif,image/webp,*/*";
  try {
    const res = await fetch(origin + key, { headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = Buffer.from(await res.arrayBuffer());
    return { kind, key, status: res.status, headers: Object.fromEntries(res.headers), body };
  } catch (err) {
    return { kind, key, status: 0, headers: {}, body: Buffer.alloc(0), error: err.message };
  }
}

async function mapLimit(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

const seen = new Set();
/** Same-origin, not excluded, not seen yet: returns the key to fetch, else null. */
function claim(url, keyFn = assetKey) {
  if (!isSameOrigin(url, origin)) return null;
  const key = keyFn(new URL(url));
  if (isExcluded(key) || seen.has(key)) return null;
  seen.add(key);
  return key;
}

const warnings = [];
const results = [];

// 1. Sitemap and its pages.
const sitemap = await get("asset", "/sitemap.xml");
if (sitemap.status !== 200) {
  console.error(`sitemap.xml returned ${sitemap.status}${sitemap.error ? ` (${sitemap.error})` : ""}; aborting`);
  process.exit(1);
}
seen.add("/sitemap.xml");
results.push(sitemap);
const pageKeys = [...sitemap.body.toString("utf8").matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
  .map((m) => claim(m[1].replaceAll("&amp;", "&"), pageKey))
  .filter(Boolean);

// 2. Pages, collecting the refs they make.
let queue = [];
const enqueue = (url) => {
  const key = claim(url);
  if (key) queue.push(key);
};
for (const p of await mapLimit(pageKeys, (k) => get("page", k))) {
  results.push(p);
  if (p.status === 200) extractHtmlRefs(p.body.toString("utf8"), origin + p.key).forEach(enqueue);
}

// 3. Static extras. The RSS feed is picked up from <link rel=alternate type=application/rss+xml> above.
["/robots.txt", "/icon.svg"].forEach((k) => enqueue(origin + k));

// 4. Assets, breadth-first: stylesheets and scripts can name more assets.
while (queue.length) {
  const level = queue;
  queue = [];
  for (const a of await mapLimit(level, (k) => get("asset", k))) {
    if (a.status !== 200) {
      warnings.push(`skipped ${a.key}: ${a.status || a.error}`);
      continue;
    }
    results.push(a);
    const type = a.headers["content-type"] ?? "";
    const path = a.key.split("?")[0];
    if (type.includes("text/css") || path.endsWith(".css")) {
      extractCssRefs(a.body.toString("utf8"), origin + a.key).forEach(enqueue);
    } else if (path.startsWith("/_next/static/") && (type.includes("javascript") || path.endsWith(".js"))) {
      extractJsChunkRefs(a.body.toString("utf8"), origin).forEach(enqueue);
    }
  }
}

// 5. Safety checks, then write.
const problems = checkSafety(results);
if (problems.length) {
  console.error(`snapshot aborted, ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const entries = {};
let bytes = 0;
await mkdir(join(args.out, "files"), { recursive: true });
for (const r of results) {
  const entry = { file: fileName(r.key), type: r.headers["content-type"] ?? "application/octet-stream" };
  if (r.kind === "page" && r.headers["content-security-policy"]) entry.csp = r.headers["content-security-policy"];
  if (r.headers["cache-control"]) entry.cacheControl = r.headers["cache-control"];
  entries[r.key] = entry;
  bytes += r.body.length;
  await writeFile(join(args.out, entry.file), r.body);
}
const pages = results.filter((r) => r.kind === "page").length;
const manifest = {
  version: 1,
  createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  origin,
  pages,
  entries,
};
await writeFile(join(args.out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `snapshot: ${pages} pages, ${results.length - pages} assets, ${bytes} bytes, ${warnings.length} warnings`,
);
for (const w of warnings) console.log(`  warning: ${w}`);
