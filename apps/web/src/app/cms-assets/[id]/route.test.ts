import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isReferencedFile } from "@/lib/directus/queries";

import { GET } from "./route";

vi.mock("@/lib/directus/queries", () => ({ isReferencedFile: vi.fn() }));

const ID = "123e4567-e89b-12d3-a456-426614174000";
const fetchMock = vi.fn();
const referenced = vi.mocked(isReferencedFile);

function call(id: string, query = "") {
  return GET(new Request(`http://localhost/cms-assets/${id}${query}`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("DIRECTUS_URL", "http://directus:8055");
  vi.stubEnv("DIRECTUS_TOKEN", "tok");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
  referenced.mockReset();
});

describe("GET /cms-assets/[id]", () => {
  it("returns 400 for an id that is not a UUID", async () => {
    const res = await call("../../users/me");
    expect(res.status).toBe(400);
    expect(referenced).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a file no published content references", async () => {
    referenced.mockResolvedValue(false);
    const res = await call(ID);
    expect(res.status).toBe(404);
    expect(referenced).toHaveBeenCalledWith(ID);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("streams a referenced file with an immutable cache header and its content type", async () => {
    referenced.mockResolvedValue(true);
    fetchMock.mockResolvedValue(
      new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }),
    );
    const res = await call(ID);
    expect(fetchMock).toHaveBeenCalledWith(`http://directus:8055/assets/${ID}`, {
      headers: { Authorization: "Bearer tok" },
      cache: "no-store",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(res.text()).resolves.toBe("%PDF-1.7");
  });

  it("returns 502 when Directus responds with an error", async () => {
    referenced.mockResolvedValue(true);
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    expect((await call(ID)).status).toBe(502);
  });

  it("returns 502 when the request to Directus throws", async () => {
    referenced.mockResolvedValue(true);
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect((await call(ID)).status).toBe(502);
  });

  it("sandboxes and forces download for non-allow-listed types such as SVG", async () => {
    referenced.mockResolvedValue(true);
    fetchMock.mockResolvedValue(
      new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }),
    );
    const res = await call(ID);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("content-disposition")).toBe("attachment");
  });

  it.each(["image/png", "application/pdf"])("does not sandbox %s", async (type) => {
    referenced.mockResolvedValue(true);
    fetchMock.mockResolvedValue(new Response("x", { headers: { "content-type": type } }));
    const res = await call(ID);
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("content-disposition")).toBeNull();
  });

  describe("resized variants", () => {
    const AUTH = { headers: { Authorization: "Bearer tok" }, cache: "no-store" };
    const TRANSFORM = `http://directus:8055/assets/${ID}?width=1200&fit=inside&withoutEnlargement=true&format=webp&quality=80`;

    it("forwards ?w=1200 as the exact Directus transform and serves the WebP", async () => {
      referenced.mockResolvedValue(true);
      fetchMock.mockResolvedValue(
        new Response("webp", { headers: { "content-type": "image/webp" } }),
      );
      const res = await call(ID, "?w=1200");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(TRANSFORM, AUTH);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
      expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      await expect(res.text()).resolves.toBe("webp");
    });

    it.each(["?w=800", "?w=", "?w=1200&w=1200", "?w=1200&h=10", "?width=1200", "?download"])(
      "returns 400 for %s without touching Directus",
      async (query) => {
        referenced.mockResolvedValue(true);
        const res = await call(ID, query);
        expect(res.status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it("still returns 400 for a bad id before looking at the query", async () => {
      const res = await call("../../users/me", "?w=1200");
      expect(res.status).toBe(400);
      expect(referenced).not.toHaveBeenCalled();
    });

    it("returns 404 for an unreferenced file even with an allowed width", async () => {
      referenced.mockResolvedValue(false);
      expect((await call(ID, "?w=1200")).status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("falls back to the original when Directus cannot transform the file", async () => {
      referenced.mockResolvedValue(true);
      fetchMock
        .mockResolvedValueOnce(new Response("cannot transform", { status: 400 }))
        .mockResolvedValueOnce(
          new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }),
        );
      const res = await call(ID, "?w=1200");
      expect(fetchMock).toHaveBeenNthCalledWith(1, TRANSFORM, AUTH);
      expect(fetchMock).toHaveBeenNthCalledWith(2, `http://directus:8055/assets/${ID}`, AUTH);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/svg+xml");
      expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
      await expect(res.text()).resolves.toBe("<svg/>");
    });

    it("returns 502 when both the transform and the original fail", async () => {
      referenced.mockResolvedValue(true);
      fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
      expect((await call(ID, "?w=1200")).status).toBe(502);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("fetches only the original when no width is asked for", async () => {
      referenced.mockResolvedValue(true);
      fetchMock.mockResolvedValue(
        new Response("png", { headers: { "content-type": "image/png" } }),
      );
      const res = await call(ID);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(`http://directus:8055/assets/${ID}`, AUTH);
      expect(res.headers.get("content-type")).toBe("image/png");
    });
  });
});
