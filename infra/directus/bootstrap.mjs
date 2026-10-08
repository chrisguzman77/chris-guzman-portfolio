// Idempotent Directus bootstrap. Runs inside the directus container:
//   node /directus/bootstrap/bootstrap.mjs
// Creates missing schema, the read-only web-reader policy/role/user (token from
// DIRECTUS_WEB_TOKEN), the optional api-reader user (token from DIRECTUS_API_TOKEN),
// the revalidation Flow, the optional reindex step and the newsletter Flow (secret from INTERNAL_API_SECRET),
// and seed content (each collection at most once, and only while it is empty; the
// hidden bootstrap_state singleton records which ones are done). Never deletes
// anything and never overwrites content Chris edited in the CMS.
// Auth: DIRECTUS_BOOTSTRAP_TOKEN (an admin user's static token) when set, otherwise
// an ADMIN_EMAIL/ADMIN_PASSWORD login.
import { readFile } from "node:fs/promises";

import { DirectusClient, newsletterFlow, planSchema, planSeedOnce, sameJson } from "./lib.mjs";
import { BOOTSTRAP_STATE, CONTENT_COLLECTIONS, SINGLETONS, collections } from "./schema.mjs";

const BASE_URL = "http://127.0.0.1:8055";
const WEB_READER = {
  name: "web-reader",
  email: "web-reader@christopherguzman.me",
  firstName: "Web",
  lastName: "Reader",
};
const API_READER = {
  name: "api-reader",
  email: "api-reader@christopherguzman.me",
  firstName: "API",
  lastName: "Reader",
};
const FLOW_NAME = "revalidate site";
const REVALIDATE_URL = "http://web:3000/api/revalidate";
const REINDEX_URL = "http://api:8000/internal/reindex";
const SEED_ORDER = [
  "profile",
  "resume",
  "chat_settings",
  "experience",
  "education",
  "involvement",
  "projects",
];

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
  let policy = await findOne(api, "/policies", { name: { _eq: WEB_READER.name } });
  let created = 0;
  if (!policy) {
    policy = await api.post("/policies", {
      name: WEB_READER.name,
      icon: "visibility",
      description: "Read-only access for the Next.js site: content collections and files.",
      admin_access: false,
      app_access: false,
    });
    created++;
  } else if (policy.admin_access !== false || policy.app_access !== false) {
    await api.patch(`/policies/${policy.id}`, { admin_access: false, app_access: false });
    console.log("policy: admin_access/app_access re-asserted false");
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

async function ensureRole(api, policyId, name) {
  let role = await findOne(api, "/roles", { name: { _eq: name } });
  let created = 0;
  if (!role) {
    role = await api.post("/roles", { name, icon: "visibility" });
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
  console.log(`role ${name}: ${created} created`);
  return role.id;
}

async function ensureUser(api, roleId, token, reader) {
  const user = await findOne(api, "/users", { email: { _eq: reader.email } });
  if (!user) {
    await api.post("/users", {
      email: reader.email,
      first_name: reader.firstName,
      last_name: reader.lastName,
      role: roleId,
      status: "active",
      token,
    });
    console.log(`user ${reader.name}: created`);
    return;
  }
  // Directus masks stored tokens on read, so set it every run; this is what
  // makes rotating a reader token take effect on the next deploy.
  await api.patch(`/users/${user.id}`, { token });
  console.log(`user ${reader.name}: exists, token synced`);
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
  const triggerOptions = {
    type: "action",
    scope: ["items.create", "items.update", "items.delete"],
    collections: CONTENT_COLLECTIONS,
  };
  let flow = await findOne(api, "/flows", { name: { _eq: FLOW_NAME } });
  if (!flow) {
    flow = await api.post("/flows", {
      name: FLOW_NAME,
      icon: "bolt",
      status: "active",
      trigger: "event",
      accountability: "activity",
      options: triggerOptions,
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
    return { flow, op };
  }
  const op = await findOne(api, "/operations", {
    flow: { _eq: flow.id },
    key: { _eq: "revalidate" },
  });
  if (!op) throw new Error(`flow "${FLOW_NAME}" exists but has no "revalidate" operation`);
  const synced = [];
  if (!sameJson(flow.options, triggerOptions)) {
    await api.patch(`/flows/${flow.id}`, { options: triggerOptions });
    synced.push("trigger");
  }
  if (!sameJson(op.options, options)) {
    await api.patch(`/operations/${op.id}`, { options });
    synced.push("request");
  }
  console.log(synced.length ? `flow: exists, ${synced.join(" + ")} options synced` : "flow: exists");
  return { flow, op };
}

async function ensureReindex(api, flow, revalidateOp, internalSecret) {
  const options = {
    method: "POST",
    url: REINDEX_URL,
    headers: [
      { header: "X-Internal-Secret", value: internalSecret },
      { header: "Content-Type", value: "application/json" },
    ],
    body: "{}",
  };
  let op = await findOne(api, "/operations", {
    flow: { _eq: flow.id },
    key: { _eq: "reindex" },
  });
  if (!op) {
    op = await api.post("/operations", {
      flow: flow.id,
      name: "Reindex chat",
      key: "reindex",
      type: "request",
      position_x: 37,
      position_y: 1,
      options,
    });
    console.log("flow: reindex step created");
  } else if (!sameJson(op.options, options)) {
    await api.patch(`/operations/${op.id}`, { options });
    console.log("flow: reindex options synced");
  }
  // Re-index whether or not the web revalidation succeeded.
  if (revalidateOp.resolve !== op.id || revalidateOp.reject !== op.id) {
    await api.patch(`/operations/${revalidateOp.id}`, { resolve: op.id, reject: op.id });
    console.log("flow: reindex chained after revalidate");
  }
}

async function ensureNewsletterFlow(api, internalSecret) {
  const spec = newsletterFlow(internalSecret);
  const changes = [];
  let flow = await findOne(api, "/flows", { name: { _eq: spec.flow.name } });
  if (!flow) {
    flow = await api.post("/flows", spec.flow);
    changes.push("created");
  } else if (!sameJson(flow.options, spec.flow.options)) {
    await api.patch(`/flows/${flow.id}`, { options: spec.flow.options });
    changes.push("trigger synced");
  }
  const ops = {};
  for (const op of spec.operations) {
    let row = await findOne(api, "/operations", { flow: { _eq: flow.id }, key: { _eq: op.key } });
    if (!row) {
      row = await api.post("/operations", { ...op, flow: flow.id });
      changes.push(`${op.key} created`);
    } else if (!sameJson(row.options, op.options)) {
      row = await api.patch(`/operations/${row.id}`, { options: op.options });
      changes.push(`${op.key} synced`);
    }
    ops[op.key] = row;
  }
  for (const [from, to] of Object.entries(spec.chain)) {
    if (ops[from].resolve !== ops[to].id) {
      await api.patch(`/operations/${ops[from].id}`, { resolve: ops[to].id });
      changes.push(`${from} -> ${to}`);
    }
  }
  if (flow.operation !== ops.send.id) {
    await api.patch(`/flows/${flow.id}`, { operation: ops.send.id });
    changes.push("entry set");
  }
  console.log(`newsletter flow: ${changes.length ? changes.join(", ") : "exists"}`);
}

async function loadSeed(name) {
  const url = new URL(`./seed/${name}.json`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

async function ensureSeed(api) {
  const state = await api.get(`/items/${BOOTSTRAP_STATE}`);
  const seeded = Array.isArray(state?.seeded) ? state.seeded : [];
  const next = [...seeded];
  let inserted = 0;
  for (const name of SEED_ORDER) {
    const singleton = SINGLETONS.includes(name);
    let existingCount;
    if (singleton) {
      const current = await api.get(`/items/${name}`);
      existingCount = current?.id == null ? 0 : 1;
    } else {
      existingCount = (await api.get(`/items/${name}${q({ fields: "id", limit: "-1" })}`)).length;
    }
    const plan = planSeedOnce(seeded, name, existingCount);
    if (plan === "skip") continue;
    next.push(name);
    if (plan === "record") continue;
    const seed = await loadSeed(name);
    if (singleton) {
      await api.patch(`/items/${name}`, seed);
      inserted++;
    } else {
      await api.post(`/items/${name}`, seed);
      inserted += seed.length;
    }
  }
  if (next.length !== seeded.length) {
    await api.patch(`/items/${BOOTSTRAP_STATE}`, { seeded: next });
  }
  console.log(`seed: ${inserted} inserted; seeded once: ${next.join(", ")}`);
}

async function main() {
  const webToken = env("DIRECTUS_WEB_TOKEN");
  const revalidateSecret = env("REVALIDATE_SECRET");
  // Optional until Chris adds the Phase 5 secrets; deploys keep working without them.
  const apiToken = process.env.DIRECTUS_API_TOKEN;
  const internalSecret = process.env.INTERNAL_API_SECRET;
  await waitForPing();
  const api = new DirectusClient(BASE_URL);
  const bootstrapToken = process.env.DIRECTUS_BOOTSTRAP_TOKEN;
  if (bootstrapToken) {
    await api.useStaticToken(bootstrapToken);
    console.log("auth: static token");
  } else {
    await api.login(env("ADMIN_EMAIL"), env("ADMIN_PASSWORD"));
    console.log("auth: admin password");
  }
  await ensureSchema(api);
  const policyId = await ensurePolicy(api);
  const webRoleId = await ensureRole(api, policyId, WEB_READER.name);
  await ensureUser(api, webRoleId, webToken, WEB_READER);
  if (apiToken) {
    const apiRoleId = await ensureRole(api, policyId, API_READER.name);
    await ensureUser(api, apiRoleId, apiToken, API_READER);
  } else {
    console.log("api-reader: skipped (DIRECTUS_API_TOKEN not set)");
  }
  const { flow, op } = await ensureFlow(api, revalidateSecret);
  if (internalSecret) {
    await ensureReindex(api, flow, op, internalSecret);
    await ensureNewsletterFlow(api, internalSecret);
  } else {
    console.log("flow: reindex step and newsletter flow skipped (INTERNAL_API_SECRET not set)");
  }
  await ensureSeed(api);
  console.log("bootstrap: done");
}

main().catch((err) => {
  console.error(`bootstrap: FAILED: ${err.message}`);
  process.exit(1);
});
