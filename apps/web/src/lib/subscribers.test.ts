import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listSubscribers, removeSubscriber } from "./subscribers";

const ID = "0b6f1c1e-0000-4000-8000-000000000001";
const body = {
  subscribers: [
    {
      id: ID,
      email: "ada@example.com",
      status: "confirmed",
      created_at: "2026-10-01T00:00:00Z",
      confirmed_at: "2026-10-02T00:00:00Z",
    },
  ],
  totals: { confirmed: 1, pending: 0 },
};
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_INTERNAL_URL", "http://api:8000");
  vi.stubEnv("INTERNAL_API_SECRET", "s");
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("listSubscribers", () => {
  it("GETs the internal endpoint with the secret and returns the parsed body", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    await expect(listSubscribers()).resolves.toEqual(body);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api:8000/internal/newsletter/subscribers");
    expect(init.headers).toEqual({ "X-Internal-Secret": "s" });
    expect(init.cache).toBe("no-store");
  });

  it("returns null when an env var is missing, without calling fetch", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", "");
    expect(await listSubscribers()).toBeNull();
    vi.stubEnv("INTERNAL_API_SECRET", "s");
    vi.stubEnv("API_INTERNAL_URL", "");
    expect(await listSubscribers()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null on non-200, a bad body, or a network error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    expect(await listSubscribers()).toBeNull();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ subscribers: "x" }), { status: 200 }),
    );
    expect(await listSubscribers()).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await listSubscribers()).toBeNull();
  });
});

describe("removeSubscriber", () => {
  it("sends DELETE and is true on 204, false on 500", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await removeSubscriber(ID)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://api:8000/internal/newsletter/subscribers/${ID}`);
    expect(init.method).toBe("DELETE");
    expect(init.headers).toEqual({ "X-Internal-Secret": "s" });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    expect(await removeSubscriber(ID)).toBe(false);
  });

  it("rejects a non-uuid id without calling fetch", async () => {
    expect(await removeSubscriber("../x")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
