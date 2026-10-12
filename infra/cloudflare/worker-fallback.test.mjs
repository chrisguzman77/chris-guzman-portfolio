import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import worker, { lookupKeys, resetSnapshotCache, snapshotHeaders } from "./worker-fallback.mjs";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function originReturns(status) {
  globalThis.fetch = async () => new Response(`origin ${status}`, { status });
}

test("redirects www to the apex, keeping path and query", async () => {
  const res = await worker.fetch(new Request("https://www.christopherguzman.me/blog/x?y=1"));
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "https://christopherguzman.me/blog/x?y=1");
});

test("passes healthy origin responses through untouched", async () => {
  originReturns(200);
  const res = await worker.fetch(new Request("https://christopherguzman.me/"));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "origin 200");
});

test("passes application errors such as 404 through", async () => {
  originReturns(404);
  const res = await worker.fetch(new Request("https://christopherguzman.me/missing"));
  assert.equal(res.status, 404);
});

for (const status of [502, 521, 530]) {
  test(`serves the fallback page when the origin returns ${status}`, async () => {
    originReturns(status);
    const res = await worker.fetch(new Request("https://christopherguzman.me/"));
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("retry-after"), "300");
    const html = await res.text();
    assert.match(html, /back shortly/i);
    // The meta refresh must match Retry-After so clients retry at the same pace.
    assert.match(html, /http-equiv="refresh" content="300"/);
  });
}

test("serves the fallback page when the origin fetch throws", async () => {
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  const res = await worker.fetch(new Request("https://christopherguzman.me/"));
  assert.equal(res.status, 503);
});

// ---- Static failover: serving the R2 snapshot ----

const PREFIX = "snapshots/42/";
const CSP = "default-src 'self'; script-src 'self' 'nonce-abc123'";
const ENTRIES = {
  "/": { file: "files/home", type: "text/html; charset=utf-8", csp: CSP, cacheControl: "private, no-cache" },
  "/projects": { file: "files/projects", type: "text/html; charset=utf-8", csp: CSP, cacheControl: "private, no-cache" },
  "/_next/static/chunks/abc.js": {
    file: "files/abc",
    type: "application/javascript; charset=utf-8",
    cacheControl: "public, max-age=31536000, immutable",
  },
  "/_next/image?url=%2Fimages%2Fchris.jpg&w=640&q=75": {
    file: "files/img",
    type: "image/avif",
    cacheControl: "public, max-age=60, must-revalidate",
  },
};
const OBJECTS = {
  "current.json": JSON.stringify({ prefix: PREFIX, createdAt: "2026-10-12T08:15:00Z", commit: "deadbeef" }),
  [`${PREFIX}manifest.json`]: JSON.stringify({ version: 1, entries: ENTRIES }),
  [`${PREFIX}files/home`]: "<html><body><main>Christopher Guzman</main></body></html>",
  [`${PREFIX}files/projects`]: "<html><body><main>Projects</main></body></html>",
  [`${PREFIX}files/abc`]: "console.log(1)",
  [`${PREFIX}files/img`]: "AVIF",
};

// In-memory stand-in for the R2 binding: get(key) resolves to { body, text(), json() } or null.
function fakeBucket(objects) {
  const reads = [];
  return {
    reads,
    async get(key) {
      reads.push(key);
      if (!(key in objects)) return null;
      const value = objects[key];
      return { body: value, text: async () => value, json: async () => JSON.parse(value) };
    },
  };
}

// HTMLRewriter exists only in the Workers runtime; this recorder keeps the handlers it was given
// and returns the response unchanged, so the tests can drive the handlers with fake elements.
let rewriters = [];
class FakeHTMLRewriter {
  constructor() {
    this.handlers = {};
    rewriters.push(this);
  }
  on(selector, handler) {
    this.handlers[selector] = handler;
    return this;
  }
  transform(response) {
    return response;
  }
}

