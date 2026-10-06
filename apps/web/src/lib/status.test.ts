import { connection } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as StatusModule from "./status";

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));

const fetchMock = vi.fn();
let mod: typeof StatusModule;

// 2026-09-04 .. 2026-10-03, oldest first, last is today.
const DATES = Array.from({ length: 30 }, (_, i) =>
  new Date(Date.UTC(2026, 8, 4 + i)).toISOString().slice(0, 10),
);

const OK_BODY = {
  status: "operational",
  uptime_30d: 0.9998,
  daily: DATES.map((date) => ({ date, uptime: 1 })),
  p95_ms: 84,
  requests_today: 1204,
  last_backup_at: "2026-10-03T07:31:12Z",
};

beforeEach(async () => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_INTERNAL_URL", "http://api:8000");
  // Fresh module per test: the last result is memoised at module level.
  vi.resetModules();
  mod = await import("./status");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
  vi.mocked(connection).mockClear();
});

describe("getStatus", () => {
  it("fetches /v1/status at request time without the Next data cache and returns the parsed body", async () => {
    fetchMock.mockResolvedValue(Response.json(OK_BODY));
    await expect(mod.getStatus()).resolves.toEqual(OK_BODY);
    expect(connection).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api:8000/v1/status",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
  });

  it("accepts all-null metrics (Prometheus down)", async () => {
    const body = {
      status: "degraded",
      uptime_30d: null,
      daily: DATES.map((date) => ({ date, uptime: null })),
      p95_ms: null,
      requests_today: null,
      last_backup_at: null,
    };
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(mod.getStatus()).resolves.toEqual(body);
  });

  it("accepts a +00:00 offset on last_backup_at", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ ...OK_BODY, last_backup_at: "2026-10-03T07:31:12+00:00" }),
    );
    expect((await mod.getStatus())?.last_backup_at).toBe("2026-10-03T07:31:12+00:00");
  });

  it("returns null without calling fetch when API_INTERNAL_URL is unset", async () => {
    vi.stubEnv("API_INTERNAL_URL", "");
    await expect(mod.getStatus()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-200 response", () => Response.json(OK_BODY, { status: 503 })],
    ["invalid JSON", () => new Response("not json", { status: 200 })],
    ["an unknown status value", () => Response.json({ ...OK_BODY, status: "ok" })],
    ["29 daily entries", () => Response.json({ ...OK_BODY, daily: OK_BODY.daily.slice(1) })],
    ["a fractional p95", () => Response.json({ ...OK_BODY, p95_ms: 84.5 })],
    ["a non-ISO backup time", () => Response.json({ ...OK_BODY, last_backup_at: "yesterday" })],
  ])("returns null for %s", async (_name, make) => {
    fetchMock.mockResolvedValue(make());
    await expect(mod.getStatus()).resolves.toBeNull();
  });

  it("returns null when the request fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(mod.getStatus()).resolves.toBeNull();
  });

  it("returns null when the API exceeds the 3.5 second timeout", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const started = Date.now();
    await expect(mod.getStatus()).resolves.toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(3400);
  });

  it("reuses the last result for 60 seconds, then fetches again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
    fetchMock.mockResolvedValueOnce(Response.json(OK_BODY));
    await mod.getStatus();

    vi.setSystemTime(new Date("2026-10-03T12:00:59Z"));
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(mod.getStatus()).resolves.toEqual(OK_BODY);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-10-03T12:01:01Z"));
    await expect(mod.getStatus()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("memoises a failed result too", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await mod.getStatus();

    vi.setSystemTime(new Date("2026-10-03T12:00:30Z"));
    fetchMock.mockResolvedValueOnce(Response.json(OK_BODY));
    await expect(mod.getStatus()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("formatPercent", () => {
  it.each([
    [0.9998, "99.98%"],
    [0.9997, "99.97%"],
    [1, "100.00%"],
    [0.995, "99.50%"],
    [0, "0.00%"],
  ])("%d -> %s", (ratio, text) => {
    expect(mod.formatPercent(ratio)).toBe(text);
  });
});

describe("dayLabel", () => {
  it("formats the date in UTC with the day's uptime", () => {
    expect(mod.dayLabel({ date: "2026-10-03", uptime: 0.9997 })).toBe("Oct 3: 99.97%");
    expect(mod.dayLabel({ date: "2026-09-04", uptime: 1 })).toBe("Sep 4: 100.00%");
  });

  it("says no data for a null day", () => {
    expect(mod.dayLabel({ date: "2026-10-03", uptime: null })).toBe("Oct 3: no data");
  });
});

describe("formatAgo", () => {
  const now = Date.parse("2026-10-03T12:00:00Z");
  it.each([
    ["2026-10-03T11:59:30Z", "1m ago"],
    ["2026-10-03T11:48:00Z", "12m ago"],
    ["2026-10-03T11:00:01Z", "59m ago"],
    ["2026-10-03T11:00:00Z", "1h ago"],
    ["2026-10-03T09:00:00Z", "3h ago"],
    ["2026-10-02T12:00:01Z", "23h ago"],
    ["2026-10-02T12:00:00Z", "1d ago"],
    ["2026-10-01T10:00:00Z", "2d ago"],
    ["2026-10-03T12:05:00Z", "1m ago"],
  ])("%s -> %s", (iso, text) => {
    expect(mod.formatAgo(iso, now)).toBe(text);
  });
});

describe("uptimeSummary", () => {
  it("summarises the 30 days for screen readers", () => {
    const days = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, "0")}`,
      uptime: i === 4 ? 0.987 : 1,
    }));
    expect(mod.uptimeSummary(days)).toBe("30-day uptime, 29 days at 100%, 1 day at 98.7%");
  });

  it("counts days without data", () => {
    const days = [
      ...Array.from({ length: 28 }, () => ({ date: "2026-09-01", uptime: null })),
      { date: "2026-09-29", uptime: 1 },
      { date: "2026-09-30", uptime: 0.999 },
    ];
    expect(mod.uptimeSummary(days)).toBe(
      "30-day uptime, 1 day at 100%, 1 day at 99.9%, 28 days with no data",
    );
  });
});
