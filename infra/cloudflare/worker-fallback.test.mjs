import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import worker from "./worker-fallback.mjs";

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
    assert.match(await res.text(), /back shortly/i);
  });
}

test("serves the fallback page when the origin fetch throws", async () => {
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  const res = await worker.fetch(new Request("https://christopherguzman.me/"));
  assert.equal(res.status, 503);
});
