import { describe, expect, it } from "vitest";

import { ASSET_VERSION, cmsAssetUrl, fileVersion } from "./cms-assets";

const ID = "123e4567-e89b-12d3-a456-426614174000";

describe("fileVersion", () => {
  it("is the upload time in epoch milliseconds", () => {
    expect(fileVersion("2026-10-14T20:23:21.523Z")).toBe("1792009401523");
  });

  it.each([null, undefined, "", "not a date"])("is null for %o", (value) => {
    expect(fileVersion(value)).toBeNull();
  });

  it("always matches what /cms-assets accepts as ?v=", () => {
    expect(fileVersion("2026-10-14T20:23:21.523Z")).toMatch(ASSET_VERSION);
    expect(fileVersion("2286-11-20T17:46:39.999Z")).toMatch(ASSET_VERSION);
  });
});

describe("cmsAssetUrl", () => {
  it("adds ?v=<version>", () => {
    expect(cmsAssetUrl(ID, "1792009401523")).toBe(`/cms-assets/${ID}?v=1792009401523`);
  });

  it("puts the width first, then the version", () => {
    expect(cmsAssetUrl(ID, "1792009401523", "1200")).toBe(
      `/cms-assets/${ID}?w=1200&v=1792009401523`,
    );
  });

  it("falls back to the unversioned URL when the version is unknown", () => {
    expect(cmsAssetUrl(ID, null)).toBe(`/cms-assets/${ID}`);
    expect(cmsAssetUrl(ID, undefined, "1200")).toBe(`/cms-assets/${ID}?w=1200`);
  });
});
