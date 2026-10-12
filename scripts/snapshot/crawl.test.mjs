import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

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

const ORIGIN = "https://christopherguzman.me";

// Trimmed from the live homepage, resume and project pages (2026-10-12).
const HOME_HTML = `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/>
<link rel="preload" as="image" imageSrcSet="/_next/image?url=%2Fimages%2Fchris.jpg&amp;w=32&amp;q=75 32w, /_next/image?url=%2Fimages%2Fchris.jpg&amp;w=640&amp;q=75 640w" imageSizes="(min-width: 768px) 360px, 300px"/>
<link rel="stylesheet" href="/_next/static/chunks/1n111dkb3__1-.css" nonce="GYjX40+w7E7XKFngaIZfig==" data-precedence="next"/>
<link rel="preload" as="script" fetchPriority="low" nonce="GYjX40+w7E7XKFngaIZfig==" href="/_next/static/chunks/0iner2fvyfs3r.js"/>
<script src="/_next/static/chunks/450hzk4n7oh8k.js" async="" nonce="GYjX40+w7E7XKFngaIZfig=="></script>
<meta property="og:image" content="https://christopherguzman.me/opengraph-image?17f927c45378d1da"/>
<meta property="og:image:alt" content="Christopher Guzman, software engineer"/>
<meta name="twitter:image" content="https://christopherguzman.me/opengraph-image?17f927c45378d1da"/>
<link rel="icon" href="/favicon.ico?favicon.2hwp03ef8bckl.ico" sizes="48x48" type="image/x-icon"/>
<link rel="icon" href="/icon.svg?icon.2a77yy09zl5dy.svg" sizes="any" type="image/svg+xml"/>
<link rel="apple-touch-icon" href="/apple-icon.png?apple-icon.3euoilkdab-zu.png" sizes="180x180" type="image/png"/>
<link rel="alternate" type="application/rss+xml" href="https://christopherguzman.me/blog/rss.xml"/>
<link rel="canonical" href="https://christopherguzman.me/"/>
<link rel="preconnect" href="https://challenges.cloudflare.com"/>
</head><body>
<img alt="Portrait of Christopher Guzman" width="788" height="985" class="order-2 [&amp;_svg]:size-4" sizes="(min-width: 768px) 360px, 300px" srcSet="/_next/image?url=%2Fimages%2Fchris.jpg&amp;w=32&amp;q=75 32w, /_next/image?url=%2Fimages%2Fchris.jpg&amp;w=48&amp;q=75 48w, /_next/image?url=%2Fimages%2Fchris.jpg&amp;w=3840&amp;q=75 3840w" src="/_next/image?url=%2Fimages%2Fchris.jpg&amp;w=3840&amp;q=75"/>
<a href="/blog/how-i-built-this-site">Read post</a>
<a href="/blog/rss.xml" aria-label="RSS feed">rss</a>
<a href="https://github.com/chrisguzman77/feed.xml">external feed</a>
<a href="/cms-assets/c2c0f8aa-0a4d-4b75-9b2f-96e3607df494" download="christopher-guzman-resume.pdf">Download</a>
<object data="/cms-assets/c2c0f8aa-0a4d-4b75-9b2f-96e3607df494#toolbar=0&amp;view=Fit" type="application/pdf" aria-label="Resume of Christopher Guzman (PDF)"></object>
<script nonce="x">self.__next_f.push([1,"<img src=\\"/should-not-be-picked.png\\">"])</script>
<!-- <img src="/commented-out.png"> -->
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async=""></script>
</body></html>`;

const key = (u) => assetKey(new URL(u));

test("pageKey strips the trailing slash except for the root", () => {
  assert.equal(pageKey(new URL("https://christopherguzman.me/")), "/");
  assert.equal(pageKey(new URL("https://christopherguzman.me/projects/")), "/projects");
  assert.equal(pageKey(new URL("https://christopherguzman.me/blog?utm_source=x")), "/blog");
  assert.equal(pageKey("https://christopherguzman.me/projects/this-portfolio"), "/projects/this-portfolio");
});

test("assetKey keeps the search and drops the fragment", () => {
  assert.equal(
    assetKey(new URL("https://christopherguzman.me/_next/image?url=%2Fimages%2Fchris.jpg&w=640&q=75")),
    "/_next/image?url=%2Fimages%2Fchris.jpg&w=640&q=75",
  );
  assert.equal(
    assetKey("https://christopherguzman.me/cms-assets/c2c0f8aa#toolbar=0&view=Fit"),
    "/cms-assets/c2c0f8aa",
  );
});

