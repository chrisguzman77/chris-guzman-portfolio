import { checkBudgets, report } from "../scripts/perf-lib.mjs";
import budgets from "./budgets.json";
import { expect, test } from "./helpers";

// Key pages. The one fixture post, hello-world, carries a mermaid block, so its budget includes
// the lazily loaded diagram library.
const ROUTES = ["/", "/projects", "/blog", "/blog/hello-world", "/contact"];

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

// Uncompressed bytes of every script a page loads by networkidle, lazy chunks included. Fails a
// route over its budget in budgets.json; BUDGET_PRINT_ONLY=1 only prints the table.
test("JS size budget", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile");

  // A cold cache for every route, so shared chunks count on each page that loads them.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

  const measured: Record<string, number> = {};
  for (const route of ROUTES) {
    const bodies: Promise<number>[] = [];
    const onResponse = (response: import("@playwright/test").Response) => {
      if (response.request().resourceType() === "script") {
        bodies.push(response.body().then((body) => body.length));
      }
    };
    page.on("response", onResponse);
    await page.goto(route, { waitUntil: "networkidle" });
    // A diagram loads its library in a chained chunk after networkidle; wait for it to render.
    if (await page.locator("pre[data-mermaid], [data-mermaid-rendered]").count()) {
      await page.locator("[data-mermaid-rendered]").first().waitFor();
      await page.waitForLoadState("networkidle");
    }
    page.off("response", onResponse);
    measured[route] = (await Promise.all(bodies)).reduce((sum, n) => sum + n, 0);
  }

  const { rows, failures } = checkBudgets(measured, budgets);
  report(
    "JS size budget (uncompressed script bytes, mobile)",
    ["route", "measured", "budget", "headroom"],
    rows.map((r) => [
      r.route,
      kb(r.measured),
      r.budget === null ? "none" : kb(r.budget),
      r.headroomPct === null ? "-" : `${r.headroomPct.toFixed(1)}%`,
    ]),
  );
  if (process.env.BUDGET_PRINT_ONLY) {
    console.log(JSON.stringify(measured));
    return;
  }
  expect(failures, "JS size budget (raise a budget only on purpose: e2e/budgets.json)").toEqual([]);
});
