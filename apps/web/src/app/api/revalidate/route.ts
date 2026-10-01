import { timingSafeEqual } from "node:crypto";

import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { collectionTag, isContentCollection } from "@/lib/directus/tags";
import { serverEnv } from "@/lib/env";

// The Directus Flow posts { collection }. Any other fields are ignored. Only the
// collection tag is revalidated; every list and detail query carries it.
const BodySchema = z.object({ collection: z.string() });

function secretMatches(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = serverEnv().revalidateSecret;
  if (!expected || !secretMatches(request.headers.get("x-revalidate-secret"), expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success || !isContentCollection(parsed.data.collection)) {
    return NextResponse.json({ error: "unknown collection" }, { status: 400 });
  }

  const tag = collectionTag(parsed.data.collection);
  revalidateTag(tag, { expire: 0 });
  console.info(`revalidate: ${parsed.data.collection} -> ${tag}`);
  return NextResponse.json({ revalidated: [tag] });
}
