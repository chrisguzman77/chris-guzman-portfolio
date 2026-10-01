import type { Profile } from "@/lib/directus/schemas";
import { serverEnv } from "@/lib/env";
import { siteConfig } from "@/lib/site";

export function absoluteUrl(path: string): string {
  return new URL(path, serverEnv().siteUrl).toString();
}

// schema.org Person for the homepage. The email is deliberately left out.
export function personJsonLd(profile: Profile | null): object {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: profile?.name ?? siteConfig.name,
    url: absoluteUrl("/"),
    sameAs: [
      profile?.github_url ?? siteConfig.links.github,
      profile?.linkedin_url ?? siteConfig.links.linkedin,
    ],
    jobTitle: "Software Engineer",
    alumniOf: { "@type": "CollegeOrUniversity", name: "Augusta University" },
  };
}

// JSON for a <script type="application/ld+json">: "<" is escaped so CMS text can
// never close the script element (Next.js JSON-LD guide).
export function serializeJsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
