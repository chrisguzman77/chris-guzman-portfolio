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

/** Seed items whose key is not already present (insert-only, de-duplicated). */
export function planSeed(existingItems, seedItems, keyFn) {
  const seen = new Set(existingItems.map(keyFn));
  const inserts = [];
  for (const item of seedItems) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      inserts.push(item);
    }
  }
  return inserts;
}

/** Stable identity of a seed item per collection. Singletons: one row or none. */
export const seedKeys = {
  profile: () => "singleton",
  resume: () => "singleton",
  experience: (i) => JSON.stringify([i.company, i.role]),
  education: (i) => i.school,
  involvement: (i) => i.organization,
  projects: (i) => i.slug,
};

export class DirectusClient {
  constructor(baseUrl, fetchImpl = globalThis.fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetch = fetchImpl;
    this.token = undefined;
  }

  async login(email, password) {
    const data = await this.request("POST", "/auth/login", { email, password });
    this.token = data.access_token;
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
      throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
    }
    return text ? JSON.parse(text).data : null;
  }
}
