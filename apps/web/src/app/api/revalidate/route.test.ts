import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONTENT_COLLECTIONS } from "@/lib/directus/tags";

import { POST } from "./route";

const { revalidateTag, env } = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  env: { revalidateSecret: "correct-horse-battery-staple" as string | undefined },
}));

vi.mock("next/cache", () => ({ revalidateTag }));
vi.mock("@/lib/env", () => ({
  serverEnv: () => ({
    directusUrl: undefined,
    directusToken: undefined,
    apiInternalUrl: undefined,
    revalidateSecret: env.revalidateSecret,
    siteUrl: "https://christopherguzman.me",
  }),
}));

const SECRET = "correct-horse-battery-staple";

function request(body: string, secret?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (secret !== undefined) headers.set("x-revalidate-secret", secret);
  return new Request("http://localhost:3000/api/revalidate", { method: "POST", headers, body });
}

const json = (value: unknown) => JSON.stringify(value);

let logs: unknown[][];

beforeEach(() => {
  env.revalidateSecret = SECRET;
  logs = [];
  for (const level of ["info", "warn", "error", "log"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  revalidateTag.mockReset();
});

describe("POST /api/revalidate", () => {
  it("rejects a missing secret with 401", async () => {
    const res = await POST(request(json({ collection: "projects" })));
    expect(res.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret of the same length with 401", async () => {
    const wrong = "x".repeat(SECRET.length);
    const res = await POST(request(json({ collection: "projects" }), wrong));
    expect(res.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("rejects a secret of a different length with 401", async () => {
    const res = await POST(request(json({ collection: "projects" }), `${SECRET}-longer`));
    expect(res.status).toBe(401);
  });

  it("rejects every request with 401 when REVALIDATE_SECRET is unset", async () => {
    env.revalidateSecret = undefined;
    const res = await POST(request(json({ collection: "projects" }), SECRET));
    expect(res.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("rejects an empty REVALIDATE_SECRET with 401", async () => {
    env.revalidateSecret = "";
    const res = await POST(request(json({ collection: "projects" }), ""));
    expect(res.status).toBe(401);
  });

  it("rejects invalid JSON with 400", async () => {
    const res = await POST(request("not json", SECRET));
    expect(res.status).toBe(400);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("rejects a body without a string collection with 400", async () => {
    const res = await POST(request(json({ keys: [1] }), SECRET));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown collection with 400", async () => {
    const res = await POST(request(json({ collection: "directus_users" }), SECRET));
    expect(res.status).toBe(400);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it.each(CONTENT_COLLECTIONS)("allows the %s collection", async (collection) => {
    const res = await POST(request(json({ collection }), SECRET));
    expect(res.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledWith(collection, { expire: 0 });
  });

  it("revalidates the collection tag with expire: 0 and ignores other fields", async () => {
    const res = await POST(request(json({ collection: "projects", keys: [3, "4"], x: 1 }), SECRET));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ revalidated: ["projects"] });
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith("projects", { expire: 0 });
  });

  it("accepts the exact body the Directus Flow sends", async () => {
    const res = await POST(request('{"collection":"profile"}', SECRET));
    expect(res.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledWith("profile", { expire: 0 });
  });

  it("logs nothing for unauthorized requests", async () => {
    await POST(request(json({ collection: "projects" })));
    await POST(request(json({ collection: "projects" }), "wrong-secret-value"));

    expect(logs).toEqual([]);
  });

  it("logs the collection but never a secret", async () => {
    await POST(request(json({ collection: "experience" }), SECRET));
    await POST(request(json({ collection: "experience" }), "wrong-secret-value"));

    const text = JSON.stringify(logs);
    expect(text).toContain("experience");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("wrong-secret-value");
  });
});
