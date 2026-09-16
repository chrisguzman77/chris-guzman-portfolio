import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/healthz", () => {
  it("reports ok with the app version", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok", version: "dev" });
  });
});
