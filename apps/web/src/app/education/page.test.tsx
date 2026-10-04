// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCertifications, getEducation, getInvolvement } from "@/lib/directus/queries";
import type { Certification, Education, Involvement } from "@/lib/directus/schemas";

import EducationPage, { metadata } from "./page";

vi.mock("@/lib/directus/queries", () => ({
  getEducation: vi.fn(),
  getInvolvement: vi.fn(),
  getCertifications: vi.fn(),
}));

const school: Education = {
  id: 1,
  school: "School of Computer and Cyber Sciences, Augusta University",
  location: "Augusta, GA",
  end_date: "2027-05-01",
  degrees: [
    { kind: "degree", name: "B.S. in Computer Science" },
    { kind: "degree", name: "B.S. in Cyber Operations" },
    { kind: "minor", name: "Mathematics" },
  ],
  coursework: [],
};

const involvement: Involvement[] = [
  {
    id: 1,
    organization: "ACM@AU",
    role: "Lead Developer",
    year: "2026",
    summary: "Built and run the chapter's production platform.",
  },
  {
    id: 2,
    organization: "The Delta Chi Fraternity",
    role: "Officer of Philanthropy",
    year: "2024",
    summary: null,
  },
];

const certification: Certification = {
  id: 1,
  name: "Security+",
  issuer: "CompTIA",
  date: "2026-03-01",
  url: "https://example.com/verify/123",
};

function numberedHeadings(): string[] {
  return screen
    .queryAllByRole("heading", { level: 2 })
    .map((h) => (h.textContent ?? "").replace(/\s+/g, ""))
    .filter((t) => /^\d{2}/.test(t));
}

beforeEach(() => {
  vi.mocked(getEducation).mockResolvedValue([school]);
  vi.mocked(getInvolvement).mockResolvedValue([]);
  vi.mocked(getCertifications).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("/education", () => {
  it("sets the page title", () => {
    expect(metadata.title).toBe("Education");
  });

  it("renders the school card with graduation label and labelled degree rows", async () => {
    render(await EducationPage());

    expect(screen.getByText("$ cat education.md")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Education" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: school.school })).toBeTruthy();
    expect(screen.getByText("Augusta, GA")).toBeTruthy();
    expect(screen.getByText(/May 2027/)).toBeTruthy();
    expect(screen.getAllByText("degree")).toHaveLength(2);
    expect(screen.getByText("minor")).toBeTruthy();
    expect(screen.getByText("B.S. in Cyber Operations")).toBeTruthy();
    expect(screen.getByText("Mathematics")).toBeTruthy();
  });

  it("hides every optional section when there is nothing to show", async () => {
    render(await EducationPage());
    expect(numberedHeadings()).toEqual([]);
  });

  it("numbers Involvement 01 when it is the only optional section", async () => {
    vi.mocked(getInvolvement).mockResolvedValue(involvement);
    render(await EducationPage());

    expect(numberedHeadings()).toEqual([expect.stringMatching(/^01Involvement/)]);
    expect(screen.getByRole("heading", { level: 3, name: "ACM@AU" })).toBeTruthy();
    expect(screen.getByText("Lead Developer · 2026")).toBeTruthy();
    expect(screen.getByText("Built and run the chapter's production platform.")).toBeTruthy();
    expect(screen.getByText("Officer of Philanthropy · 2024")).toBeTruthy();
  });

  it("numbers Involvement, Relevant coursework, Certifications 01/02/03 when all are present", async () => {
    vi.mocked(getEducation).mockResolvedValue([
      { ...school, coursework: ["Operating Systems", "Network Security"] },
    ]);
    vi.mocked(getInvolvement).mockResolvedValue(involvement);
    vi.mocked(getCertifications).mockResolvedValue([certification]);
    render(await EducationPage());

    expect(numberedHeadings()).toEqual([
      expect.stringMatching(/^01Involvement/),
      expect.stringMatching(/^02Relevantcoursework/),
      expect.stringMatching(/^03Certifications/),
    ]);
    expect(screen.getByText("Operating Systems")).toBeTruthy();
    expect(screen.getByText("Network Security")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Security+" })).toBeTruthy();
    expect(screen.getByText("CompTIA · Mar 2026")).toBeTruthy();

    const link = screen.getByRole("link", { name: /View credential/ });
    expect(link.getAttribute("href")).toBe(certification.url);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("numbers Certifications 01 when involvement and coursework are empty", async () => {
    vi.mocked(getCertifications).mockResolvedValue([{ ...certification, url: null, date: null }]);
    render(await EducationPage());

    expect(numberedHeadings()).toEqual([expect.stringMatching(/^01Certifications/)]);
    expect(screen.getByText("CompTIA")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /View credential/ })).toBeNull();
  });

  it("shows an empty state when no school is published", async () => {
    vi.mocked(getEducation).mockResolvedValue([]);
    render(await EducationPage());
    expect(screen.getByText("No education published yet.")).toBeTruthy();
  });

  it("tags the credential link as an outbound click to other", async () => {
    vi.mocked(getCertifications).mockResolvedValue([certification]);
    render(await EducationPage());
    const link = screen.getByRole("link", { name: /View credential/ });
    expect(link.getAttribute("data-umami-event")).toBe("outbound-click");
    expect(link.getAttribute("data-umami-event-to")).toBe("other");
  });
});
