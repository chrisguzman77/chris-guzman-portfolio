import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  DirectusClient,
  adminLoginFailure,
  bootstrapTokenFailure,
  planSchema,
  planSeedOnce,
  sameJson,
  seedKeys,
} from "./lib.mjs";
import { BOOTSTRAP_STATE, CONTENT_COLLECTIONS, SINGLETONS, collections } from "./schema.mjs";

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
    [...CONTENT_COLLECTIONS, BOOTSTRAP_STATE],
  );
  for (const c of collections.filter((c) => c.collection !== BOOTSTRAP_STATE)) {
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

test("bootstrap_state is a hidden singleton outside the reader policy's collections", () => {
  const state = collections.find((c) => c.collection === BOOTSTRAP_STATE);
  assert.equal(state.meta.singleton, true);
  assert.equal(state.meta.hidden, true);
  assert.deepEqual(
    state.fields.map((f) => [f.field, f.type]),
    [["seeded", "json"]],
  );
  assert.equal(CONTENT_COLLECTIONS.includes(BOOTSTRAP_STATE), false);
  assert.equal(SINGLETONS.includes(BOOTSTRAP_STATE), false);
});

test("planSeedOnce seeds a never-seeded empty collection", () => {
  assert.equal(planSeedOnce([], "projects", 0), "seed");
});
test("planSeedOnce records a pre-existing populated collection without seeding", () => {
  assert.equal(planSeedOnce([], "projects", 4), "record");
});
test("planSeedOnce never re-seeds a recorded collection, even when emptied", () => {
  assert.equal(planSeedOnce(["projects"], "projects", 0), "skip");
});

test("sameJson ignores object key order but not values or array order", () => {
  assert.equal(sameJson({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }), true);
  assert.equal(sameJson({ a: 1 }, { a: 2 }), false);
  assert.equal(sameJson({ c: ["x", "y"] }, { c: ["y", "x"] }), false);
  assert.equal(sameJson({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(sameJson(false, false), true);
  assert.equal(sameJson(false, null), false);
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

test("adminLoginFailure explains stale admin credentials on 401 without printing them", () => {
  const msg = adminLoginFailure(401, '{"errors":[{"message":"Invalid user credentials."}]}');
  assert.match(msg, /DIRECTUS_ADMIN_EMAIL/);
  assert.match(msg, /DIRECTUS_ADMIN_PASSWORD/);
  assert.match(msg, /prod\.enc\.env/);
  assert.match(msg, /no longer match/);
  assert.match(msg, /2FA/);
  assert.match(msg, /runbook/);
});

test("adminLoginFailure covers 400 invalid credentials and OTP, but not other 400s", () => {
  assert.ok(adminLoginFailure(400, '{"errors":[{"extensions":{"code":"INVALID_CREDENTIALS"}}]}'));
  assert.ok(adminLoginFailure(400, '{"errors":[{"extensions":{"code":"INVALID_OTP"}}]}'));
  const payload = '{"errors":[{"extensions":{"code":"INVALID_PAYLOAD"}}]}';
  assert.equal(adminLoginFailure(400, payload), null);
  assert.equal(adminLoginFailure(500, "boom"), null);
});

test("DirectusClient.login replaces a 401 with the stale-credentials message", async () => {
  const { impl } = fakeFetch([
    {
      status: 401,
      body: {
        errors: [
          { message: "Invalid user credentials.", extensions: { code: "INVALID_CREDENTIALS" } },
        ],
      },
    },
  ]);
  const api = new DirectusClient("http://directus:8055", impl);
  await assert.rejects(api.login("me@example.com", "s3cret-pw"), (err) => {
    assert.match(err.message, /no longer match the live Directus admin user/);
    assert.doesNotMatch(err.message, /me@example\.com|s3cret-pw/);
    return true;
  });
});

test("DirectusClient.login keeps the raw error for other failures", async () => {
  const { impl } = fakeFetch([{ status: 503, body: { errors: [{ message: "Unavailable" }] } }]);
  const api = new DirectusClient("http://directus:8055", impl);
  await assert.rejects(api.login("me@example.com", "pw"), /POST \/auth\/login -> 503/);
});

test("bootstrapTokenFailure explains a rejected token on 401 and 403 only", () => {
  const expected =
    'DIRECTUS_BOOTSTRAP_TOKEN was rejected (HTTP 401); regenerate it for an admin user (docs/setup.md, "Directus bootstrap token")';
  assert.equal(bootstrapTokenFailure(401), expected);
  assert.equal(bootstrapTokenFailure(403), expected.replace("401", "403"));
  assert.equal(bootstrapTokenFailure(500), null);
  assert.equal(bootstrapTokenFailure(undefined), null);
});

test("DirectusClient.useStaticToken preflights GET /users/me with the token", async () => {
  const { calls, impl } = fakeFetch([{ status: 200, body: { data: { id: "u1" } } }]);
  const api = new DirectusClient("http://directus:8055", impl);
  await api.useStaticToken("static-tok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].url, "http://directus:8055/users/me");
  assert.equal(calls[0].headers.authorization, "Bearer static-tok");
});

test("DirectusClient.useStaticToken replaces a 401/403 with the regenerate message", async () => {
  for (const status of [401, 403]) {
    const { impl } = fakeFetch([{ status, body: { errors: [{ message: "Invalid token" }] } }]);
    const api = new DirectusClient("http://directus:8055", impl);
    await assert.rejects(api.useStaticToken("static-tok"), (err) => {
      assert.match(err.message, new RegExp(`rejected \\(HTTP ${status}\\)`));
      assert.doesNotMatch(err.message, /static-tok/);
      return true;
    });
  }
});

test("DirectusClient.useStaticToken keeps the raw error for other failures", async () => {
  const { impl } = fakeFetch([{ status: 503, body: { errors: [{ message: "Unavailable" }] } }]);
  const api = new DirectusClient("http://directus:8055", impl);
  await assert.rejects(api.useStaticToken("t"), /GET \/users\/me -> 503/);
});
