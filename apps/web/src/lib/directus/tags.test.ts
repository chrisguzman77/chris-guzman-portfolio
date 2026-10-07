import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CONTENT_COLLECTIONS, collectionTag, isContentCollection, itemTag } from "./tags";

describe("cache tags", () => {
  it("lists the nine content collections", () => {
    expect(CONTENT_COLLECTIONS).toEqual([
      "profile",
      "experience",
      "education",
      "involvement",
      "certifications",
      "projects",
      "posts",
      "resume",
      "chat_settings",
    ]);
  });

  it("uses the collection name as its tag", () => {
    expect(collectionTag("projects")).toBe("projects");
  });

  it("builds item tags as collection:slug", () => {
    expect(itemTag("posts", "hello-world")).toBe("posts:hello-world");
  });

  it("recognises only known collections", () => {
    expect(isContentCollection("posts")).toBe(true);
    expect(isContentCollection("directus_users")).toBe(false);
    expect(isContentCollection("")).toBe(false);
  });

  // infra/directus/schema.mjs drives the Directus revalidate Flow's collection list. If the two
  // drift, edits to a collection would silently stop invalidating the site cache.
  // CI checks out the whole repo, so a missing file there is a failure, not a skip.
  const schemaPath = join(__dirname, "../../../../../infra/directus/schema.mjs");
  it.skipIf(!existsSync(schemaPath) && !process.env.CI)(
    "matches the collections in infra/directus/schema.mjs (the revalidate Flow's list)",
    () => {
      const src = readFileSync(schemaPath, "utf8");
      const block = /export const CONTENT_COLLECTIONS = \[([^\]]*)\]/.exec(src)?.[1] ?? "";
      const infra = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
      expect([...infra].sort()).toEqual([...CONTENT_COLLECTIONS].sort());
    },
  );
});