test("isSameOrigin compares scheme, host and port", () => {
  assert.equal(isSameOrigin("https://christopherguzman.me/x", ORIGIN), true);
  assert.equal(isSameOrigin("https://www.christopherguzman.me/x", ORIGIN), false);
  assert.equal(isSameOrigin("http://christopherguzman.me/x", ORIGIN), false);
  assert.equal(isSameOrigin("https://challenges.cloudflare.com/turnstile/v0/api.js", ORIGIN), false);
});

test("isExcluded drops API, stats, RSC, admin and newsletter keys", () => {
  for (const k of [
    "/api/healthz",
    "/api/chat",
    "/stats/script.js",
    "/blog?_rsc=1x2y3",
    "/admin",
    "/admin/login",
    "/newsletter/confirm?token=abc",
  ]) {
    assert.equal(isExcluded(k), true, k);
  }
  for (const k of ["/", "/blog", "/_next/static/chunks/a.js", "/cms-assets/abc", "/blog/rss.xml"]) {
    assert.equal(isExcluded(k), false, k);
  }
});

test("isExcluded matches the _rsc search param, not the substring", () => {
  assert.equal(isExcluded("/?_rsc=abc"), true);
  assert.equal(isExcluded("/_next/static/chunks/_rsc_helper-1a2b.js"), false);
});