function fakeElement() {
  const calls = [];
  return {
    calls,
    prepend: (content, options) => calls.push(["prepend", content, options]),
    remove: () => calls.push(["remove"]),
  };
}

function originDown() {
  originReturns(530);
}

function page(path, init = {}) {
  return new Request(`https://christopherguzman.me${path}`, {
    ...init,
    headers: { accept: "text/html,application/xhtml+xml", ...init.headers },
  });
}

function asset(path) {
  return new Request(`https://christopherguzman.me${path}`, { headers: { accept: "*/*" } });
}

const realNow = Date.now;
beforeEach(() => {
  resetSnapshotCache();
  rewriters = [];
  globalThis.HTMLRewriter = FakeHTMLRewriter;
});
afterEach(() => {
  delete globalThis.HTMLRewriter;
  Date.now = realNow;
});

async function assertBackShortly(res) {
  assert.equal(res.status, 503);
  assert.match(await res.text(), /back shortly/i);
}

test("origin up: passes through even when a snapshot is bound", async () => {
  originReturns(200);
  const bucket = fakeBucket(OBJECTS);
  const res = await worker.fetch(page("/"), { SNAPSHOT: bucket });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "origin 200");
  assert.deepEqual(bucket.reads, []);
});

test("origin 530 and an HTML hit: serves the snapshot page with banner and live features removed", async () => {
  originDown();
  const res = await worker.fetch(page("/"), { SNAPSHOT: fakeBucket(OBJECTS) });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), OBJECTS[`${PREFIX}files/home`]);
  assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(res.headers.get("content-security-policy"), CSP);
  assert.equal(res.headers.get("x-served-from"), "snapshot");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-robots-tag"), "noindex");

  assert.equal(rewriters.length, 1);
  const { handlers } = rewriters[0];

  const body = fakeElement();
  handlers.body.element(body);
  assert.equal(body.calls.length, 1);
  const [method, banner, options] = body.calls[0];
  assert.equal(method, "prepend");
  assert.deepEqual(options, { html: true });
  assert.match(banner, /role="status"/);
  assert.match(banner, /This is a backup copy of the site while my server is offline\./);
  assert.match(banner, /Chat and the contact form are paused; email me at/);
  assert.match(banner, /href="mailto:chguzman@augusta\.edu"/);

  const live = fakeElement();
  handlers["[data-live-feature]"].element(live);
  assert.deepEqual(live.calls, [["remove"]]);
});

test("a page URL with tracking params falls back to the page key", async () => {
  originDown();
  const res = await worker.fetch(page("/projects/?utm_source=x"), { SNAPSHOT: fakeBucket(OBJECTS) });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "<html><body><main>Projects</main></body></html>");
});

test("asset hit: served with its content type and captured cache-control, no rewriting", async () => {
  originDown();
  const res = await worker.fetch(asset("/_next/static/chunks/abc.js"), { SNAPSHOT: fakeBucket(OBJECTS) });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "console.log(1)");
  assert.equal(res.headers.get("content-type"), "application/javascript; charset=utf-8");
  assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(res.headers.get("x-served-from"), "snapshot");
  assert.equal(res.headers.get("x-robots-tag"), null);
  assert.equal(res.headers.get("content-security-policy"), null);
  assert.equal(rewriters.length, 0);
});

test("/_next/image is looked up by its exact query string", async () => {
  originDown();
  const env = { SNAPSHOT: fakeBucket(OBJECTS) };
  const hit = await worker.fetch(asset("/_next/image?url=%2Fimages%2Fchris.jpg&w=640&q=75"), env);
  assert.equal(hit.status, 200);
  assert.equal(hit.headers.get("content-type"), "image/avif");
  assert.equal(await hit.text(), "AVIF");
  await assertBackShortly(await worker.fetch(asset("/_next/image?url=%2Fimages%2Fchris.jpg&w=1080&q=75"), env));
});

