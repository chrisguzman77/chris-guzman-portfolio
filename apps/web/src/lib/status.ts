import { connection } from "next/server";
import { z } from "zod";

import { serverEnv } from "@/lib/env";

const MEMO_MS = 60_000;
const TIMEOUT_MS = 2_000;

/** A day's bar is green at or above this uptime ratio, amber below. */
export const GREEN_AT = 0.995;

const ratio = z.number().min(0).max(1);

// Mirrors GET /v1/status exactly. Anything else is treated as "API unreachable".
export const SiteStatusSchema = z.object({
  status: z.enum(["operational", "degraded"]),
  uptime_30d: ratio.nullable(),
  daily: z.array(z.object({ date: z.iso.date(), uptime: ratio.nullable() })).length(30),
  p95_ms: z.number().int().nonnegative().nullable(),
  requests_today: z.number().int().nonnegative().nullable(),
  last_backup_at: z.iso.datetime({ offset: true }).nullable(),
});

export type SiteStatus = z.infer<typeof SiteStatusSchema>;

// Last observed result (including a failure), reused for 60s so every homepage view does not
// hit the API. Not the Next data cache: that would keep serving stale numbers while the API is down.
let memo: { value: SiteStatus | null; at: number } | undefined;

async function fetchStatus(apiInternalUrl: string): Promise<SiteStatus | null> {
  try {
    const res = await fetch(`${apiInternalUrl}/v1/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const parsed = SiteStatusSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Request-time only (connection() keeps `next build` from calling the API). Null on any failure. */
export async function getStatus(): Promise<SiteStatus | null> {
  await connection();
  const { apiInternalUrl } = serverEnv();
  if (!apiInternalUrl) return null;
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.value;
  const value = await fetchStatus(apiInternalUrl);
  memo = { value, at: Date.now() };
  return value;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

const dayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** "Oct 3: 99.97%". The date is already an America/New_York calendar day, so format it as UTC. */
export function dayLabel(day: { date: string; uptime: number | null }): string {
  const date = dayFormat.format(new Date(`${day.date}T00:00:00Z`));
  return `${date}: ${day.uptime === null ? "no data" : formatPercent(day.uptime)}`;
}

/** "12m ago", "3h ago", "2d ago". Never below "1m ago", even with clock skew. */
export function formatAgo(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
