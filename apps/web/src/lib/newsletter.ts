import { EMAIL_PATTERN } from "@/lib/contact";
import { z } from "@/lib/zod-client";

export const NEWSLETTER_MESSAGES = {
  checkInbox: "Check your inbox to confirm.",
  invalidEmail: "Enter a valid email address.",
  rateLimited: "Too many tries. Try again later.",
  turnstile: "Spam check failed. Try again.",
  pendingToken: "Spam check is still running. Try again in a moment.",
  unavailable: "Couldn't subscribe right now. Try again later.",
} as const;

export type SubscribeResult = "ok" | "invalid" | "turnstile" | "rate_limited" | "unavailable";
export type LinkResult = "ok" | "invalid" | "unavailable";
export type LinkAction = "confirm" | "unsubscribe";

// Same rule as the contact form; the API's email validation stays the authority.
export function isValidEmail(value: string): boolean {
  const email = value.trim();
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

const ErrorBody = z.object({ error: z.object({ code: z.string() }) });

async function errorCode(res: Response): Promise<string | null> {
  const parsed = ErrorBody.safeParse(await res.json().catch(() => null));
  return parsed.success ? parsed.data.error.code : null;
}

async function postJson(url: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return null;
  }
}

export async function subscribe(
  apiUrl: string,
  payload: { email: string; turnstile_token: string; website: string },
): Promise<SubscribeResult> {
  const res = await postJson(`${apiUrl}/v1/newsletter/subscribe`, {
    ...payload,
    email: payload.email.trim(),
  });
  if (!res) return "unavailable";
  if (res.status === 202) return "ok";
  if (res.status === 429) return "rate_limited";
  if (res.status === 400) {
    const code = await errorCode(res);
    if (code === "turnstile_failed") return "turnstile";
    if (code === "invalid_request") return "invalid";
  }
  return "unavailable";
}

export async function submitLinkToken(
  apiUrl: string,
  action: LinkAction,
  token: string,
): Promise<LinkResult> {
  const res = await postJson(`${apiUrl}/v1/newsletter/${action}`, { token });
  if (!res) return "unavailable";
  if (res.ok) return "ok";
  if (res.status === 400 && (await errorCode(res)) === "invalid_token") return "invalid";
  return "unavailable";
}
