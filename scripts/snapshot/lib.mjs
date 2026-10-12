// Pure helpers for the snapshot crawler (crawl.mjs). No I/O here, so every
// function is unit-tested in crawl.test.mjs.
import { createHash } from "node:crypto";

const toUrl = (u) => (u instanceof URL ? u : new URL(u));

/** Manifest key for an HTML page: pathname, trailing slash stripped except for "/". */
export function pageKey(url) {
  const { pathname } = toUrl(url);
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
}

/** Manifest key for an asset: pathname plus search, exactly as requested (no fragment). */
export function assetKey(url) {
  const u = toUrl(url);
  return u.pathname + u.search;
}

export function isSameOrigin(url, origin) {
  return toUrl(url).origin === toUrl(origin).origin;
}

/** Keys that must never be in the snapshot (live features and private routes). */
export function isExcluded(key) {
  return (
    key.startsWith("/api/") ||
    key.startsWith("/stats/") ||
    new URL(key, "http://x").searchParams.has("_rsc") ||
    key.startsWith("/admin") ||
    key.startsWith("/newsletter/")
  );
}

/** Images get an Accept header that lets the optimizer pick AVIF/WebP. */
export function isImageKey(key) {
  const { pathname } = new URL(key, "http://x");
  return pathname === "/_next/image" || /\.(?:avif|webp|png|jpe?g|gif|svg|ico)$/i.test(pathname);
}

const ENTITIES = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(n);
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function resolve(ref, baseUrl) {
  const s = ref.trim();
  if (!s || /^(?:data|blob|javascript|mailto|tel):/i.test(s) || s.startsWith("#")) return null;
  try {
    const u = new URL(s, baseUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

function srcsetUrls(srcset) {
  // Candidates are "url descriptor" separated by commas; split on a comma that
  // follows a descriptor or is followed by whitespace, so URLs keep their commas.
  return srcset
    .split(/(?<=\s\d+(?:\.\d+)?[wx])\s*,\s*|\s*,\s+/)
    .map((c) => c.trim().split(/\s+/)[0])
    .filter(Boolean);
}

const TAG = /<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
const ATTR = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const LINK_RELS = new Set(["stylesheet", "icon", "apple-touch-icon", "manifest", "preload", "modulepreload"]);

function parseAttrs(raw) {
  const attrs = {};
  for (const m of raw.matchAll(ATTR)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/** Absolute URLs of the assets an HTML page references (cross-origin included; the caller filters). */
export function extractHtmlRefs(html, baseUrl) {
  // Inline script bodies and comments hold strings that look like markup but are not requested.
  const markup = html.replace(/<!--[\s\S]*?-->/g, "").replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, "$1");
  const base = new URL(baseUrl);
  const out = new Set();
  const add = (ref) => {
    const u = ref == null ? null : resolve(ref, base);
    if (u) out.add(u);
  };

  for (const [, rawTag, rawAttrs] of markup.matchAll(TAG)) {
    const tag = rawTag.toLowerCase();
    const a = parseAttrs(rawAttrs);
    if (a.src) add(a.src);
    for (const name of ["srcset", "imagesrcset"]) {
      if (a[name]) srcsetUrls(a[name]).forEach(add);
    }
    if (tag === "link" && a.href) {
      const rels = (a.rel ?? "").toLowerCase().split(/\s+/);
      const isFeed = rels.includes("alternate") && (a.type ?? "").toLowerCase() === "application/rss+xml";
      if (isFeed || rels.some((r) => LINK_RELS.has(r))) add(a.href);
    } else if (tag === "a" && a.href) {
      const u = resolve(a.href, base);
      if (u && isSameOrigin(u, base) && new URL(u).pathname.endsWith(".xml")) out.add(u);
    } else if (tag === "object" && a.data) {
      add(a.data);
    } else if (tag === "meta" && a.content) {
      const p = (a.property ?? "").toLowerCase();
      const n = (a.name ?? "").toLowerCase();
      if (p === "og:image" || n === "twitter:image") add(a.content);
    }
  }
  return [...out];
}

/** Absolute URLs from CSS url(...), ignoring data: URIs and #fragment references. */
export function extractCssRefs(css, baseUrl) {
  const out = new Set();
  for (const m of css.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/g)) {
    const u = resolve(m[2], baseUrl);
    if (u) out.add(u);
  }
  return [...out];
}

/**
 * Absolute URLs of /_next/static chunks named in a script. Webpack builds name
 * them "/_next/static/...". Turbopack's lazy loaders name them "static/chunks/..."
 * relative to /_next/, so a string literal starting with "static/" counts too.
 */
export function extractJsChunkRefs(js, origin) {
  const out = new Set();
  const re = /\/_next\/(static\/[\w/.-]+\.(?:js|css))|(?<=["'`])(static\/[\w/.-]+\.(?:js|css))(?=["'`])/g;
  for (const m of js.matchAll(re)) {
    out.add(new URL(`/_next/${m[1] ?? m[2]}`, origin).href);
  }
  return [...out];
}

/** Object name for a key inside a snapshot prefix. */
export function fileName(key) {
  return `files/${createHash("sha256").update(key).digest("hex")}`;
}

/**
 * Problems that must stop the upload. results: [{ kind: "page"|"asset", key, status, headers, body }]
 * with lowercase header names. skipped: assets that did not return 200 ({ key, status, error }).
 * A 404 is a stale reference (old CMS file, OG URL) and only a warning; a network error (status 0),
 * 403, 429 or 5xx means the origin or Cloudflare failed mid-crawl, and a /_next/static miss of any
 * status leaves pages without their CSS or JS, so those abort.
 */
export function checkSafety(results, skipped = []) {
  const problems = [];
  for (const s of skipped) {
    const failed = s.status === 0 || s.status === 403 || s.status === 429 || s.status >= 500;
    if (failed || s.key.startsWith("/_next/static/")) {
      problems.push(`asset ${s.key} returned ${s.status || `no response (${s.error})`}`);
    }
  }
  const pages = results.filter((r) => r.kind === "page");
  for (const p of pages) {
    if (p.status !== 200) problems.push(`page ${p.key} returned ${p.status}, expected 200`);
  }
  for (const r of results) {
    if ((r.headers?.["x-served-from"] ?? "").toLowerCase() === "snapshot") {
      problems.push(`${r.key} has x-served-from: snapshot (the site is in failover; never copy a copy)`);
    }
  }
  const home = pages.find((p) => p.key === "/");
  if (!home?.body?.toString("utf8").includes("Christopher Guzman")) {
    problems.push("homepage body does not contain Christopher Guzman");
  }
  if (pages.length < 10) problems.push(`only ${pages.length} pages, expected at least 10`);
  return problems;
}
