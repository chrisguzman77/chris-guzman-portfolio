import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const text = readFileSync(join(__dirname, "../public/.well-known/security.txt"), "utf8");

describe("security.txt", () => {
  it("has the required fields", () => {
    expect(text).toMatch(/^Contact: mailto:\S+@\S+$/m);
    expect(text).toMatch(
      /^Canonical: https:\/\/christopherguzman\.me\/\.well-known\/security\.txt$/m,
    );
  });

  it("does not expire within 30 days (bump Expires a year ahead when this fails)", () => {
    const expires = Date.parse(/^Expires: (.+)$/m.exec(text)?.[1] ?? "");
    expect(expires - Date.now()).toBeGreaterThan(30 * 86_400_000);
  });
});
