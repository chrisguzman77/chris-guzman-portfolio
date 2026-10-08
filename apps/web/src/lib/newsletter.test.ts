import { afterEach, describe, expect, it, vi } from "vitest";

import { isValidEmail, submitLinkToken, subscribe } from "./newsletter";

const API = "https://api.example.com";

function reply(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

afterEach(() => vi.unstubAllGlobals());

describe("isValidEmail", () => {
  it("accepts a trimmed address and rejects junk", () => {
    expect(isValidEmail(" ada@example.com ")).toBe(true);
    expect(isValidEmail("ada@example")).toBe(false);
    expect(isValidEmail(`${"a".repeat(250)}@example.com`)).toBe(false);
  });
});

describe("subscribe", () => {
  const payload = { email: " ada@example.com ", turnstile_token: "tok", website: "" };

  it("posts trimmed JSON and maps 202 to ok", async () => {
    const fetchMock = reply(202, { status: "check_inbox" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await subscribe(API, payload)).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API}/v1/newsletter/subscribe`);
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({
      email: "ada@example.com",
      turnstile_token: "tok",
      website: "",
    });
  });

  it.each([
    [429, {}, "rate_limited"],
    [400, { error: { code: "turnstile_failed", message: "x" } }, "turnstile"],
    [400, { error: { code: "invalid_request", message: "x" } }, "invalid"],
    [503, { error: { code: "newsletter_unavailable", message: "x" } }, "unavailable"],
  ] as const)("maps %s %j to %s", async (status, body, kind) => {
    vi.stubGlobal("fetch", reply(status, body));
    expect(await subscribe(API, payload)).toBe(kind);
  });

  it("maps a network error to unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await subscribe(API, payload)).toBe("unavailable");
  });
});

describe("submitLinkToken", () => {
  it("posts the token to the action", async () => {
    const fetchMock = reply(200, { status: "confirmed" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await submitLinkToken(API, "confirm", "t1")).toBe("ok");
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/v1/newsletter/confirm`);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: "t1" });
  });

  it("maps invalid_token, other errors and network failures", async () => {
    vi.stubGlobal("fetch", reply(400, { error: { code: "invalid_token", message: "x" } }));
    expect(await submitLinkToken(API, "unsubscribe", "t")).toBe("invalid");
    vi.stubGlobal("fetch", reply(500));
    expect(await submitLinkToken(API, "unsubscribe", "t")).toBe("unavailable");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await submitLinkToken(API, "confirm", "t")).toBe("unavailable");
  });
});
