import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isReferencedFile } from "@/lib/directus/queries";

import { GET } from "./route";

vi.mock("@/lib/directus/queries", () => ({ isReferencedFile: vi.fn() }));

const ID = "123e4567-e89b-12d3-a456-426614174000";
const fetchMock = vi.fn();
const referenced = vi.mocked(isReferencedFile);

function call(id: string) {
  return GET(new Request(`http://localhost/cms-assets/${id}`), {
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
});
