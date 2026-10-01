import { describe, expect, it } from "vitest";

import { CONTENT_COLLECTIONS, collectionTag, isContentCollection, itemTag } from "./tags";

describe("cache tags", () => {
  it("lists the eight content collections", () => {
    expect(CONTENT_COLLECTIONS).toEqual([
      "profile",
      "experience",
      "education",
      "involvement",
      "certifications",
      "projects",
      "posts",
      "resume",
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
});
