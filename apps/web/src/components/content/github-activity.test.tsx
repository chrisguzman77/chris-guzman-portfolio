// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Activity } from "@/lib/github-activity";

import { contributionTitle, GitHubActivity, MOBILE_WEEKS } from "./github-activity";

afterEach(cleanup);

// 30 Sunday-start weeks from 2026-03-01; the first week starts on a Wednesday (partial).
function makeActivity(): Activity {
  const weeks: Activity["weeks"] = [];
  const start = Date.UTC(2026, 2, 1);
  for (let w = 0; w < 30; w++) {
    const days = [];
    for (let d = w === 0 ? 3 : 0; d < 7; d++) {
      const date = new Date(start + (w * 7 + d) * 86_400_000).toISOString().slice(0, 10);
      days.push({ date, count: d, level: Math.min(d, 4) });
    }
    weeks.push({ days });
  }
  return { total: 1234, weeks, fetched_at: "2026-10-02T12:00:00Z" };
}

describe("contributionTitle", () => {
  it.each([
    [0, "No contributions on Sep 14, 2026"],
    [1, "1 contribution on Sep 14, 2026"],
    [3, "3 contributions on Sep 14, 2026"],
  ])("count %i", (count, text) => {
    expect(contributionTitle({ date: "2026-09-14", count, level: 1 })).toBe(text);
  });
});

describe("GitHubActivity", () => {
  it("labels the grid for screen readers and links to the profile in a new tab", () => {
    render(<GitHubActivity activity={makeActivity()} profileUrl="https://github.com/octo" />);
    expect(
      screen.getByRole("img", { name: "1,234 GitHub contributions in the last year" }),
    ).toBeTruthy();
    const link = screen.getByRole("link", {
      name: /^1,234 contributions in the last year · updated hourly/,
    });
    expect(link.getAttribute("href")).toBe("https://github.com/octo");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("1,234 contributions in the last year · updated hourly")).toBeTruthy();
  });

  it("renders one column per week with 7 slots, padding partial weeks", () => {
    const { container } = render(
      <GitHubActivity activity={makeActivity()} profileUrl="https://github.com/octo" />,
    );
    const columns = container.querySelectorAll('[role="img"] > div');
    expect(columns).toHaveLength(30);
    expect(columns[0].children).toHaveLength(7);
    expect(columns[0].querySelectorAll("[title]")).toHaveLength(4); // Wed–Sat
    expect(container.querySelector('[title="3 contributions on Mar 4, 2026"]')).toBeTruthy();
  });

  it("hides all but the last 22 weeks below md", () => {
    const { container } = render(
      <GitHubActivity activity={makeActivity()} profileUrl="https://github.com/octo" />,
    );
    const columns = [...container.querySelectorAll('[role="img"] > div')];
    const hidden = columns.filter((c) => c.className.includes("hidden md:flex"));
    expect(hidden).toHaveLength(30 - MOBILE_WEEKS);
    expect(columns.at(-1)?.className).not.toContain("hidden");
  });

  it("labels each month once, where it starts", () => {
    render(<GitHubActivity activity={makeActivity()} profileUrl="https://github.com/octo" />);
    for (const month of ["Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"]) {
      expect(screen.getAllByText(month)).toHaveLength(1);
    }
  });

  it("says contribution in the singular for a total of one", () => {
    const activity = { ...makeActivity(), total: 1 };
    render(<GitHubActivity activity={activity} profileUrl="https://github.com/octo" />);
    expect(
      screen.getByRole("img", { name: "1 GitHub contribution in the last year" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", {
        name: /^1 contribution in the last year · updated hourly/,
      }),
    ).toBeTruthy();
  });

  it("tags the profile link as an outbound click to github", () => {
    render(<GitHubActivity activity={makeActivity()} profileUrl="https://github.com/octo" />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("data-umami-event")).toBe("outbound-click");
    expect(link.getAttribute("data-umami-event-to")).toBe("github");
  });
});
