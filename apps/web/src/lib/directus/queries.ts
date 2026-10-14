import type { z } from "zod";

import { fileVersion } from "@/lib/cms-assets";
import { sortExperience } from "@/lib/format";

import { DirectusUnavailableError, directusFiles, directusGet } from "./client";
import {
  CertificationSchema,
  ChatSettingsSchema,
  EducationSchema,
  ExperienceSchema,
  FaqSchema,
  FILE_FIELDS,
  FileFieldsSchema,
  FileSchema,
  InvolvementSchema,
  PostAssetRefSchema,
  PostSchema,
  PostSummarySchema,
  ProfileSchema,
  ProjectSchema,
  ResumeSchema,
  type Certification,
  type ChatSettings,
  type Education,
  type Experience,
  type Faq,
  type Involvement,
  type Post,
  type PostAssetRef,
  type PostSummary,
  type Profile,
  type Project,
  type Resume,
} from "./schemas";
import { FILES_TAG, collectionTag, itemTag, type ContentCollection } from "./tags";

// Every collection query filters on status: unlicensed Directus cannot restrict the read
// token's permissions, so without this the site would render drafts.
const PUBLISHED = "filter[status][_eq]=published";

function fileKeys(schema: z.ZodObject): string[] {
  return Object.keys(schema.shape).filter((key) => schema.shape[key] === FileSchema);
}

// Request exactly the fields the schema validates, nothing more. A file field also asks for the
// file's id and upload time (see FileSchema).
function fields(schema: z.ZodObject): string {
  const files = new Set(fileKeys(schema));
  return Object.keys(schema.shape)
    .flatMap((key) => (files.has(key) ? [key, ...FILE_FIELDS.map((f) => `${key}.${f}`)] : [key]))
    .join(",");
}

// A query that reads a file version is refreshed when that file is replaced, too.
function tags(schema: z.ZodObject, ...base: string[]): string[] {
  return fileKeys(schema).length > 0 ? [...base, FILES_TAG] : base;
}

function parseItem<S extends z.ZodType>(
  schema: S,
  item: unknown,
  label: string,
): z.output<S> | null {
  const result = schema.safeParse(item);
  if (result.success) return result.data;
  console.error(`[directus] dropped invalid ${label}`, result.error.issues);
  return null;
}

function parseList<S extends z.ZodType>(schema: S, data: unknown, label: string): z.output<S>[] {
  if (!Array.isArray(data)) {
    console.error(`[directus] expected a list for ${label}`);
    return [];
  }
  return data.flatMap((item) => {
    const parsed = parseItem(schema, item, label);
    return parsed === null ? [] : [parsed];
  });
}

// Directus being down must never crash a page: fall back to the empty state.
async function orFallback<T>(fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DirectusUnavailableError) {
      console.error(`[directus] ${error.message}`);
      return fallback;
    }
    throw error;
  }
}

function getList<S extends z.ZodObject>(
  collection: ContentCollection,
  schema: S,
  sort: string,
): Promise<z.output<S>[]> {
  return orFallback<z.output<S>[]>([], async () => {
    const path = `${collection}?fields=${fields(schema)}&${PUBLISHED}&sort=${sort}&limit=-1`;
    const data = await directusGet(path, tags(schema, collectionTag(collection)));
    return parseList(schema, data, collection);
  });
}

function getBySlug<S extends z.ZodObject>(
  collection: "projects" | "posts",
  schema: S,
  slug: string,
): Promise<z.output<S> | null> {
  return orFallback<z.output<S> | null>(null, async () => {
    const path = `${collection}?fields=${fields(schema)}&${PUBLISHED}&filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1`;
    const data = await directusGet(
      path,
      tags(schema, collectionTag(collection), itemTag(collection, slug)),
    );
    const [item] = Array.isArray(data) ? data : [];
    return item === undefined ? null : parseItem(schema, item, `${collection}:${slug}`);
  });
}

function getSingleton<S extends z.ZodObject>(
  collection: "profile" | "resume" | "chat_settings",
  schema: S,
): Promise<z.output<S> | null> {
  return orFallback<z.output<S> | null>(null, async () => {
    const data = await directusGet(
      `${collection}?fields=${fields(schema)}`,
      tags(schema, collectionTag(collection)),
    );
    return data === null ? null : parseItem(schema, data, collection);
  });
}

export function getProfile(): Promise<Profile | null> {
  return getSingleton("profile", ProfileSchema);
}

export async function getExperience(): Promise<Experience[]> {
  return sortExperience(await getList("experience", ExperienceSchema, "-start_date"));
}

export function getEducation(): Promise<Education[]> {
  return getList("education", EducationSchema, "sort");
}

export function getInvolvement(): Promise<Involvement[]> {
  return getList("involvement", InvolvementSchema, "sort");
}

export function getCertifications(): Promise<Certification[]> {
  return getList("certifications", CertificationSchema, "sort");
}

export function getFaq(): Promise<Faq[]> {
  return getList("faq", FaqSchema, "sort");
}

export function getProjects(): Promise<Project[]> {
  return getList("projects", ProjectSchema, "sort,-date");
}

export function getProject(slug: string): Promise<Project | null> {
  return getBySlug("projects", ProjectSchema, slug);
}

export function getPosts(): Promise<PostSummary[]> {
  return getList("posts", PostSummarySchema, "-published_at");
}

export function getPost(slug: string): Promise<Post | null> {
  return getBySlug("posts", PostSchema, slug);
}

function getPostAssetRefs(): Promise<PostAssetRef[]> {
  return getList("posts", PostAssetRefSchema, "-published_at");
}

export function getResume(): Promise<Resume | null> {
  return getSingleton("resume", ResumeSchema);
}

export function getChatSettings(): Promise<ChatSettings | null> {
  return getSingleton("chat_settings", ChatSettingsSchema);
}

// Versions of the files a markdown body links to (id -> version, see cmsAssetUrl), in one cached
// query tagged files. A file that is missing, unreadable or has no upload time is left out, and
// Directus being down gives {}: those links fall back to unversioned URLs.
export function getFileVersions(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return Promise.resolve({});
  return orFallback<Record<string, string>>({}, async () => {
    // Sorted and de-duplicated, so a body always hits the same cache entry.
    const list = [...new Set(ids)].sort().join(",");
    const query = `fields=${FILE_FIELDS.join(",")}&filter[id][_in]=${list}&limit=-1`;
    const files = parseList(FileFieldsSchema, await directusFiles(query, [FILES_TAG]), "files");
    return Object.fromEntries(
      files.flatMap(({ id, uploaded_on }) => {
        const version = fileVersion(uploaded_on);
        return version ? [[id, version]] : [];
      }),
    );
  });
}

// Allow-list for /cms-assets: only files that published content points at. Resume and project
// lookups reuse the cached (published-only) queries; posts use their own cached query
// (getPostAssetRefs, cover and body only), fetched on first use and then served from cache.
export async function isReferencedFile(id: string): Promise<boolean> {
  const [resume, projects, posts] = await Promise.all([
    getResume(),
    getProjects(),
    getPostAssetRefs(),
  ]);
  if (resume?.file?.id === id) return true;
  const ref = `/assets/${id}`;
  return (
    projects.some((item) => item.cover?.id === id || (item.body ?? "").includes(ref)) ||
    posts.some((item) => item.cover === id || item.body.includes(ref))
  );
}
