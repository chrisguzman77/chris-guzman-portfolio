// Pure helpers shared by the JS size budget (e2e/budget.spec.ts) and the Lighthouse soft gate
// (scripts/lighthouse-ci.mjs). Unit tested in perf-lib.test.mjs.
import { appendFileSync } from "node:fs";

const KIB = 1024;
const bytes = (n) => `${n.toLocaleString("en-US")} B`;

/** A new budget: the measured baseline plus 10% headroom, rounded up to the next KiB. */
export function budgetFromBaseline(baseline) {
  return Math.ceil((baseline * 1.1) / KIB) * KIB;
}

/**
 * @param {Record<string, number>} measured script bytes per route
 * @param {Record<string, { scriptBytes: number, baseline?: number }>} budgets
 */
export function checkBudgets(measured, budgets) {
  const rows = [];
  const failures = [];
  for (const [route, value] of Object.entries(measured)) {
    const budget = budgets[route]?.scriptBytes ?? null;
    if (budget === null) {
      failures.push(
        `${route}: no budget in e2e/budgets.json. Add "${route}": { "scriptBytes": ${budgetFromBaseline(value)}, "baseline": ${value} }`,
      );
      rows.push({ route, measured: value, budget: null, headroomPct: null });
      continue;
    }
    if (value > budget) {
      const over = value - budget;
      failures.push(
        `${route}: measured ${bytes(value)}, budget ${bytes(budget)}, over by ${bytes(over)} (+${((over / budget) * 100).toFixed(1)}%)`,
      );
    }
    rows.push({ route, measured: value, budget, headroomPct: ((budget - value) / budget) * 100 });
  }
  for (const route of Object.keys(budgets)) {
    if (!(route in measured)) {
      failures.push(
        `${route}: budget in e2e/budgets.json but budget.spec.ts doesn't measure it. Remove the entry or add the route.`,
      );
    }
  }
  return { rows, failures };
}

/** @param {number[]} values */
export function median(values) {
  if (values.length === 0) throw new Error("median of an empty list");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * @param {Record<string, { score: number, lcp: number, tbt: number }[]>} runs per route; score is 0-100
 * @param {number} threshold a median below this fails
 */
export function summarizeLighthouse(runs, threshold) {
  const rows = [];
  const failures = [];
  for (const [route, results] of Object.entries(runs)) {
    const scores = results.map((r) => r.score);
    const score = median(scores);
    if (score < threshold) {
      failures.push(
        `${route}: median performance score ${score} is below ${threshold} (runs: ${scores.join(", ")})`,
      );
    }
    rows.push({
      route,
      score,
      scores,
      lcp: median(results.map((r) => r.lcp)),
      tbt: median(results.map((r) => r.tbt)),
    });
  }
  return { rows, failures };
}

/** @param {string[]} headers @param {string[][]} rows */
export function textTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

/** @param {string[]} headers @param {string[][]} rows */
export function markdownTable(headers, rows) {
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

/** Print a table, and append it to the GitHub Actions step summary when there is one. */
export function report(title, headers, rows) {
  console.log(`\n${title}\n${textTable(headers, rows)}\n`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `### ${title}\n\n${markdownTable(headers, rows)}\n\n`);
}
