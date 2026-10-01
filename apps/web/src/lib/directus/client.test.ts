import { connection } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DirectusUnavailableError, directusGet } from "./client";

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("DIRECTUS_URL", "http://directus:8055");
  vi.stubEnv("DIRECTUS_TOKEN", "tok");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
  vi.mocked(connection).mockClear();
});

describe("directusGet", () => {
  it("calls connection() and GETs /items/<path> with token, cache, tags, and revalidate", async () => {
    fetchMock.mockResolvedValue(Response.json({ data: [{ id: 1 }] }));
    await expect(directusGet("experience?limit=-1", ["experience"])).resolves.toEqual([{ id: 1 }]);
    expect(connection).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://directus:8055/items/experience?limit=-1", {
      headers: { Authorization: "Bearer tok" },
      cache: "force-cache",
      next: { tags: ["experience"], revalidate: 86400 },
    });
  });

  it("throws DirectusUnavailableError without calling fetch when DIRECTUS_URL is unset", async () => {
    vi.stubEnv("DIRECTUS_URL", "");
    await expect(directusGet("profile", ["profile"])).rejects.toBeInstanceOf(
      DirectusUnavailableError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws DirectusUnavailableError when DIRECTUS_TOKEN is unset", async () => {
    vi.stubEnv("DIRECTUS_TOKEN", "");
    await expect(directusGet("profile", ["profile"])).rejects.toBeInstanceOf(
      DirectusUnavailableError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws DirectusUnavailableError when the request fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(directusGet("profile", ["profile"])).rejects.toBeInstanceOf(
      DirectusUnavailableError,
    );
  });

  it("throws DirectusUnavailableError on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(new Response("forbidden", { status: 403 }));
    await expect(directusGet("profile", ["profile"])).rejects.toThrow(/403/);
  });

  it("returns null when the body has no data", async () => {
    fetchMock.mockResolvedValue(Response.json({}));
    await expect(directusGet("resume", ["resume"])).resolves.toBeNull();
  });

  it("throws DirectusUnavailableError when the 200 body is not valid JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>oops", { status: 200 }));
    const err = await directusGet("profile", ["profile"]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DirectusUnavailableError);
    expect((err as Error).cause).toBeInstanceOf(SyntaxError);
  });
});
