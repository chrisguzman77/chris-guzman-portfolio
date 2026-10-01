// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Experience } from "@/lib/directus/schemas";

import { ExperienceEntry } from "./experience-entry";

afterEach(cleanup);

const current: Experience = {
  id: 1,
  company: "Augusta University, College of Allied Health Professions",
  role: "Software Engineer Intern",
  location: "Augusta, GA",
  start_date: "2026-08-01",
  end_date: null,
  highlights: ["Shipped a 3D clinic simulator.", "Eliminated frame-rate stalls."],
  tech: ["three.js", "typescript"],
  show_on_home: true,
};

const past: Experience = {
  ...current,
  id: 2,
  company: "SteelGate LLC",
  role: "AI/ML Engineer / Data Scientist Intern",
  location: "Hybrid",
  start_date: "2026-06-01",
  end_date: "2026-07-31",
};

describe("ExperienceEntry", () => {
  it("shows company, role, current pill, then dates and location", () => {
    render(<ExperienceEntry entry={current} />);
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Augusta University, College of Allied Health Professions",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Software Engineer Intern")).toBeTruthy();
    expect(screen.getByText("current")).toBeTruthy();
    expect(screen.getByText("Aug 2026 – Present")).toBeTruthy();
    expect(screen.getByText("Augusta, GA")).toBeTruthy();
  });

  it("shows no pill and a closed range for a past role", () => {
    render(<ExperienceEntry entry={past} />);
    expect(screen.queryByText("current")).toBeNull();
    expect(screen.getByText("Jun 2026 – Jul 2026")).toBeTruthy();
  });

  it("lists highlights and tech tags in the full layout", () => {
    render(<ExperienceEntry entry={current} />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(current.highlights);
    expect(screen.getByText("three.js · typescript")).toBeTruthy();
  });

  it("hides highlights and tech tags when compact", () => {
    render(<ExperienceEntry entry={current} compact />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText("three.js · typescript")).toBeNull();
    expect(screen.getByText("Aug 2026 – Present")).toBeTruthy();
  });
});
