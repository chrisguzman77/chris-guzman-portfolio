import { describe, expect, it } from "vitest";

import { ogImage } from "./og";

describe("ogImage", () => {
  it("renders a 1200x630 PNG without any network access", async () => {
    const res = ogImage({ title: "Christopher Guzman", prompt: "$ whoami" });

    expect(res.headers.get("content-type")).toBe("image/png");
    const png = Buffer.from(await res.arrayBuffer());
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1200); // IHDR width
    expect(png.readUInt32BE(20)).toBe(630); // IHDR height
  }, 30_000);

  it("handles a long title", async () => {
    const res = ogImage({
      title: "Cutting anomaly-detection false positives from 267 to zero with log-space thresholds",
      prompt: "$ cat posts/anomaly-detection.md",
    });
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  }, 30_000);
});
