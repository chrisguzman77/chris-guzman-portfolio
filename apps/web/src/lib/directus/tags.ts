export const CONTENT_COLLECTIONS = [
  "profile",
  "experience",
  "education",
  "involvement",
  "certifications",
  "projects",
  "posts",
  "resume",
] as const;

export type ContentCollection = (typeof CONTENT_COLLECTIONS)[number];

export function collectionTag(collection: ContentCollection): string {
  return collection;
}

export function itemTag(collection: "projects" | "posts", slug: string): string {
  return `${collection}:${slug}`;
}

export function isContentCollection(value: string): value is ContentCollection {
  return (CONTENT_COLLECTIONS as readonly string[]).includes(value);
}
