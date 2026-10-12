import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import * as mod from "./worker-fallback.mjs";
import worker from "./worker-fallback.mjs";

const { lookupKeys, resetSnapshotCache, snapshotHeaders } = worker;

test("the module's only export is default (the Workers runtime treats named exports as entrypoints)", () => {
  assert.deepEqual(Object.keys(mod), ["default"]);
});

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
  // A bad crawl that captured dynamic paths must still never be served.
  "/api/healthz": { file: "files/healthz", type: "application/json" },
  "/stats/script.js": { file: "files/healthz", type: "application/javascript" },
  "/newsletter/confirm": { file: "files/healthz", type: "text/html; charset=utf-8" },
  "/admin": { file: "files/healthz", type: "text/html; charset=utf-8" },
  "/projects?_rsc=1x2y": { file: "files/healthz", type: "text/x-component" },
};
const OBJECTS = {
  "current.json": JSON.stringify({ prefix: PREFIX, createdAt: "2026-10-12T08:15:00Z", commit: "deadbeef" }),
  [`${PREFIX}manifest.json`]: JSON.stringify({ version: 1, entries: ENTRIES }),
  [`${PREFIX}files/home`]: "<html><body><main>Christopher Guzman</main></body></html>",
  [`${PREFIX}files/projects`]: "<html><body><main>Projects</main></body></html>",
  [`${PREFIX}files/abc`]: "console.log(1)",
  [`${PREFIX}files/img`]: "AVIF",
  [`${PREFIX}files/healthz`]: '{"ok":true}',
};

// In-memory stand-in for the R2 binding: get(key) resolves to { body, size, text(), json() } or
// null; head(key) resolves to { size } or null. Every call is recorded as [method, key].
function fakeBucket(objects) {
  const calls = [];
  return {
    calls,
    get reads() {
      return calls.map(([, key]) => key);
    },
    async get(key) {
      calls.push(["get", key]);
      if (!(key in objects)) return null;
      const value = objects[key];
      return { body: value, size: value.length, text: async () => value, json: async () => JSON.parse(value) };
    },
    async head(key) {
      calls.push(["head", key]);
      if (!(key in objects)) return null;
      return { size: objects[key].length };
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
    this.transformed = response;
    return response;
  }
}

function fakeElement() {
  const calls = [];
  return {
    calls,
    append: (content, options) => calls.push(["append", content, options]),
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

test("origin 530 and an HTML hit: serves the snapshot page with banner and live features hidden", async () => {
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
  const { handlers, transformed } = rewriters[0];
  // The rewriter is applied to the 200 snapshot response, headers already set.
  assert.equal(transformed, res);
  assert.equal(transformed.status, 200);
  assert.equal(transformed.headers.get("content-security-policy"), CSP);
  assert.equal(transformed.headers.get("x-served-from"), "snapshot");
  assert.equal(transformed.headers.get("cache-control"), "no-store");
  assert.equal(transformed.headers.get("x-robots-tag"), "noindex");

  // Nothing is deleted (hydration): live features are hidden by an appended <style>.
  assert.deepEqual(Object.keys(handlers).sort(), ["body", "head"]);
  const head = fakeElement();
  handlers.head.element(head);
  assert.deepEqual(head.calls, [
    [
      "append",
      '<style id="snapshot-style">[data-live-feature]{display:none!important}body{padding-bottom:4rem}</style>',
      { html: true },
    ],
  ]);

  const body = fakeElement();
  handlers.body.element(body);
  assert.equal(body.calls.length, 1);
  const [method, banner, options] = body.calls[0];
  // Appended before </body>: prepending it as the first child broke hydration (React #418).
  assert.equal(method, "append");
  assert.deepEqual(options, { html: true });
  assert.match(banner, /^<div id="snapshot-banner" role="status" style="[^"]+">/);
  assert.match(banner, /position:fixed;left:0;right:0;bottom:0;z-index:2147483000/);
  assert.match(banner, /This is a backup copy of the site while my server is offline\./);
  assert.match(banner, /Chat and the contact form are paused; email me at/);
  assert.match(banner, /href="mailto:chguzman@augusta\.edu"/);
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

test("HEAD on a hit uses R2 head(), returns the headers and content-length without a body", async () => {
  originDown();
  const bucket = fakeBucket(OBJECTS);
  const res = await worker.fetch(page("/", { method: "HEAD" }), { SNAPSHOT: bucket });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-served-from"), "snapshot");
  assert.equal(res.headers.get("content-length"), String(OBJECTS[`${PREFIX}files/home`].length));
  assert.equal(await res.text(), "");
  assert.deepEqual(bucket.calls.at(-1), ["head", `${PREFIX}files/home`]);
  assert.equal(rewriters.length, 0);
});

test("miss: 503 Back shortly", async () => {
  originDown();
  await assertBackShortly(await worker.fetch(page("/not-in-snapshot"), { SNAPSHOT: fakeBucket(OBJECTS) }));
});

for (const path of ["/api/healthz", "/stats/script.js", "/newsletter/confirm", "/admin", "/projects?_rsc=1x2y"]) {
  test(`${path} is refused before any R2 read, even though the manifest has it`, async () => {
    originDown();
    const bucket = fakeBucket(OBJECTS);
    await assertBackShortly(await worker.fetch(asset(path), { SNAPSHOT: bucket }));
    assert.deepEqual(bucket.calls, []);
  });
}

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

  const untyped = snapshotHeaders({ file: "files/x" }, false);
  assert.equal(untyped.get("content-type"), "application/octet-stream");
});
