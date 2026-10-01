// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getExperience } from "@/lib/directus/queries";
import type { Experience } from "@/lib/directus/schemas";

import ExperiencePage, { metadata } from "./page";

vi.mock("@/lib/directus/queries", () => ({ getExperience: vi.fn() }));

function role(over: Partial<Experience> & Pick<Experience, "id" | "company">): Experience {
  return {
    role: "Engineer",
    location: "Augusta, GA",
    start_date: "2026-01-01",
    end_date: null,
    highlights: ["Shipped a thing."],
    tech: ["python"],
    show_on_home: true,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("/experience", () => {
  it("sets the page title", () => {
    expect(metadata.title).toBe("Experience");
  });

  it("renders the prompt, every role in query order with dashed separators, and the resume button", async () => {
    vi.mocked(getExperience).mockResolvedValue([
      role({ id: 1, company: "Acme Labs" }),
      role({ id: 2, company: "Globex", show_on_home: false, end_date: "2026-07-01" }),
    ]);
    const { container } = render(await ExperiencePage());

    expect(screen.getByText("$ cat experience.log")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Experience" })).toBeTruthy();

    const text = container.textContent ?? "";
    expect(text.indexOf("Acme Labs")).toBeGreaterThan(-1);
    expect(text.indexOf("Acme Labs")).toBeLessThan(text.indexOf("Globex"));

    const list = container.querySelector("ol.divide-dashed");
    expect(list).not.toBeNull();
    expect(list!.children).toHaveLength(2);

    const resume = screen.getByRole("link", { name: /Download full resume/ });
    expect(resume.getAttribute("href")).toBe("/resume");
    expect(resume.querySelector("svg")).not.toBeNull();
  });

  it("shows the empty state when no roles are published", async () => {
    vi.mocked(getExperience).mockResolvedValue([]);
    const { container } = render(await ExperiencePage());

    expect(screen.getByText("No roles published yet.")).toBeTruthy();
    expect(container.querySelector("ol.divide-dashed")).toBeNull();
    expect(screen.getByRole("link", { name: /Download full resume/ })).toBeTruthy();
  });
});
