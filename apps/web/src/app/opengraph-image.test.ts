import { describe, expect, it } from "vitest";

import Image, { alt, contentType, size } from "./opengraph-image";

describe("site Open Graph image", () => {
  it("declares its metadata and renders a PNG", async () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(alt).toBe("Christopher Guzman, software engineer");

    const res = Image();
    expect(res.headers.get("content-type")).toBe("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  }, 30_000);
});
