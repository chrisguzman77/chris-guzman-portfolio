export const CONTENT_COLLECTIONS = [
  "profile",
  "experience",
  "education",
  "involvement",
  "certifications",
  "faq",
  "projects",
  "posts",
  "resume",
  "chat_settings",
] as const;

// Every query whose result carries a file version (see FileSchema) also carries this tag. The
// revalidate Flow's directus_files trigger (e.g. "Replace file") refreshes it.
export const FILES_TAG = "files";

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
