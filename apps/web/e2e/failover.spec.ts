import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "./helpers";

// The Worker lives outside apps/web, and the Docker build (whose context is apps/web) type-checks
// this file, so load it at runtime from a computed path instead of a static import.
const WORKER = path.resolve(__dirname, "../../../infra/cloudflare/worker-fallback.mjs");
let HIDE_STYLE = "";
let BANNER_HTML = "";
test.beforeAll(async () => {
  const mod = (await import(pathToFileURL(WORKER).href)) as {
    default: { HIDE_STYLE: string; BANNER_HTML: string };
  };
  ({ HIDE_STYLE, BANNER_HTML } = mod.default);
});

// What the failover Worker does to the snapshot HTML, using the Worker's own strings: append a
// style that hides live features and add a banner. It deletes nothing, so React must still
// hydrate cleanly. The banner goes at the END of <body>: a banner prepended as body's first child
// makes React 19 throw hydration error #418 on every page (verified), so the Worker must not
// prepend it.

// [route, live features present on it]
const PAGES: [string, string[]][] = [
  ["/", ["status", "subscribe"]],
  ["/contact", ["contact"]],
  ["/blog", ["subscribe"]],
];

for (const [route, features] of PAGES) {
  test(`failover: ${route} hides live features and hydrates cleanly`, async ({ page }) => {
    // Hydration mismatches are console errors in React 19, which the helpers fail on. Also catch
    // any warning-level message that mentions them.
    const hydration: string[] = [];
    page.on("console", (message) => {
      if (/hydrat/i.test(message.text())) hydration.push(message.text());
    });

    await page.route("**/*", async (r) => {
      if (!r.request().isNavigationRequest() || r.request().resourceType() !== "document") {
        return r.continue();
      }
      const response = await r.fetch();
      const html = (await response.text())
        .replace("</head>", `${HIDE_STYLE}</head>`)
        .replace("</body>", `${BANNER_HTML}</body>`);
      await r.fulfill({ response, body: html });
    });

    await page.goto(route);
    await page.waitForLoadState("networkidle");

    const banner = page.locator("#snapshot-banner");
    await expect(banner).toBeVisible();
    // Sticky to the bottom of the flex-column <body>: on screen from the top of the page.
    await expect(banner).toBeInViewport();
    // toBeHidden() also passes for an element that is not there, so each must be attached first.
    // includeHidden: role queries skip display:none elements, which would fail toBeAttached().
    const hidden = [page.getByRole("button", { name: /Ask about Chris/, includeHidden: true })];
    if (features.includes("status")) {
      hidden.push(page.getByRole("region", { name: "Site status", includeHidden: true }));
    }
    if (features.includes("contact")) {
      hidden.push(page.locator("#contact-form-heading"));
    }
    if (features.includes("subscribe")) {
      hidden.push(page.getByRole("form", { name: "Subscribe", includeHidden: true }));
    }
    for (const locator of hidden) {
      await expect(locator).toBeAttached();
      await expect(locator).toBeHidden();
    }

    if (test.info().project.name === "mobile") {
      // The banner wraps to several lines on a phone; at the end of the page it must sit below
      // the footer rather than over it. The whole footer box is checked, not just its last link:
      // the old fixed banner with 4rem of body padding covered the footer's padding and border
      // while missing the links, so a link-only check passed against it.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const footer = await page.locator("footer").boundingBox();
      const bar = await banner.boundingBox();
      expect(footer && bar, "footer and banner boxes").toBeTruthy();
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(bar!.y);
    }

    for (const combo of ["Control+k", "Meta+k"]) {
      await page.keyboard.press(combo);
    }
    await expect(page.getByRole("region", { name: "Ask about Chris" })).toHaveCount(0);

    expect(hydration, "hydration messages").toEqual([]);
  });
}
