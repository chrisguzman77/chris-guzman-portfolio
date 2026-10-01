import { describe, expect, it, vi } from "vitest";

import type { Profile } from "@/lib/directus/schemas";

import { absoluteUrl, personJsonLd, serializeJsonLd } from "./seo";

vi.mock("@/lib/env", () => ({
  serverEnv: () => ({
    directusUrl: undefined,
    directusToken: undefined,
    apiInternalUrl: undefined,
    revalidateSecret: undefined,
    siteUrl: "https://example.test",
  }),
}));

const profile: Profile = {
  name: "Chris G",
  intro: "Intro.",
  email: "chris@example.com",
  location: "Augusta, GA",
  github_url: "https://github.com/octochris",
  linkedin_url: "https://www.linkedin.com/in/chris-example/",
  seo_description: "SEO.",
};

describe("absoluteUrl", () => {
  it("joins a path onto SITE_URL", () => {
    expect(absoluteUrl("/projects/lakehouse")).toBe("https://example.test/projects/lakehouse");
    expect(absoluteUrl("/")).toBe("https://example.test/");
  });
});

describe("personJsonLd", () => {
  it("describes the profile as a schema.org Person without the email", () => {
    expect(personJsonLd(profile)).toEqual({
      "@context": "https://schema.org",
      "@type": "Person",
      name: "Chris G",
      url: "https://example.test/",
      sameAs: ["https://github.com/octochris", "https://www.linkedin.com/in/chris-example/"],
      jobTitle: "Software Engineer",
      alumniOf: { "@type": "CollegeOrUniversity", name: "Augusta University" },
    });
    expect(JSON.stringify(personJsonLd(profile))).not.toContain("chris@example.com");
  });

  it("falls back to siteConfig when the profile is unavailable", () => {
    expect(personJsonLd(null)).toMatchObject({
      name: "Christopher Guzman",
      sameAs: [
        "https://github.com/chrisguzman77",
        "https://www.linkedin.com/in/christopher-emmanuel-guzman/",
      ],
    });
  });
});

describe("serializeJsonLd", () => {
  it("escapes < so content cannot close the script tag", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("<");
    expect(JSON.parse(out)).toEqual({ name: "</script><script>alert(1)</script>" });
  });
});
