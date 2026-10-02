// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AwardBadge } from "./award-badge";
import { CurrentPill } from "./current-pill";
import { EmptyState } from "./empty-state";
import { PageHeader } from "./page-header";
import { Prose } from "./prose";
import { SectionHeading } from "./section-heading";
import { TechTags } from "./tech-tags";

afterEach(cleanup);

describe("PageHeader", () => {
  it("renders the mono prompt and the h1, and nothing else", () => {
    const { container } = render(<PageHeader prompt="$ cat experience.log" title="Experience" />);
    expect(screen.getByText("$ cat experience.log").className).toContain("font-mono");
    expect(screen.getByRole("heading", { level: 1, name: "Experience" })).toBeTruthy();
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("carries no outer margin or padding on its root", () => {
    const { container } = render(<PageHeader prompt="$ ls" title="Title" />);
    expect((container.firstElementChild as HTMLElement).className).not.toMatch(/\b(m|p)[btxylr]?-/);
  });

  it("sets the title at 30px with 16px under the prompt", () => {
    render(<PageHeader prompt="$ ls" title="Title" />);
    const h1 = screen.getByRole("heading", { level: 1, name: "Title" });
    expect(h1.className).toContain("text-3xl");
    expect(h1.className).toContain("mt-4");
    expect(h1.className).not.toContain("text-4xl");
  });
});

describe("SectionHeading", () => {
  it("renders an h2 with a decorative number", () => {
    render(<SectionHeading number="01" title="Featured projects" id="featured" />);
    const heading = screen.getByRole("heading", { level: 2, name: "Featured projects" });
    expect(heading.id).toBe("featured");
    expect(heading.textContent).toBe("01Featured projects");
  });

  it("carries no outer margin or padding on its root", () => {
    const { container } = render(<SectionHeading number="01" title="Featured" />);
    expect((container.firstElementChild as HTMLElement).className).not.toMatch(/\b(m|p)[btxylr]?-/);
  });

  it("renders an optional right-side link", () => {
    render(
      <SectionHeading
        number="01"
        title="Featured projects"
        href="/projects"
        linkLabel="all projects"
      />,
    );
    const link = screen.getByRole("link", { name: "all projects" });
    expect(link.getAttribute("href")).toBe("/projects");
    expect(link.getAttribute("target")).toBeNull();
  });

  it("opens an external link in a new tab", () => {
    render(
      <SectionHeading
        number="03"
        title="GitHub activity"
        href="https://github.com/octo"
        linkLabel="@octo"
      />,
    );
    const link = screen.getByRole("link", { name: "@octo" });
    expect(link.getAttribute("href")).toBe("https://github.com/octo");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent).toBe("@octo →");
  });

  it("renders an optional count instead of a link", () => {
    render(<SectionHeading number="01" title="Personal projects" count="3 projects" />);
    expect(screen.getByText("3 projects")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("AwardBadge", () => {
  it("shows the award text with a decorative trophy icon", () => {
    const { container } = render(<AwardBadge award="Capital One Best Financial Hack" />);
    expect(screen.getByText("Capital One Best Financial Hack")).toBeTruthy();
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(container.firstElementChild?.className).toContain("rounded-[10px]");
  });
});

describe("TechTags", () => {
  it("joins tags with a middle dot", () => {
    render(<TechTags tags={["python", "fastapi", "react"]} />);
    expect(screen.getByText("python · fastapi · react")).toBeTruthy();
  });

  it("renders nothing for an empty list", () => {
    const { container } = render(<TechTags tags={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("CurrentPill", () => {
  it("says current", () => {
    render(<CurrentPill />);
    expect(screen.getByText("current").className).toContain("text-live");
  });
});

describe("EmptyState", () => {
  it("renders its children in a dashed box", () => {
    render(<EmptyState>nothing yet. First post coming soon.</EmptyState>);
    const box = screen.getByText("nothing yet. First post coming soon.");
    expect(box.className).toContain("border-dashed");
  });
});

describe("Prose", () => {
  it("renders the given sanitized HTML inside the prose container", () => {
    const { container } = render(
      <Prose html={'<h2 id="intro">Intro</h2><p>Hello <a href="/x">link</a></p>'} />,
    );
    expect(container.firstElementChild?.className).toContain("prose-content");
    expect(screen.getByRole("heading", { level: 2, name: "Intro" }).id).toBe("intro");
    expect(screen.getByRole("link", { name: "link" }).getAttribute("href")).toBe("/x");
  });
});