test("extractHtmlRefs finds src, srcset, links, object data and OG images", () => {
  const refs = extractHtmlRefs(HOME_HTML, `${ORIGIN}/`).map(key);
  const expected = [
    // every srcset candidate, with &amp; decoded so the query keys match what the browser requests
    "/_next/image?url=%2Fimages%2Fchris.jpg&w=32&q=75",
    "/_next/image?url=%2Fimages%2Fchris.jpg&w=48&q=75",
    "/_next/image?url=%2Fimages%2Fchris.jpg&w=640&q=75",
    "/_next/image?url=%2Fimages%2Fchris.jpg&w=3840&q=75",
    "/_next/static/chunks/1n111dkb3__1-.css",
    "/_next/static/chunks/0iner2fvyfs3r.js",
    "/_next/static/chunks/450hzk4n7oh8k.js",
    "/opengraph-image?17f927c45378d1da",
    "/favicon.ico?favicon.2hwp03ef8bckl.ico",
    "/icon.svg?icon.2a77yy09zl5dy.svg",
    "/apple-icon.png?apple-icon.3euoilkdab-zu.png",
    "/blog/rss.xml",
    // object data with the #toolbar fragment dropped
    "/cms-assets/c2c0f8aa-0a4d-4b75-9b2f-96e3607df494",
  ];
  for (const k of expected) assert.ok(refs.includes(k), `missing ${k}`);

  // no page links, canonical, preconnect, inline-script or comment content
  for (const k of ["/blog/how-i-built-this-site", "/", "/should-not-be-picked.png", "/commented-out.png"]) {
    assert.ok(!refs.includes(k), `unexpected ${k}`);
  }
  // returns absolute URLs; cross-origin ones are left for the caller to filter
  const abs = extractHtmlRefs(HOME_HTML, `${ORIGIN}/`);
  assert.ok(abs.every((u) => /^https?:\/\//.test(u)));
  assert.ok(abs.includes("https://challenges.cloudflare.com/turnstile/v0/api.js"));
  // a .xml link on another origin is not a feed of ours
  assert.ok(!abs.includes("https://github.com/chrisguzman77/feed.xml"));
  // deduped
  assert.equal(new Set(abs).size, abs.length);
});

test("extractHtmlRefs resolves relative URLs against the page", () => {
  const html = `<img src="diagram.svg"><source srcset="a.webp 1x,b.webp 2x"><link rel="shortcut icon" href="../favicon.ico">`;
  const refs = extractHtmlRefs(html, `${ORIGIN}/blog/how-i-built-this-site`).map(key);
  assert.deepEqual(refs.sort(), ["/blog/a.webp", "/blog/b.webp", "/blog/diagram.svg", "/favicon.ico"]);
});

test("extractCssRefs handles quotes and ignores data: and fragments", () => {
  const css = `@font-face{font-family:Geist;src:url(../media/70bc3e132a0a741e-s.p.3t6q91iet4nsy.woff2) format("woff2")}
.a{background:url("/images/grid.svg")}.b{background-image:url( '../media/noise.png' )}
.c{background:url(data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)}.d{mask:url('data:image/png;base64,AAAA')}.e{filter:url(#glow)}`;
  const refs = extractCssRefs(css, `${ORIGIN}/_next/static/chunks/1n111dkb3__1-.css`).map(key);
  assert.deepEqual(refs.sort(), [
    "/_next/static/media/70bc3e132a0a741e-s.p.3t6q91iet4nsy.woff2",
    "/_next/static/media/noise.png",
    "/images/grid.svg",
  ]);
});

test("extractJsChunkRefs finds /_next/static chunk strings, including Turbopack's unprefixed ones", () => {
  const js = `e.v(t=>Promise.all(["static/chunks/0huc6qwqmeaxe.js","static/chunks/2nr7ha4in_gy8.js"].map(t=>e.l(t))).then(()=>t(29080)))
  ;let a="/_next/static/chunks/0apcc-a6udb4n.js",b='/_next/static/chunks/1n111dkb3__1-.css';
  const notAChunk="docs/static/chunks/x.js", img="/_next/static/media/logo.png";`;
  const refs = extractJsChunkRefs(js, ORIGIN);
  assert.deepEqual(refs.sort(), [
    `${ORIGIN}/_next/static/chunks/0apcc-a6udb4n.js`,
    `${ORIGIN}/_next/static/chunks/0huc6qwqmeaxe.js`,
    `${ORIGIN}/_next/static/chunks/1n111dkb3__1-.css`,
    `${ORIGIN}/_next/static/chunks/2nr7ha4in_gy8.js`,
  ]);
});

test("fileName is files/ plus the sha256 of the key, and stable", () => {
  const k = "/_next/image?url=%2Fimages%2Fchris.jpg&w=640&q=75";
  const hex = createHash("sha256").update(k).digest("hex");
  assert.equal(fileName(k), `files/${hex}`);
  assert.equal(fileName(k), fileName(k));
  assert.notEqual(fileName("/"), fileName("/blog"));
  assert.match(fileName("/"), /^files\/[0-9a-f]{64}$/);
});

test("isImageKey recognises optimizer and image-extension keys", () => {
  assert.equal(isImageKey("/_next/image?url=%2Fimages%2Fchris.jpg&w=640&q=75"), true);
  assert.equal(isImageKey("/apple-icon.png?apple-icon.3euoilkdab-zu.png"), true);
  assert.equal(isImageKey("/icon.svg"), true);
  assert.equal(isImageKey("/_next/static/chunks/a.js"), false);
  assert.equal(isImageKey("/blog/rss.xml"), false);
});

const page = (k, over = {}) => ({
  kind: "page",
  key: k,
  status: 200,
  headers: { "content-type": "text/html; charset=utf-8" },
  body: Buffer.from(k === "/" ? "<h1>Christopher Guzman</h1>" : "<h1>page</h1>"),
  ...over,
});
const healthy = () => [
  page("/"),
  ...["/experience", "/education", "/projects", "/blog", "/resume", "/contact", "/a", "/b", "/c", "/d"].map((k) =>
    page(k),
  ),
  { kind: "asset", key: "/_next/static/chunks/a.js", status: 200, headers: {}, body: Buffer.from("") },
];

test("checkSafety passes a healthy crawl", () => {
  assert.deepEqual(checkSafety(healthy()), []);
});

test("checkSafety flags a page that is not 200", () => {
  const r = healthy();
  r[3] = page("/projects", { status: 502 });
  const problems = checkSafety(r);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /\/projects.*502/);
});

test("checkSafety flags any response already served from the snapshot", () => {
  const r = healthy();
  r.at(-1).headers = { "x-served-from": "snapshot" };
  const problems = checkSafety(r);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /x-served-from: snapshot/);
});

test("checkSafety flags a homepage without the name", () => {
  const r = healthy();
  r[0] = page("/", { body: Buffer.from("<h1>Back shortly</h1>") });
  const problems = checkSafety(r);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Christopher Guzman/);
});

test("checkSafety flags a missing homepage", () => {
  const problems = checkSafety(healthy().slice(1));
  assert.ok(problems.some((p) => /Christopher Guzman/.test(p)));
});

test("checkSafety flags fewer than 10 pages", () => {
  const problems = checkSafety(healthy().slice(0, 9));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /9 pages/);
});
