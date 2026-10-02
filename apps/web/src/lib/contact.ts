import { z } from "zod";

export const CONTACT_LIMITS = { name: 100, email: 254, messageMin: 10, messageMax: 5000 } as const;

export const CONTACT_MESSAGES = {
  sent: "Message sent. I'll reply to the email you gave.",
  rateLimited: "Too many messages. Try again later, or email me directly.",
  turnstile: "Spam check failed. Try again.",
  pendingToken: "Spam check is still running. Try again in a moment.",
} as const;

export type ContactField = "name" | "email" | "message";
export type ContactValues = Record<ContactField, string>;
export type ContactErrors = Partial<Record<ContactField, string>>;
export type ContactPayload = ContactValues & { turnstile_token: string; website: string };

export type SubmitResult =
  | { kind: "sent" }
  | { kind: "invalid"; fields: ContactErrors }
  | { kind: "turnstile" }
  | { kind: "rate_limited" }
  | { kind: "unavailable" };

export const CONTACT_FIELDS: ContactField[] = ["name", "email", "message"];

// Same limits as the API (apps/api/src/portfolio_api/schemas/contact.py); the API stays the authority.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContact(values: ContactValues): ContactErrors {
  const errors: ContactErrors = {};
  const name = values.name.trim();
  const email = values.email.trim();
  const message = values.message.trim();
  if (!name) errors.name = "Enter your name.";
  else if (name.length > CONTACT_LIMITS.name)
    errors.name = `Name must be at most ${CONTACT_LIMITS.name} characters.`;
  if (!EMAIL_PATTERN.test(email) || email.length > CONTACT_LIMITS.email)
    errors.email = "Enter a valid email address.";
  if (message.length < CONTACT_LIMITS.messageMin)
    errors.message = `Message must be at least ${CONTACT_LIMITS.messageMin} characters.`;
  else if (message.length > CONTACT_LIMITS.messageMax)
    errors.message = `Message must be at most ${CONTACT_LIMITS.messageMax} characters.`;
  return errors;
}

const ErrorBody = z.object({
  error: z.object({ code: z.string(), fields: z.record(z.string(), z.string()).optional() }),
});

export async function submitContact(
  apiUrl: string,
  payload: ContactPayload,
): Promise<SubmitResult> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/v1/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        name: payload.name.trim(),
        email: payload.email.trim(),
        message: payload.message.trim(),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (res.status === 202) return { kind: "sent" };
  if (res.status === 429) return { kind: "rate_limited" };
  if (res.status === 400) {
    const parsed = ErrorBody.safeParse(await res.json().catch(() => null));
    if (parsed.success && parsed.data.error.code === "turnstile_failed")
      return { kind: "turnstile" };
    if (parsed.success && parsed.data.error.code === "invalid_request") {
      const fields: ContactErrors = {};
      for (const key of CONTACT_FIELDS) {
        const text = parsed.data.error.fields?.[key];
        if (text) fields[key] = text;
      }
      return { kind: "invalid", fields };
    }
  }
  return { kind: "unavailable" };
}
