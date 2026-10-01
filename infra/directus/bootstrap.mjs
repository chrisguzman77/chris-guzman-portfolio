// Idempotent Directus bootstrap. Runs inside the directus container:
//   node /directus/bootstrap/bootstrap.mjs
// Creates missing schema, the read-only web-reader policy/role/user (token from
// DIRECTUS_WEB_TOKEN), the revalidation Flow, and insert-only seed content.
// Never deletes anything and never overwrites content Chris edited in the CMS.
import { readFile } from "node:fs/promises";

import { DirectusClient, planSchema, planSeed, seedKeys } from "./lib.mjs";
import { CONTENT_COLLECTIONS, SINGLETONS, collections } from "./schema.mjs";

const BASE_URL = "http://127.0.0.1:8055";
const READER_NAME = "web-reader";
const READER_EMAIL = "web-reader@christopherguzman.me";
const FLOW_NAME = "revalidate site";
const REVALIDATE_URL = "http://web:3000/api/revalidate";
const SEED_ORDER = ["profile", "resume", "experience", "education", "involvement", "projects"];

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function waitForPing(attempts = 60) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(`${BASE_URL}/server/ping`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Directus did not answer ${BASE_URL}/server/ping`);
}

const q = (params) => `?${new URLSearchParams(params)}`;

async function ensureSchema(api) {
  const [cols, fields, relations] = await Promise.all([
    api.get("/collections"),
    api.get("/fields"),
    api.get("/relations"),
  ]);
  const ops = planSchema(
    { collections: cols.map((c) => c.collection), fields, relations },
    collections,
  );
  for (const op of ops) {
    if (op.type === "collection") await api.post("/collections", op.body);
    else if (op.type === "field") await api.post(`/fields/${op.collection}`, op.body);
    else await api.post("/relations", op.body);
  }
  console.log(`schema: ${ops.length} created`);
}

async function findOne(api, path, filter) {
  const rows = await api.get(`${path}${q({ filter: JSON.stringify(filter), limit: "1" })}`);
  return rows[0];
}

async function ensurePolicy(api) {
  let policy = await findOne(api, "/policies", { name: { _eq: READER_NAME } });
  let created = 0;
  if (!policy) {
    policy = await api.post("/policies", {
      name: READER_NAME,
      icon: "visibility",
      description: "Read-only access for the Next.js site: content collections and files.",
      admin_access: false,
      app_access: false,
    });
    created++;
  }
  const existing = await api.get(
    `/permissions${q({ filter: JSON.stringify({ policy: { _eq: policy.id } }), limit: "-1" })}`,
  );
  const have = new Set(existing.filter((p) => p.action === "read").map((p) => p.collection));
  for (const collection of [...CONTENT_COLLECTIONS, "directus_files"]) {
    if (have.has(collection)) continue;
    // No item filter: Directus 12 without a license rejects custom permission
    // rules (RESOURCE_RESTRICTED). The web app filters status=published itself.
    await api.post("/permissions", {
      policy: policy.id,
      collection,
      action: "read",
      fields: ["*"],
      permissions: {},
    });
    created++;
  }
  console.log(`policy: ${created} created`);
  return policy.id;
}

async function ensureRole(api, policyId) {
  let role = await findOne(api, "/roles", { name: { _eq: READER_NAME } });
  let created = 0;
  if (!role) {
    role = await api.post("/roles", { name: READER_NAME, icon: "visibility" });
    created++;
  }
  const link = await findOne(api, "/access", {
    role: { _eq: role.id },
    policy: { _eq: policyId },
  });
  if (!link) {
    await api.post("/access", { role: role.id, policy: policyId });
    created++;
  }
  console.log(`role: ${created} created`);
  return role.id;
}

async function ensureUser(api, roleId, token) {
  const user = await findOne(api, "/users", { email: { _eq: READER_EMAIL } });
  if (!user) {
    await api.post("/users", {
      email: READER_EMAIL,
      first_name: "Web",
      last_name: "Reader",
      role: roleId,
      status: "active",
      token,
    });
    console.log("user: created");
    return;
  }
  // Directus masks stored tokens on read, so set it every run; this is what
  // makes rotating DIRECTUS_WEB_TOKEN take effect on the next deploy.
  await api.patch(`/users/${user.id}`, { token });
  console.log("user: exists, token synced");
}

async function ensureFlow(api, secret) {
  const options = {
    method: "POST",
    url: REVALIDATE_URL,
    headers: [
      { header: "X-Revalidate-Secret", value: secret },
      { header: "Content-Type", value: "application/json" },
    ],
    // Only the collection: create events expose $trigger.key, update/delete
    // expose $trigger.keys, and an undefined key renders invalid JSON.
    body: '{"collection":"{{$trigger.collection}}"}',
  };
  let flow = await findOne(api, "/flows", { name: { _eq: FLOW_NAME } });
  if (!flow) {
    flow = await api.post("/flows", {
      name: FLOW_NAME,
      icon: "bolt",
      status: "active",
      trigger: "event",
      accountability: "activity",
      options: {
        type: "action",
        scope: ["items.create", "items.update", "items.delete"],
        collections: CONTENT_COLLECTIONS,
      },
    });
    const op = await api.post("/operations", {
      flow: flow.id,
      name: "Revalidate",
      key: "revalidate",
      type: "request",
      position_x: 19,
      position_y: 1,
      options,
    });
    await api.patch(`/flows/${flow.id}`, { operation: op.id });
    console.log("flow: created");
    return;
  }
  const op = await findOne(api, "/operations", {
    flow: { _eq: flow.id },
    key: { _eq: "revalidate" },
  });
  if (!op) throw new Error(`flow "${FLOW_NAME}" exists but has no "revalidate" operation`);
  if (JSON.stringify(op.options) !== JSON.stringify(options)) {
    await api.patch(`/operations/${op.id}`, { options });
    console.log("flow: exists, request options synced");
    return;
  }
  console.log("flow: exists");
}

async function loadSeed(name) {
  const url = new URL(`./seed/${name}.json`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

async function ensureSeed(api) {
  let inserted = 0;
  for (const name of SEED_ORDER) {
    const seed = await loadSeed(name);
    const keyFn = seedKeys[name];
    if (SINGLETONS.includes(name)) {
      const current = await api.get(`/items/${name}`);
      const existing = current?.id == null ? [] : [current];
      if (planSeed(existing, [seed], keyFn).length > 0) {
        await api.patch(`/items/${name}`, seed);
        inserted++;
      }
      continue;
    }
    const existing = await api.get(`/items/${name}${q({ fields: "*", limit: "-1" })}`);
    const inserts = planSeed(existing, seed, keyFn);
    if (inserts.length > 0) await api.post(`/items/${name}`, inserts);
    inserted += inserts.length;
  }
  console.log(`seed: ${inserted} inserted`);
}

async function main() {
  const webToken = env("DIRECTUS_WEB_TOKEN");
  const revalidateSecret = env("REVALIDATE_SECRET");
  await waitForPing();
  const api = new DirectusClient(BASE_URL);
  await api.login(env("ADMIN_EMAIL"), env("ADMIN_PASSWORD"));
  await ensureSchema(api);
  const policyId = await ensurePolicy(api);
  const roleId = await ensureRole(api, policyId);
  await ensureUser(api, roleId, webToken);
  await ensureFlow(api, revalidateSecret);
  await ensureSeed(api);
  console.log("bootstrap: done");
}

main().catch((err) => {
  console.error(`bootstrap: FAILED: ${err.message}`);
  process.exit(1);
});
