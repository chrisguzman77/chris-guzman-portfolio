// Pure planners for the Directus bootstrap, plus a tiny REST client.
// The planners only ever plan creations: nothing here updates or deletes an
// existing collection, field, relation, or content item.

/** Relation body for a file field (uuid pointing at directus_files). */
function fileRelation(collection, field) {
  return {
    collection,
    field,
    related_collection: "directus_files",
    schema: { on_delete: "SET NULL" },
  };
}

function isFileField(f) {
  return Array.isArray(f.meta?.special) && f.meta.special.includes("file");
}

/**
 * existing: { collections: string[], fields: {collection, field}[], relations: {collection, field}[] }
 * desired:  [{ collection, meta, fields: [{ field, type, meta, schema }] }]
 * Returns ops in a safe order: collections, then fields, then relations.
 */
export function planSchema(existing, desired) {
  const haveCollection = new Set(existing.collections);
  const haveField = new Set(existing.fields.map((f) => `${f.collection}.${f.field}`));
  const haveRelation = new Set(existing.relations.map((r) => `${r.collection}.${r.field}`));
  const collections = [];
  const fields = [];
  const relations = [];
  for (const c of desired) {
    if (!haveCollection.has(c.collection)) {
      collections.push({
        type: "collection",
        collection: c.collection,
        body: { collection: c.collection, meta: c.meta, schema: {} },
      });
    }
    for (const f of c.fields) {
      const key = `${c.collection}.${f.field}`;
      if (!haveField.has(key)) {
        fields.push({ type: "field", collection: c.collection, field: f.field, body: f });
      }
      if (isFileField(f) && !haveRelation.has(key)) {
        relations.push({
          type: "relation",
          collection: c.collection,
          field: f.field,
          body: fileRelation(c.collection, f.field),
        });
      }
    }
  }
  return [...collections, ...fields, ...relations];
}

/**
 * Seed-once decision for one collection. `seededNames` is bootstrap_state.seeded:
 * every collection the bootstrap has already seeded or found populated. A recorded
 * collection is never seeded again, so emptying it in the CMS sticks.
 */
export function planSeedOnce(seededNames, name, existingCount) {
  if (seededNames.includes(name)) return "skip";
  return existingCount === 0 ? "seed" : "record";
}

/** Deep equality for JSON values; object key order is ignored (jsonb reorders keys). */
export function sameJson(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && sameJson(a[k], b[k]));
}

/** Stable identity of a seed item per collection (used to check seed files for duplicates). */
export const seedKeys = {
  profile: () => "singleton",
  resume: () => "singleton",
  experience: (i) => JSON.stringify([i.company, i.role]),
  education: (i) => i.school,
  involvement: (i) => i.organization,
  projects: (i) => i.slug,
};

/**
 * The message for a rejected admin login, or null when the failure is something
 * else. Directus reads ADMIN_EMAIL/ADMIN_PASSWORD only on first install, so a 401
 * here means the env no longer matches the live admin user. Never includes the values.
 */
export function adminLoginFailure(status, body) {
  const credentials =
    status === 401 || (status === 400 && /INVALID_CREDENTIALS|INVALID_OTP|otp/i.test(body));
  if (!credentials) return null;
  return [
    `admin login rejected (${status}): DIRECTUS_ADMIN_EMAIL / DIRECTUS_ADMIN_PASSWORD in`,
    "infra/compose/prod.enc.env no longer match the live Directus admin user (the password",
    "was changed in the Directus UI, or 2FA was enabled on that account). Directus only reads",
    "them at first install. Fix: make secrets-edit so they match the current admin login,",
    "keep 2FA off for that account, commit, merge, deploy (docs/runbook.md, Rotate secrets).",
  ].join(" ");
}

/** The message for a rejected DIRECTUS_BOOTSTRAP_TOKEN (401/403), or null. Never includes the token. */
export function bootstrapTokenFailure(status) {
  if (status !== 401 && status !== 403) return null;
  return `DIRECTUS_BOOTSTRAP_TOKEN was rejected (HTTP ${status}); regenerate it for an admin user (docs/setup.md, "Directus bootstrap token")`;
}

export class DirectusClient {
  constructor(baseUrl, fetchImpl = globalThis.fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetch = fetchImpl;
    this.token = undefined;
  }

  async login(email, password) {
    let data;
    try {
      data = await this.request("POST", "/auth/login", { email, password });
    } catch (err) {
      const message = adminLoginFailure(err.status, err.body ?? "");
      if (message) throw new Error(message, { cause: err });
      throw err;
    }
    this.token = data.access_token;
  }

  /** Uses a static token, checked with one GET /users/me before any other call. */
  async useStaticToken(token) {
    this.token = token;
    try {
      await this.get("/users/me");
    } catch (err) {
      const message = bootstrapTokenFailure(err.status);
      if (message) throw new Error(message, { cause: err });
      throw err;
    }
  }

  get(path) {
    return this.request("GET", path);
  }

  post(path, body) {
    return this.request("POST", path, body);
  }

  patch(path, body) {
    return this.request("PATCH", path, body);
  }

  /** Returns the response's `data` (null for 204). Throws on any non-2xx. */
  async request(method, path, body) {
    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw Object.assign(new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`), {
        status: res.status,
        body: text,
      });
    }
    return text ? JSON.parse(text).data : null;
  }
}
