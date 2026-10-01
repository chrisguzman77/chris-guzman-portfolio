import { afterEach, describe, expect, it, vi } from "vitest";

import type { Experience } from "@/lib/directus/schemas";

import {
  formatMonthYear,
  formatPostDate,
  formatRange,
  graduationLabel,
  isCurrent,
  sectionNumbers,
  sortExperience,
} from "./format";

afterEach(() => vi.unstubAllEnvs());

function role(company: string, start_date: string, end_date: string | null): Experience {
  return {
    id: 0,
    company,
    role: "Engineer",
    location: "Remote",
    start_date,
    end_date,
    highlights: [],
    tech: [],
    show_on_home: true,
  };
}

describe("formatPostDate", () => {
  it("shows month, day, and year", () => {
    expect(formatPostDate("2026-10-14")).toBe("Oct 14, 2026");
  });

  it("never shifts the day in a timezone west of UTC", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    expect(formatPostDate("2026-10-14")).toBe("Oct 14, 2026");
    expect(formatPostDate("2026-01-01")).toBe("Jan 1, 2026");
  });

  it("accepts a full ISO timestamp", () => {
    expect(formatPostDate("2026-10-14T23:30:00Z")).toBe("Oct 14, 2026");
  });
});

describe("formatMonthYear and formatRange", () => {
  it("formats month and year", () => {
    expect(formatMonthYear("2026-08-01")).toBe("Aug 2026");
    expect(formatMonthYear("2026-09-30")).toBe("Sep 2026");
  });

  it("uses an en dash and Present for current roles", () => {
    expect(formatRange("2026-08-01", null)).toBe("Aug 2026 – Present");
  });

  it("formats a past range", () => {
    expect(formatRange("2026-06-01", "2026-07-31")).toBe("Jun 2026 – Jul 2026");
  });
});

describe("isCurrent and sortExperience", () => {
  it("treats a null end date as current", () => {
    expect(isCurrent({ end_date: null })).toBe(true);
    expect(isCurrent({ end_date: "2026-07-31" })).toBe(false);
  });

  it("puts current roles first, then sorts by start date descending", () => {
    const sorted = sortExperience([
      role("SIEGE", "2025-06-01", "2026-06-01"),
      role("ACM", "2026-01-01", null),
      role("SteelGate", "2026-06-01", "2026-07-31"),
      role("CAHP", "2026-08-01", null),
      role("Jubilee", "2026-03-01", null),
    ]);
    expect(sorted.map((e) => e.company)).toEqual(["CAHP", "Jubilee", "ACM", "SteelGate", "SIEGE"]);
  });

  it("does not mutate its input", () => {
    const list = [role("A", "2025-01-01", "2025-02-01"), role("B", "2026-01-01", null)];
    sortExperience(list);
    expect(list.map((e) => e.company)).toEqual(["A", "B"]);
  });
});

describe("graduationLabel", () => {
  it("says Expected before the end date", () => {
    expect(graduationLabel("2027-05-01", new Date("2026-10-01T12:00:00Z"))).toBe(
      "Expected May 2027",
    );
  });

  it("drops Expected once the date has passed", () => {
    expect(graduationLabel("2027-05-01", new Date("2027-06-01T12:00:00Z"))).toBe("May 2027");
  });
});

describe("sectionNumbers", () => {
  it("numbers only the visible sections, two digits", () => {
    expect(sectionNumbers(["involvement", "certifications"])).toEqual({
      involvement: "01",
      certifications: "02",
    });
  });

  it("returns an empty map for no sections", () => {
    expect(sectionNumbers([])).toEqual({});
  });
});
