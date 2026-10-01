// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Profile } from "@/lib/directus/schemas";

import HomePage from "./page";

const profile: Profile = {
  name: "Christopher Guzman",
  intro: "Intro.",
  email: "chguzman@augusta.edu",
  location: "Augusta, GA",
  github_url: "https://github.com/chrisguzman77",
  linkedin_url: "https://www.linkedin.com/in/christopher-emmanuel-guzman/",
  seo_description: "SEO.",
};

vi.mock("@/lib/directus/queries", () => ({
  getProfile: vi.fn(async () => profile),
  getExperience: vi.fn(async () => []),
  getEducation: vi.fn(async () => []),
  getInvolvement: vi.fn(async () => []),
  getCertifications: vi.fn(async () => []),
  getProjects: vi.fn(async () => []),
  getProject: vi.fn(async () => null),
  getPosts: vi.fn(async () => []),
  getPost: vi.fn(async () => null),
  getResume: vi.fn(async () => null),
  isReferencedFile: vi.fn(async () => false),
}));
vi.mock("@/components/content/live-status", () => ({
  LiveStatus: () => <p>status</p>,
}));

afterEach(cleanup);

describe("homepage JSON-LD", () => {
  it("embeds a schema.org Person built from the profile", async () => {
    const { container } = render(await HomePage());

    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    const data = JSON.parse(script!.innerHTML);
    expect(data["@type"]).toBe("Person");
    expect(data.name).toBe("Christopher Guzman");
    expect(data.sameAs).toContain("https://github.com/chrisguzman77");
    expect(script!.innerHTML).not.toContain("chguzman@augusta.edu");
  });
});
