import { connection } from "next/server";
import { z } from "zod";

import { serverEnv } from "@/lib/env";

const DaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  count: z.number().int().nonnegative(),
  level: z.number().int().min(0).max(4),
});

// "2026-02-30" matches the shape but is not a day: Date rolls it over, so a round trip exposes it.
function isRealDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date);
}

// Days that do not parse (including impossible dates) are dropped, not rendered.
const DaysSchema = z.array(z.unknown()).transform((days) =>
  days.flatMap((day) => {
    const parsed = DaySchema.safeParse(day);
    return parsed.success && isRealDate(parsed.data.date) ? [parsed.data] : [];
  }),
);

export const ActivitySchema = z.object({
  total: z.number().int().nonnegative(),
  weeks: z.array(z.object({ days: DaysSchema })).min(1),
  fetched_at: z.string(),
});

export type Activity = z.infer<typeof ActivitySchema>;
export type ActivityDay = z.infer<typeof DaySchema>;

const SUCCESS_MS = 300_000;
const FAILURE_MS = 60_000;
const TIMEOUT_MS = 1_500;

// Module memo, not the Next data cache. The home page awaits this with its other data (section
// numbers depend on it), so failures are remembered too: a hung API costs one timeout a minute.
// The promise is memoized, not the value, so callers arriving while a refresh is in flight (or at
// expiry) share it instead of each starting a fetch.
let memo: { promise: Promise<Activity | null>; until: number } | undefined;

async function fetchActivity(base: string): Promise<Activity | null> {
  try {
    const res = await fetch(`${base}/v1/github/activity`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status !== 200) return null;
    const parsed = ActivitySchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function getGithubActivity(): Promise<Activity | null> {
  await connection();
  const { apiInternalUrl } = serverEnv();
  if (!apiInternalUrl) return null;
  if (memo && Date.now() < memo.until) return memo.promise;
  const entry = {
    promise: fetchActivity(apiInternalUrl),
    until: Number.POSITIVE_INFINITY, // in flight: joined by every caller until it settles
  };
  memo = entry;
  const value = await entry.promise;
  entry.until = Date.now() + (value ? SUCCESS_MS : FAILURE_MS);
  return value;
}
