// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Project } from "@/lib/directus/schemas";

import { ProjectCard } from "./project-card";

afterEach(cleanup);

const project: Project = {
  id: 1,
  slug: "offres",
  title: "OFFRes / OFFPay",
  summary: "Offline payment device on a Raspberry Pi 5.",
  body: null,
  type: "competition",
  award: "Capital One Best Financial Hack",
  tech: ["python", "fastapi", "react"],
  repo_url: null,
  live_url: null,
  cover: null,
  date: "2025-10-01",
  featured: true,
};

describe("ProjectCard", () => {
  it("is one link to the detail page named by the project title", () => {
    render(<ProjectCard project={project} />);
    const link = screen.getByRole("link", { name: "OFFRes / OFFPay" });
    expect(link.getAttribute("href")).toBe("/projects/offres");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("shows the title, summary, tech tags, and award badge", () => {
    render(<ProjectCard project={project} />);
    expect(screen.getByRole("heading", { level: 3, name: "OFFRes / OFFPay" })).toBeTruthy();
    expect(screen.getByText("Offline payment device on a Raspberry Pi 5.")).toBeTruthy();
    expect(screen.getByText("python · fastapi · react")).toBeTruthy();
    expect(screen.getByText("Capital One Best Financial Hack")).toBeTruthy();
  });

  it("omits the badge when there is no award", () => {
    const { container } = render(<ProjectCard project={{ ...project, award: null }} />);
    expect(screen.queryByText("Capital One Best Financial Hack")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });
});
