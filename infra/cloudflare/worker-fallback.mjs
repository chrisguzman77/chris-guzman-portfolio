// Cloudflare Worker routed on christopherguzman.me/* and www.christopherguzman.me/*.
// Redirects www to the apex, passes every other request to the origin (the
// tunnel), and replaces "origin unreachable" responses with a branded page so a
// home-internet or VM outage reads as planned maintenance, not a broken site.
const APEX = "christopherguzman.me";

// 502-504 from cloudflared, 52x from Cloudflare, 530 (error 1033) when no tunnel connector is up.
const ORIGIN_DOWN = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530]);

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="300">
<title>Back shortly · Christopher Guzman</title>
<style>
  :root { color-scheme: light dark; --bg: #f7f8fa; --ink: #1a2230; --muted: #5b6575; --accent: #2f4fa8; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f1419; --ink: #e7ebf1; --muted: #9aa3b0; --accent: #8fa8f0; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--ink);
         font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 34rem; padding: 2rem; }
  h1 { font: 600 2rem/1.2 Georgia, "Times New Roman", serif; margin: 0 0 .75rem; }
  p { color: var(--muted); margin: 0 0 1rem; }
  a { color: var(--accent); }
</style>
</head>
<body>
<main>
  <h1>Back shortly</h1>
  <p>This site runs on a server I operate myself, and it is offline for a few minutes. This page retries on its own.</p>
  <p>In the meantime: <a href="https://github.com/chrisguzman77">GitHub</a> ·
     <a href="https://www.linkedin.com/in/christopher-emmanuel-guzman/">LinkedIn</a></p>
</main>
</body>
</html>`;

function fallback() {
  return new Response(PAGE, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "retry-after": "300",
      "cache-control": "no-store",
    },
  });
}

// Static failover. With an R2 bucket bound as SNAPSHOT, an origin outage serves the latest
// crawl of the public site (written by .github/workflows/snapshot.yml) instead of PAGE.
// Without the binding, or for anything not in the snapshot, PAGE is still the answer.
const CACHE_TTL_MS = 60_000;
const BANNER_HTML = `<div role="status" style="margin:0;padding:.6rem 1rem;background:#fbbf24;color:#1c1917;font:500 15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;text-align:center">This is a backup copy of the site while my server is offline. Chat and the contact form are paused; email me at <a href="mailto:chguzman@augusta.edu" style="color:#1c1917;font-weight:600;text-decoration:underline">chguzman@augusta.edu</a>.</div>`;

// current.json and <prefix>manifest.json, keyed by R2 key: { at, value }.
const jsonCache = new Map();

export function resetSnapshotCache() {
  jsonCache.clear();
}

async function readJson(bucket, key) {
  const cached = jsonCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const object = await bucket.get(key);
  const value = object ? await object.json() : null;
  jsonCache.set(key, { at: Date.now(), value });
  return value;
}

// Manifest keys are pathname + search; pages are also stored under the bare pathname with any
// trailing slash stripped, so HTML requests fall back to that (e.g. ?utm_source=... still hits).
export function lookupKeys(request) {
  const { pathname, search } = new URL(request.url);
  const keys = [pathname + search];
  if ((request.headers.get("accept") ?? "").includes("text/html")) {
    const page = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
    if (page !== keys[0]) keys.push(page);
  }
  return keys;
}

export function snapshotHeaders(entry, isHtml) {
  const headers = new Headers({ "content-type": entry.type, "x-served-from": "snapshot" });
  if (isHtml) {
    // The captured CSP names the nonce baked into that HTML; the copy must never be cached or indexed.
    headers.set("cache-control", "no-store");
    headers.set("x-robots-tag", "noindex");
    if (entry.csp) headers.set("content-security-policy", entry.csp);
  } else {
    headers.set("cache-control", entry.cacheControl || "no-store");
  }
  return headers;
}

async function fromSnapshot(request, bucket) {
  const pointer = await readJson(bucket, "current.json");
  if (!pointer?.prefix) return null;
  const entries = (await readJson(bucket, `${pointer.prefix}manifest.json`))?.entries;
  if (!entries) return null;
  const key = lookupKeys(request).find((k) => Object.hasOwn(entries, k));
  if (!key) return null;
  const entry = entries[key];
  const object = await bucket.get(pointer.prefix + entry.file);
  if (!object) return null;

  const isHtml = entry.type.startsWith("text/html");
  const headers = snapshotHeaders(entry, isHtml);
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  const response = new Response(object.body, { status: 200, headers });
  if (!isHtml) return response;
  return new HTMLRewriter()
    .on("body", {
      element(e) {
        e.prepend(BANNER_HTML, { html: true });
      },
    })
    .on("[data-live-feature]", {
      element(e) {
        e.remove();
      },
    })
    .transform(response);
}

async function outage(request, env) {
  const bucket = env?.SNAPSHOT;
  if (!bucket || (request.method !== "GET" && request.method !== "HEAD")) return fallback();
  try {
    return (await fromSnapshot(request, bucket)) ?? fallback();
  } catch {
    return fallback();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === `www.${APEX}`) {
      url.hostname = APEX;
      return Response.redirect(url.toString(), 301);
    }
    let response;
    try {
      response = await fetch(request);
    } catch {
      return outage(request, env);
    }
    return ORIGIN_DOWN.has(response.status) ? outage(request, env) : response;
  },
};
