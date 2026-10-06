import { describe, expect, it, vi } from "vitest";

import { metadata as blog } from "./blog/page";
import { metadata as contact } from "./contact/page";
import { metadata as education } from "./education/page";
import { metadata as experience } from "./experience/page";
import { metadata as projects } from "./projects/page";
import { metadata as resume } from "./resume/page";

vi.mock("@/lib/directus/queries", () => ({}));

describe("static page metadata", () => {
  it.each([
    ["blog", blog],
    ["contact", contact],
    ["education", education],
    ["experience", experience],
    ["projects", projects],
    ["resume", resume],
  ])("%s has a description", (_name, metadata) => {
    expect(typeof metadata.description).toBe("string");
    expect((metadata.description ?? "").length).toBeGreaterThan(20);
  });
});
