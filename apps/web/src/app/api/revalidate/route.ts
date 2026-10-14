import { timingSafeEqual } from "node:crypto";

import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { FILES_TAG, collectionTag, isContentCollection } from "@/lib/directus/tags";
import { serverEnv } from "@/lib/env";

// The Directus Flow posts { collection }. Any other fields are ignored. Only the
// collection tag is revalidated; every list and detail query carries it. File events
// (directus_files, e.g. "Replace file") revalidate the files tag of every query that
// carries a file version.
const BodySchema = z.object({ collection: z.string() });

function tagFor(collection: string): string | null {
  if (collection === "directus_files") return FILES_TAG;
  return isContentCollection(collection) ? collectionTag(collection) : null;
}

function secretMatches(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Unauthorized calls are public noise, so log at most once a minute per process.
const UNAUTHORIZED_LOG_MS = 60_000;
let lastUnauthorizedLog = -Infinity;
let suppressed = 0;

function logUnauthorized(): void {
  const now = Date.now();
  if (now - lastUnauthorizedLog < UNAUTHORIZED_LOG_MS) {
    suppressed += 1;
    return;
  }
  console.warn(`revalidate: unauthorized request (${suppressed} suppressed since last log)`);
  lastUnauthorizedLog = now;
  suppressed = 0;
}

export async function POST(request: Request) {
  const expected = serverEnv().revalidateSecret;
  if (!expected || !secretMatches(request.headers.get("x-revalidate-secret"), expected)) {
    logUnauthorized();
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  const tag = parsed.success ? tagFor(parsed.data.collection) : null;
  if (!parsed.success || tag === null) {
    return NextResponse.json({ error: "unknown collection" }, { status: 400 });
  }

  revalidateTag(tag, { expire: 0 });
  console.info(`revalidate: ${parsed.data.collection} -> ${tag}`);
  return NextResponse.json({ revalidated: [tag] });
}
