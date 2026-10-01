import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { DirectusClient, planSchema, planSeed, seedKeys } from "./lib.mjs";
import { CONTENT_COLLECTIONS, SINGLETONS, collections } from "./schema.mjs";

const EMPTY = { collections: [], fields: [], relations: [] };

const desired = [
  {
    collection: "projects",
    meta: { icon: "code" },
    fields: [
      { field: "slug", type: "string", meta: { interface: "input" }, schema: {} },
      { field: "cover", type: "uuid", meta: { interface: "file-image", special: ["file"] }, schema: {} },
    ],
  },
];

/** Applies planned ops to an in-memory "existing" snapshot, like Directus would. */
function apply(existing, ops) {
  return {
    collections: [
      ...existing.collections,
      ...ops.filter((o) => o.type === "collection").map((o) => o.collection),
    ],
    fields: [
      ...existing.fields,
      ...ops.filter((o) => o.type === "field").map(({ collection, field }) => ({ collection, field })),
    ],
    relations: [
      ...existing.relations,
      ...ops.filter((o) => o.type === "relation").map(({ collection, field }) => ({ collection, field })),
    ],
  };
}

test("planSchema creates collection, fields, then file relations on an empty instance", () => {
  const ops = planSchema(EMPTY, desired);
  assert.deepEqual(
    ops.map((o) => `${o.type}:${o.collection}${o.field ? `.${o.field}` : ""}`),
    ["collection:projects", "field:projects.slug", "field:projects.cover", "relation:projects.cover"],
  );
  assert.deepEqual(ops[0].body, { collection: "projects", meta: { icon: "code" }, schema: {} });
  assert.deepEqual(ops[3].body, {
    collection: "projects",
    field: "cover",
    related_collection: "directus_files",
    schema: { on_delete: "SET NULL" },
  });
});

test("planSchema plans only what is missing", () => {
  const existing = {
    collections: ["projects"],
    fields: [{ collection: "projects", field: "slug", type: "text" }],
    relations: [],
  };
  const ops = planSchema(existing, desired);
  assert.deepEqual(
    ops.map((o) => `${o.type}:${o.collection}.${o.field}`),
    ["field:projects.cover", "relation:projects.cover"],
  );
});

test("planSchema never plans an update, even when an existing field differs", () => {
  const existing = {
    collections: ["projects"],
    fields: [
      { collection: "projects", field: "slug", type: "text", meta: { interface: "other" } },
      { collection: "projects", field: "cover", type: "uuid" },
    ],
    relations: [{ collection: "projects", field: "cover" }],
  };
  assert.deepEqual(planSchema(existing, desired), []);
});

test("planSchema on its own result plans nothing (real schema)", () => {
  const first = planSchema(EMPTY, collections);
  assert.ok(first.length > 0);
  assert.deepEqual(planSchema(apply(EMPTY, first), collections), []);
});

test("schema declares every content collection, status on non-singletons, unique slugs", () => {
  assert.deepEqual(
    collections.map((c) => c.collection),
    CONTENT_COLLECTIONS,
  );
  for (const c of collections) {
    const names = c.fields.map((f) => f.field);
    assert.equal(names.includes("status"), !SINGLETONS.includes(c.collection), c.collection);
    assert.equal(Boolean(c.meta.singleton), SINGLETONS.includes(c.collection), c.collection);
  }
  for (const name of ["projects", "posts"]) {
    const slug = collections.find((c) => c.collection === name).fields.find((f) => f.field === "slug");
    assert.equal(slug.schema.is_unique, true, name);
  }
  const projectFields = collections.find((c) => c.collection === "projects").fields;
  assert.equal(projectFields.some((f) => f.field === "gallery"), false);
});

test("planSeed inserts only items whose key is missing", () => {
  const existing = [{ id: 1, slug: "a", title: "Edited by Chris" }];
  const seed = [
    { slug: "a", title: "Seed A" },
    { slug: "b", title: "Seed B" },
  ];
  assert.deepEqual(planSeed(existing, seed, seedKeys.projects), [{ slug: "b", title: "Seed B" }]);
});