test("HEAD on a hit returns the headers without a body", async () => {
  originDown();
  const res = await worker.fetch(page("/", { method: "HEAD" }), { SNAPSHOT: fakeBucket(OBJECTS) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-served-from"), "snapshot");
  assert.equal(await res.text(), "");
});

test("miss: 503 Back shortly", async () => {
  originDown();
  await assertBackShortly(await worker.fetch(page("/not-in-snapshot"), { SNAPSHOT: fakeBucket(OBJECTS) }));
});

test("/api/healthz is never served from the snapshot", async () => {
  originDown();
  await assertBackShortly(await worker.fetch(asset("/api/healthz"), { SNAPSHOT: fakeBucket(OBJECTS) }));
});

test("no SNAPSHOT binding: 503 Back shortly", async () => {
  originDown();
  await assertBackShortly(await worker.fetch(page("/"), {}));
});

test("current.json missing: 503 Back shortly", async () => {
  originDown();
  const { "current.json": _, ...rest } = OBJECTS;
  await assertBackShortly(await worker.fetch(page("/"), { SNAPSHOT: fakeBucket(rest) }));
});

test("R2 errors: 503 Back shortly", async () => {
  originDown();
  const broken = {
    async get() {
      throw new Error("R2 unavailable");
    },
  };
  await assertBackShortly(await worker.fetch(page("/"), { SNAPSHOT: broken }));
});

test("POST while down: 503 without touching the snapshot", async () => {
  originDown();
  const bucket = fakeBucket(OBJECTS);
  await assertBackShortly(await worker.fetch(page("/", { method: "POST", body: "x" }), { SNAPSHOT: bucket }));
  assert.deepEqual(bucket.reads, []);
});

test("origin fetch throws: serves the snapshot", async () => {
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  const res = await worker.fetch(page("/"), { SNAPSHOT: fakeBucket(OBJECTS) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-served-from"), "snapshot");
});

test("current.json and the manifest are cached for 60 s", async () => {
  originDown();
  let now = 1_000_000;
  Date.now = () => now;
  const bucket = fakeBucket(OBJECTS);
  const env = { SNAPSHOT: bucket };
  const metadataReads = () => bucket.reads.filter((k) => k.endsWith(".json")).length;

  await worker.fetch(page("/"), env);
  assert.equal(metadataReads(), 2);
  now += 59_000;
  await worker.fetch(page("/projects"), env);
  assert.equal(metadataReads(), 2);
  now += 2_000;
  await worker.fetch(page("/"), env);
  assert.equal(metadataReads(), 4);
});

test("lookupKeys: exact key first, then the normalized page path for HTML requests", () => {
  assert.deepEqual(lookupKeys(page("/")), ["/"]);
  assert.deepEqual(lookupKeys(page("/blog/")), ["/blog/", "/blog"]);
  assert.deepEqual(lookupKeys(page("/blog/x?utm_source=a")), ["/blog/x?utm_source=a", "/blog/x"]);
  assert.deepEqual(lookupKeys(page("/?ref=a")), ["/?ref=a", "/"]);
  assert.deepEqual(lookupKeys(asset("/_next/image?url=a&w=1")), ["/_next/image?url=a&w=1"]);
  assert.deepEqual(lookupKeys(asset("/blog/")), ["/blog/"]);
});

test("snapshotHeaders: HTML forces no-store, noindex and the captured CSP", () => {
  const html = snapshotHeaders(ENTRIES["/"], true);
  assert.equal(html.get("content-type"), "text/html; charset=utf-8");
  assert.equal(html.get("x-served-from"), "snapshot");
  assert.equal(html.get("cache-control"), "no-store");
  assert.equal(html.get("x-robots-tag"), "noindex");
  assert.equal(html.get("content-security-policy"), CSP);

  const js = snapshotHeaders(ENTRIES["/_next/static/chunks/abc.js"], false);
  assert.equal(js.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(js.get("x-robots-tag"), null);

  const bare = snapshotHeaders({ file: "files/x", type: "text/plain" }, false);
  assert.equal(bare.get("cache-control"), "no-store");
});
