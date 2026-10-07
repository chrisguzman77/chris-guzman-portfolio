import { connection } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Module from "./github-activity";

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));

const fetchMock = vi.fn();
let getGithubActivity: typeof Module.getGithubActivity;

const body = {
  total: 3,
  weeks: [{ days: [{ date: "2026-09-14", count: 3, level: 4 }] }],
  fetched_at: "2026-10-02T12:00:00Z",
};

beforeEach(async () => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_INTERNAL_URL", "http://api:8000");
  vi.resetModules(); // the memo lives at module level
  ({ getGithubActivity } = await import("./github-activity"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe("getGithubActivity", () => {
  it("fetches the API over the internal network with a short timeout", async () => {
    fetchMock.mockResolvedValue(Response.json(body));
    expect(await getGithubActivity()).toEqual(body);
    expect(connection).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api:8000/v1/github/activity",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
  });

  it.each([
    ["a 503", () => Response.json({ error: { code: "activity_unavailable" } }, { status: 503 })],
    ["a wrong shape", () => Response.json({ total: "many" })],
  ])("returns null for %s", async (_label, make) => {
    fetchMock.mockResolvedValue(make());
    expect(await getGithubActivity()).toBeNull();
  });

  it("returns null when the request fails", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    expect(await getGithubActivity()).toBeNull();
  });

  it("returns null without calling anything when API_INTERNAL_URL is unset", async () => {
    vi.stubEnv("API_INTERNAL_URL", "");
    expect(await getGithubActivity()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reuses a success for 5 minutes and a failure for 1 minute", async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValueOnce(new Error("down")).mockResolvedValue(Response.json(body));
    expect(await getGithubActivity()).toBeNull();
    vi.advanceTimersByTime(59_000);
    expect(await getGithubActivity()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    expect(await getGithubActivity()).toEqual(body);
    vi.advanceTimersByTime(299_000);
    await getGithubActivity();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(2_000);
    fetchMock.mockResolvedValue(Response.json(body));
    await getGithubActivity();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("shares one in-flight request between concurrent callers", async () => {
    let resolve!: (res: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    const calls = [getGithubActivity(), getGithubActivity(), getGithubActivity()];
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolve(Response.json(body));
    expect(await Promise.all(calls)).toEqual([body, body, body]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent callers at memo expiry", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => Response.json(body));
    await getGithubActivity();
    vi.advanceTimersByTime(301_000);
    await Promise.all([getGithubActivity(), getGithubActivity()]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("drops days with impossible dates", async () => {
    const bad = {
      ...body,
      weeks: [
        {
          days: [
            { date: "2026-02-30", count: 1, level: 1 },
            { date: "2026-09-14", count: 3, level: 4 },
          ],
        },
      ],
    };
    fetchMock.mockResolvedValue(Response.json(bad));
    expect((await getGithubActivity())?.weeks[0].days).toEqual([
      { date: "2026-09-14", count: 3, level: 4 },
    ]);
  });
});
