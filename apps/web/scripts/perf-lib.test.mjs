import { describe, expect, it } from "vitest";

import {
  budgetFromBaseline,
  checkBudgets,
  markdownTable,
  median,
  summarizeLighthouse,
  textTable,
} from "./perf-lib.mjs";

describe("budgetFromBaseline", () => {
  it("adds 10% and rounds up to the next KiB", () => {
    expect(budgetFromBaseline(100_000)).toBe(108 * 1024); // 110,000 B -> 107.4 KiB -> 108 KiB
    expect(budgetFromBaseline(10 * 1024)).toBe(11 * 1024);
  });
});

describe("checkBudgets", () => {
  const budgets = {
    "/": { scriptBytes: 2000, baseline: 1800 },
    "/blog": { scriptBytes: 1000, baseline: 900 },
  };

  it("passes when every route is within budget and reports headroom", () => {
    const { rows, failures } = checkBudgets({ "/": 1500, "/blog": 1000 }, budgets);
    expect(failures).toEqual([]);
    expect(rows).toEqual([
      { route: "/", measured: 1500, budget: 2000, headroomPct: 25 },
      { route: "/blog", measured: 1000, budget: 1000, headroomPct: 0 },
    ]);
  });

  it("names the route, measured value, budget and difference when over", () => {
    const { rows, failures } = checkBudgets({ "/": 2500, "/blog": 900 }, budgets);
    expect(failures).toEqual(["/: measured 2,500 B, budget 2,000 B, over by 500 B (+25.0%)"]);
    expect(rows[0].headroomPct).toBe(-25);
  });

  it("fails a measured route with no budget and suggests an entry", () => {
    const { rows, failures } = checkBudgets({ "/": 1500, "/blog": 900, "/new": 10_000 }, budgets);
    expect(failures).toEqual([
      '/new: no budget in e2e/budgets.json. Add "/new": { "scriptBytes": 11264, "baseline": 10000 }',
    ]);
    expect(rows.at(-1)).toEqual({
      route: "/new",
      measured: 10_000,
      budget: null,
      headroomPct: null,
    });
  });

  it("fails a budget entry for a route that isn't measured", () => {
    const { failures } = checkBudgets({ "/": 1500 }, budgets);
    expect(failures).toEqual([
      "/blog: budget in e2e/budgets.json but budget.spec.ts doesn't measure it. Remove the entry or add the route.",
    ]);
  });
});

describe("median", () => {
  it("takes the middle of an odd count, unsorted", () => {
    expect(median([96, 81, 90])).toBe(90);
  });

  it("averages the middle pair of an even count", () => {
    expect(median([1, 4, 2, 3])).toBe(2.5);
  });

  it("rejects an empty list", () => {
    expect(() => median([])).toThrow();
  });
});

describe("summarizeLighthouse", () => {
  const run = (score, lcp = 2000, tbt = 100) => ({ score, lcp, tbt });

  it("passes when every median is at or above the threshold", () => {
    const { rows, failures } = summarizeLighthouse(
      {
        "/": [run(95, 2800, 50), run(70, 4000, 300), run(96, 2700, 40)],
        "/blog": [run(85), run(85), run(99)],
      },
      85,
    );
    expect(failures).toEqual([]);
    expect(rows[0]).toEqual({ route: "/", score: 95, scores: [95, 70, 96], lcp: 2800, tbt: 50 });
    expect(rows[1].score).toBe(85);
  });

  it("fails a route whose median is below the threshold", () => {
    const { failures } = summarizeLighthouse({ "/blog": [run(84), run(90), run(80)] }, 85);
    expect(failures).toEqual(["/blog: median performance score 84 is below 85 (runs: 84, 90, 80)"]);
  });
});

describe("tables", () => {
  const headers = ["route", "bytes"];
  const rows = [
    ["/", "10"],
    ["/blog/x", "2000"],
  ];

  it("pads a plain-text table", () => {
    expect(textTable(headers, rows)).toBe(
      ["route    bytes", "-------  -----", "/        10   ", "/blog/x  2000 "].join("\n"),
    );
  });

  it("renders a markdown table", () => {
    expect(markdownTable(headers, rows)).toBe(
      ["| route | bytes |", "| --- | --- |", "| / | 10 |", "| /blog/x | 2000 |"].join("\n"),
    );
  });
});
