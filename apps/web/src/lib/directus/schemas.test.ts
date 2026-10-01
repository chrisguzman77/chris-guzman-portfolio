import { describe, expect, it } from "vitest";

import {
  CertificationSchema,
  EducationSchema,
  ExperienceSchema,
  InvolvementSchema,
  PostSchema,
  ProfileSchema,
  ProjectSchema,
  ResumeSchema,
} from "./schemas";

const experience = {
  id: 1,
  company: "Jubilee Farms",
  role: "Full Stack Engineer, Contract",
  location: "Remote",
  start_date: "2026-03-01",
  end_date: null,
  highlights: ["Cut order-grid render time by 79%."],
  tech: ["asp.net", "jquery"],
  show_on_home: true,
};

const project = {
  id: 1,
  slug: "offres",
  title: "OFFRes / OFFPay",
  summary: "Offline payment device.",
  body: "## Overview",
  type: "competition",
  award: "Capital One Best Financial Hack",
  tech: ["python", "fastapi"],
  repo_url: null,
  live_url: null,
  cover: null,
  date: "2025-10-01",
  featured: true,
};

describe("content schemas", () => {
  it("parses a valid profile and rejects a non-URL GitHub link", () => {
    const profile = {
      name: "Christopher Guzman",
      intro: "Hi.",
      email: "chguzman@augusta.edu",
      location: "Augusta, GA",
      github_url: "https://github.com/chrisguzman77",
      linkedin_url: "https://www.linkedin.com/in/christopher-emmanuel-guzman/",
      seo_description: "Portfolio.",
    };
    expect(ProfileSchema.parse(profile)).toEqual(profile);
    expect(ProfileSchema.safeParse({ ...profile, github_url: "not a url" }).success).toBe(false);
  });

  it("parses experience and turns null JSON lists into []", () => {
    expect(ExperienceSchema.parse(experience)).toEqual(experience);
    const parsed = ExperienceSchema.parse({ ...experience, highlights: null, tech: null });
    expect(parsed.highlights).toEqual([]);
    expect(parsed.tech).toEqual([]);
  });

  it("rejects experience missing a company", () => {
    expect(ExperienceSchema.safeParse({ ...experience, company: undefined }).success).toBe(false);
  });

  it("parses education degrees and rejects an unknown degree kind", () => {
    const education = {
      id: 1,
      school: "School of Computer and Cyber Sciences, Augusta University",
      location: "Augusta, GA",
      end_date: "2027-05-01",
      degrees: [
        { kind: "degree", name: "B.S. in Computer Science" },
        { kind: "minor", name: "Mathematics" },
      ],
      coursework: null,
    };
    expect(EducationSchema.parse(education).coursework).toEqual([]);
    expect(
      EducationSchema.safeParse({ ...education, degrees: [{ kind: "major", name: "X" }] }).success,
    ).toBe(false);
  });

  it("parses involvement and certifications with nullable fields", () => {
    expect(
      InvolvementSchema.parse({
        id: 2,
        organization: "The Delta Chi Fraternity",
        role: "Officer of Philanthropy",
        year: "2024",
        summary: null,
      }).summary,
    ).toBeNull();
    expect(
      CertificationSchema.parse({ id: 1, name: "Sec+", issuer: "CompTIA", date: null, url: null })
        .name,
    ).toBe("Sec+");
  });

  it("parses a project and rejects an unknown type", () => {
    expect(ProjectSchema.parse(project)).toEqual(project);
    expect(ProjectSchema.parse({ ...project, tech: null }).tech).toEqual([]);
    expect(ProjectSchema.safeParse({ ...project, type: "work" }).success).toBe(false);
  });

  it("parses a post and requires a body", () => {
    const post = {
      id: 1,
      slug: "self-hosting",
      title: "How I self-host this site",
      published_at: "2026-10-14",
      excerpt: "A tour.",
      body: "Hello",
      tags: null,
      cover: null,
    };
    expect(PostSchema.parse(post).tags).toEqual([]);
    expect(PostSchema.safeParse({ ...post, body: null }).success).toBe(false);
  });

  it("keeps only http(s) project and certification links, nulling anything else", () => {
    const parsed = ProjectSchema.parse({
      ...project,
      repo_url: "javascript:alert(1)",
      live_url: "https://offres.example.com",
    });
    expect(parsed.repo_url).toBeNull();
    expect(parsed.live_url).toBe("https://offres.example.com");
    expect(ProjectSchema.parse({ ...project, live_url: "data:text/html,hi" }).live_url).toBeNull();
    expect(ProjectSchema.parse({ ...project, repo_url: "http://example.com/r" }).repo_url).toBe(
      "http://example.com/r",
    );

    const cert = { id: 1, name: "Sec+", issuer: "CompTIA", date: null };
    expect(CertificationSchema.parse({ ...cert, url: "javascript:alert(1)" }).url).toBeNull();
    expect(CertificationSchema.parse({ ...cert, url: "not a url" }).url).toBeNull();
    expect(CertificationSchema.parse({ ...cert, url: "https://comptia.org/c" }).url).toBe(
      "https://comptia.org/c",
    );
  });

  it("parses an empty resume singleton", () => {
    expect(ResumeSchema.parse({ file: null, version_label: null, updated_at: null })).toEqual({
      file: null,
      version_label: null,
      updated_at: null,
    });
  });
});
