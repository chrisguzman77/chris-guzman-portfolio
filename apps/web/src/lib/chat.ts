import { z } from "zod";

export const CHAT_LIMITS = { question: 500 } as const;

export const CHAT_MESSAGES = {
  welcome:
    "Ask anything about Chris's experience, projects, or skills. Answers come only from this site and may be wrong. Conversations are stored for 30 days.",
  thinking: "thinking…",
  budget: "Chat is resting until tomorrow. Try the contact page.",
  busy: "Busy right now. Try again in a minute.",
  sessionLimit: "That's the limit for this session. Press clear to start a new one.",
  ended: "This session has ended. Press clear to start a new one.",
  unavailable: "Chat is unavailable right now. Try the contact page.",
  tooLong: "Questions can be up to 500 characters.",
} as const;

export type ChatSource = { n: number; title: string; url: string };
export type ChatFailure = "budget" | "busy" | "sessionLimit" | "ended" | "unavailable";
export type SessionResult =
  | { kind: "ok"; sessionId: string; questionsLeft: number }
  | { kind: "error"; failure: ChatFailure };
export type AskResult =
  | {
      kind: "answer";
      answer: string;
      sources: ChatSource[];
      outcome: "answered" | "no_match" | "uncited";
      questionsLeft: number;
    }
  | { kind: "error"; failure: ChatFailure };

const ErrorBody = z.object({ error: z.object({ code: z.string() }) });
const SessionBody = z.object({ session_id: z.string(), questions_left: z.number() });
const AnswerBody = z.object({
  answer: z.string(),
  sources: z.array(z.object({ n: z.number(), title: z.string(), url: z.string() })),
  outcome: z.enum(["answered", "no_match", "uncited"]),
  questions_left: z.number(),
});

// The API waits for the full answer (up to ~20 s from the model), so allow a little more.
const TIMEOUT_MS = 30_000;

export function failureFor(code: string | undefined): ChatFailure {
  switch (code) {
    case "budget_exhausted":
      return "budget";
    case "model_busy":
    case "rate_limited":
      return "busy";
    case "session_limit":
      return "sessionLimit";
    case "session_not_found":
      return "ended";
    default:
      return "unavailable";
  }
}

async function post(url: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

async function failureFrom(res: Response | null): Promise<ChatFailure> {
  if (!res) return "unavailable";
  const parsed = ErrorBody.safeParse(await readJson(res));
  return failureFor(parsed.success ? parsed.data.error.code : undefined);
}

export async function createSession(
  apiUrl: string,
  turnstileToken: string,
): Promise<SessionResult> {
  const res = await post(`${apiUrl}/v1/chat/sessions`, { turnstile_token: turnstileToken });
  if (res?.status === 201) {
    const parsed = SessionBody.safeParse(await readJson(res));
    return parsed.success
      ? { kind: "ok", sessionId: parsed.data.session_id, questionsLeft: parsed.data.questions_left }
      : { kind: "error", failure: "unavailable" };
  }
  return { kind: "error", failure: await failureFrom(res) };
}

export async function askQuestion(
  apiUrl: string,
  sessionId: string,
  question: string,
): Promise<AskResult> {
  const res = await post(`${apiUrl}/v1/chat/sessions/${encodeURIComponent(sessionId)}/messages`, {
    question,
  });
  if (res?.status === 200) {
    const parsed = AnswerBody.safeParse(await readJson(res));
    return parsed.success
      ? {
          kind: "answer",
          answer: parsed.data.answer,
          sources: parsed.data.sources,
          outcome: parsed.data.outcome,
          questionsLeft: parsed.data.questions_left,
        }
      : { kind: "error", failure: "unavailable" };
  }
  return { kind: "error", failure: await failureFrom(res) };
}
