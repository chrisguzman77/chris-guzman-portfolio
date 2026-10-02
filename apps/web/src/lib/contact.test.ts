import { afterEach, describe, expect, it, vi } from "vitest";

import { submitContact, validateContact } from "./contact";

const good = { name: "Ada", email: "ada@example.com", message: "Hello there, Chris!" };
const payload = { ...good, turnstile_token: "tok", website: "" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("validateContact", () => {
  it("accepts a valid message", () => {
    expect(validateContact(good)).toEqual({});
  });

  it.each([
    [{ name: "   " }, "name", "Enter your name."],
    [{ name: "x".repeat(101) }, "name", "Name must be at most 100 characters."],
    [{ email: "nope" }, "email", "Enter a valid email address."],
    [{ message: "too short" }, "message", "Message must be at least 10 characters."],
    [{ message: "x".repeat(5001) }, "message", "Message must be at most 5000 characters."],
  ])("rejects %o", (override, field, text) => {
    expect(validateContact({ ...good, ...override })).toEqual({ [field]: text });
  });

  it("measures trimmed values", () => {
    expect(validateContact({ ...good, message: "   123456789   " }).message).toBeDefined();
  });
});

function respond(status: number, body?: unknown) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      body === undefined ? new Response(null, { status }) : Response.json(body, { status }),
    );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("submitContact", () => {
  it("posts trimmed JSON to the API and maps 202 to sent", async () => {
    const fetchMock = respond(202, { status: "received" });
    const result = await submitContact("https://api.example.com", { ...payload, name: " Ada " });
    expect(result).toEqual({ kind: "sent" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/contact");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ ...payload, name: "Ada" });
  });

  it("maps 429 to rate_limited", async () => {
    respond(429, { error: { code: "rate_limited", message: "x" } });
    expect(await submitContact("https://a", payload)).toEqual({ kind: "rate_limited" });
  });

  it("maps turnstile_failed to turnstile", async () => {
    respond(400, { error: { code: "turnstile_failed", message: "x" } });
    expect(await submitContact("https://a", payload)).toEqual({ kind: "turnstile" });
  });

  it("maps invalid_request to the known field errors", async () => {
    respond(400, {
      error: { code: "invalid_request", message: "x", fields: { email: "bad", other: "x" } },
    });
    expect(await submitContact("https://a", payload)).toEqual({
      kind: "invalid",
      fields: { email: "bad" },
    });
  });

  it.each([500, 503])("maps %i to unavailable", async (status) => {
    respond(status, { error: { code: "x", message: "x" } });
    expect(await submitContact("https://a", payload)).toEqual({ kind: "unavailable" });
  });

  it("maps a network error to unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await submitContact("https://a", payload)).toEqual({ kind: "unavailable" });
  });
});
