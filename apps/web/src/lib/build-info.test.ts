import { describe, expect, it } from "vitest";

import { buildInfo } from "./build-info";

const SHA = "cf6681f0123456789abcdef0123456789abcdef0";
const NOW = Date.parse("2026-10-14T12:00:00Z");
const REPO = "https://github.com/chrisguzman77/chris-guzman-portfolio";

describe("buildInfo", () => {
  it("formats a release build", () => {
    expect(
      buildInfo({ version: SHA, release: "v1.0.0", builtAt: "2026-10-14T10:00:00Z" }, NOW),
    ).toEqual({
      sha: "cf6681f",
      shaUrl: `${REPO}/commit/${SHA}`,
      release: "v1.0.0",
      releaseUrl: `${REPO}/releases/tag/v1.0.0`,
      builtAt: "2026-10-14T10:00:00Z",
      ago: "2h ago",
    });
  });

  it("leaves the release out when no tag was reachable", () => {
    const info = buildInfo({ version: SHA, release: "", builtAt: "2026-10-14T11:55:00Z" }, NOW);
    expect(info).toMatchObject({ release: null, releaseUrl: null, ago: "5m ago" });
  });

  it("is null for local and unstamped builds", () => {
    expect(buildInfo({}, NOW)).toBeNull();
    expect(buildInfo({ version: "dev", builtAt: "2026-10-14T10:00:00Z" }, NOW)).toBeNull();
    expect(buildInfo({ version: SHA }, NOW)).toBeNull();
    expect(buildInfo({ version: SHA, builtAt: "not a date" }, NOW)).toBeNull();
  });
});
