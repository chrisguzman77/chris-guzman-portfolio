import type { z } from "zod";

import { sortExperience } from "@/lib/format";

import { DirectusUnavailableError, directusGet } from "./client";
import {
  CertificationSchema,
  ChatSettingsSchema,
  EducationSchema,
  ExperienceSchema,
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
  type Involvement,
  type Post,
  type PostAssetRef,
  type PostSummary,
  type Profile,
  type Project,
  type Resume,
} from "./schemas";
import { collectionTag, itemTag, type ContentCollection } from "./tags";

// Every collection query filters on status: unlicensed Directus cannot restrict the read
// token's permissions, so without this the site would render drafts.
const PUBLISHED = "filter[status][_eq]=published";

// Request exactly the fields the schema validates, nothing more.
function fields(schema: z.ZodObject): string {
  return Object.keys(schema.shape).join(",");
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
    return parseList(schema, await directusGet(path, [collectionTag(collection)]), collection);
  });
}

function getBySlug<S extends z.ZodObject>(
  collection: "projects" | "posts",
  schema: S,
  slug: string,
): Promise<z.output<S> | null> {
  return orFallback<z.output<S> | null>(null, async () => {
    const path = `${collection}?fields=${fields(schema)}&${PUBLISHED}&filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1`;
    const data = await directusGet(path, [collectionTag(collection), itemTag(collection, slug)]);
    const [item] = Array.isArray(data) ? data : [];
    return item === undefined ? null : parseItem(schema, item, `${collection}:${slug}`);
  });
}

function getSingleton<S extends z.ZodObject>(
  collection: "profile" | "resume" | "chat_settings",
  schema: S,
): Promise<z.output<S> | null> {
  return orFallback<z.output<S> | null>(null, async () => {
    const data = await directusGet(`${collection}?fields=${fields(schema)}`, [
      collectionTag(collection),
    ]);
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

// Allow-list for /cms-assets: only files that published content points at. Reuses the cached
// (published-only) list queries, so checking a file costs no extra Directus requests once pages
// have rendered.
export async function isReferencedFile(id: string): Promise<boolean> {
  const [resume, projects, posts] = await Promise.all([
    getResume(),
    getProjects(),
    getPostAssetRefs(),
  ]);
  if (resume?.file === id) return true;
  const ref = `/assets/${id}`;
  return [...projects, ...posts].some(
    (item) => item.cover === id || (item.body ?? "").includes(ref),
  );
}
