import { connection } from "next/server";
import { z } from "zod";

import { serverEnv } from "@/lib/env";

const DaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  count: z.number().int().nonnegative(),
  level: z.number().int().min(0).max(4),
});

export const ActivitySchema = z.object({
  total: z.number().int().nonnegative(),
  weeks: z.array(z.object({ days: z.array(DaySchema) })).min(1),
  fetched_at: z.string(),
});

export type Activity = z.infer<typeof ActivitySchema>;
export type ActivityDay = z.infer<typeof DaySchema>;

const SUCCESS_MS = 300_000;
const FAILURE_MS = 60_000;
const TIMEOUT_MS = 1_500;

// Module memo, not the Next data cache. The home page awaits this with its other data (section
// numbers depend on it), so failures are remembered too: a hung API costs one timeout a minute.
let memo: { value: Activity | null; until: number } | undefined;

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
  if (memo && Date.now() < memo.until) return memo.value;
  const value = await fetchActivity(apiInternalUrl);
  memo = { value, until: Date.now() + (value ? SUCCESS_MS : FAILURE_MS) };
  return value;
}