test("planSeed is idempotent: a second run plans zero inserts", () => {
  const seed = [{ slug: "a" }, { slug: "b" }];
  const first = planSeed([], seed, seedKeys.projects);
  assert.equal(first.length, 2);
  const afterFirst = first.map((item, i) => ({ id: i + 1, ...item }));
  assert.deepEqual(planSeed(afterFirst, seed, seedKeys.projects), []);
});

test("planSeed never returns an existing item (no updates), even if fields differ", () => {
  const existing = [{ id: 7, company: "Acme", role: "Intern", location: "Changed" }];
  const seed = [{ company: "Acme", role: "Intern", location: "Original" }];
  assert.deepEqual(planSeed(existing, seed, seedKeys.experience), []);
});

test("planSeed de-duplicates seed items with the same key", () => {
  assert.deepEqual(planSeed([], [{ slug: "a" }, { slug: "a" }], seedKeys.projects), [{ slug: "a" }]);
});

test("seedKeys: singletons, experience company+role, education, involvement, projects", () => {
  assert.equal(seedKeys.profile({ name: "x" }), seedKeys.profile({ name: "y" }));
  assert.equal(seedKeys.resume({}), seedKeys.resume({ file: "z" }));
  assert.notEqual(
    seedKeys.experience({ company: "ACM@AU", role: "Lead Developer" }),
    seedKeys.experience({ company: "ACM@AU", role: "Member" }),
  );
  assert.notEqual(
    seedKeys.experience({ company: "a b", role: "c" }),
    seedKeys.experience({ company: "a", role: "b c" }),
  );
  assert.equal(seedKeys.education({ school: "AU" }), "AU");
  assert.equal(seedKeys.involvement({ organization: "ACM@AU" }), "ACM@AU");
  assert.equal(seedKeys.projects({ slug: "this-portfolio" }), "this-portfolio");
  assert.equal(planSeed([{ id: 1 }], [{ name: "x" }], seedKeys.profile).length, 0);
  assert.equal(planSeed([], [{ name: "x" }], seedKeys.profile).length, 1);
});

test("seed files: valid JSON, no phone number, unique keys", async () => {
  const phone = /\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/;
  for (const name of ["profile", "resume", "experience", "education", "involvement", "projects"]) {
    const raw = await readFile(new URL(`./seed/${name}.json`, import.meta.url), "utf8");
    assert.doesNotMatch(raw, phone, name);
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      const keys = data.map(seedKeys[name]);
      assert.equal(new Set(keys).size, keys.length, name);
      for (const item of data) assert.equal(item.status, "published", name);
    }
  }
});

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, ...init });
    const { status, body } = responses.shift();
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  };
  return { calls, impl };
}

test("DirectusClient logs in and sends the bearer token", async () => {
  const { calls, impl } = fakeFetch([
    { status: 200, body: { data: { access_token: "abc" } } },
    { status: 200, body: { data: [{ collection: "profile" }] } },
  ]);
  const api = new DirectusClient("http://directus:8055/", impl);
  await api.login("me@example.com", "pw");
  assert.deepEqual(await api.get("/collections"), [{ collection: "profile" }]);
  assert.equal(calls[0].url, "http://directus:8055/auth/login");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(JSON.parse(calls[0].body), { email: "me@example.com", password: "pw" });
  assert.equal(calls[1].headers.authorization, "Bearer abc");
});

test("DirectusClient throws with status and body on non-2xx", async () => {
  const { impl } = fakeFetch([{ status: 403, body: { errors: [{ message: "Forbidden" }] } }]);
  const api = new DirectusClient("http://directus:8055", impl);
  await assert.rejects(api.post("/permissions", {}), /POST \/permissions -> 403: .*Forbidden/);
});

test("DirectusClient returns null for 204", async () => {
  const { impl } = fakeFetch([{ status: 204 }]);
  const api = new DirectusClient("http://directus:8055", impl);
  assert.equal(await api.patch("/users/1", { token: "t" }), null);
});
