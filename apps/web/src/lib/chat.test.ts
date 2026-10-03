import { afterEach, describe, expect, it, vi } from "vitest";

import { CHAT_MESSAGES, askQuestion, createSession, failureFor } from "./chat";

const API = "https://api.example.com";

function respond(status: number, body?: unknown) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      body === undefined ? new Response(null, { status }) : Response.json(body, { status }),
    );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("failureFor", () => {
  it.each([
    ["budget_exhausted", "budget"],
    ["model_busy", "busy"],
    ["rate_limited", "busy"],
    ["session_limit", "sessionLimit"],
    ["session_not_found", "ended"],
    ["chat_unavailable", "unavailable"],
    ["chat_disabled", "unavailable"],
    ["turnstile_failed", "unavailable"],
    [undefined, "unavailable"],
  ])("maps %s to %s", (code, failure) => {
    expect(failureFor(code)).toBe(failure);
  });
});

describe("createSession", () => {
  it("posts the token and returns the session", async () => {
    const fetchMock = respond(201, { session_id: "s-1", questions_left: 10 });
    await expect(createSession(API, "tok")).resolves.toEqual({
      kind: "ok",
      sessionId: "s-1",
      questionsLeft: 10,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/v1/chat/sessions`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ turnstile_token: "tok" });
  });

  it("maps API errors", async () => {
    respond(503, { error: { code: "chat_disabled", message: "x" } });
    await expect(createSession(API, "tok")).resolves.toEqual({
      kind: "error",
      failure: "unavailable",
    });
  });

  it("treats network failures as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(createSession(API, "tok")).resolves.toEqual({
      kind: "error",
      failure: "unavailable",
    });
  });
});

describe("askQuestion", () => {
  const answer = {
    answer: "Yes [1].",
    sources: [{ n: 1, title: "ACM", url: "/projects/acm" }],
    outcome: "answered",
    questions_left: 9,
  };

  it("posts the question to the session and returns the answer", async () => {
    const fetchMock = respond(200, answer);
    await expect(askQuestion(API, "s-1", "FastAPI?")).resolves.toEqual({
      kind: "answer",
      answer: "Yes [1].",
      sources: [{ n: 1, title: "ACM", url: "/projects/acm" }],
      outcome: "answered",
      questionsLeft: 9,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/v1/chat/sessions/s-1/messages`);
    expect(JSON.parse(init.body as string)).toEqual({ question: "FastAPI?" });
  });

  it.each([
    [503, "budget_exhausted", "budget"],
    [503, "model_busy", "busy"],
    [429, "rate_limited", "busy"],
    [409, "session_limit", "sessionLimit"],
    [404, "session_not_found", "ended"],
  ])("maps %i %s", async (status, code, failure) => {
    respond(status, { error: { code, message: "x" } });
    await expect(askQuestion(API, "s-1", "q")).resolves.toEqual({ kind: "error", failure });
  });

  it("treats a malformed 200 as unavailable", async () => {
    respond(200, { nope: true });
    await expect(askQuestion(API, "s-1", "q")).resolves.toEqual({
      kind: "error",
      failure: "unavailable",
    });
  });
});

it("keeps the exact terminal copy", () => {
  expect(CHAT_MESSAGES).toEqual({
    welcome:
      "Ask anything about Chris's experience, projects, or skills. Answers come only from this site and may be wrong. Conversations are stored for 30 days.",
    thinking: "thinking…",
    budget: "Chat is resting until tomorrow. Try the contact page.",
    busy: "Busy right now. Try again in a minute.",
    sessionLimit: "That's the limit for this session. Press clear to start a new one.",
    ended: "This session has ended. Press clear to start a new one.",
    unavailable: "Chat is unavailable right now. Try the contact page.",
    tooLong: "Questions can be up to 500 characters.",
  });
});
