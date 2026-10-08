import { z } from "zod";

import { serverEnv } from "@/lib/env";

const SubscriberSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  status: z.enum(["pending", "confirmed"]),
  created_at: z.string(),
  confirmed_at: z.string().nullable(),
});

const SubscriberListSchema = z.object({
  subscribers: z.array(SubscriberSchema),
  totals: z.object({ confirmed: z.number().int(), pending: z.number().int() }),
});

export type Subscriber = z.infer<typeof SubscriberSchema>;
export type SubscriberList = z.infer<typeof SubscriberListSchema>;

const TIMEOUT_MS = 5_000;

function internalApi(): { base: string; headers: Record<string, string> } | null {
  const { apiInternalUrl, internalApiSecret } = serverEnv();
  if (!apiInternalUrl || !internalApiSecret) return null;
  return { base: apiInternalUrl, headers: { "X-Internal-Secret": internalApiSecret } };
}

/** Every subscriber, newest first, from the API over the compose network. Null on any failure. */
export async function listSubscribers(): Promise<SubscriberList | null> {
  const api = internalApi();
  if (!api) return null;
  try {
    const res = await fetch(`${api.base}/internal/newsletter/subscribers`, {
      headers: api.headers,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const parsed = SubscriberListSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function removeSubscriber(id: string): Promise<boolean> {
  const api = internalApi();
  if (!api || !z.uuid().safeParse(id).success) return false;
  try {
    const res = await fetch(`${api.base}/internal/newsletter/subscribers/${id}`, {
      method: "DELETE",
      headers: api.headers,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.status === 204;
  } catch {
    return false;
  }
}
