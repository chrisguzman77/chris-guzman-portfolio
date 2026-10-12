import { expect, test } from "./helpers";

// What the failover Worker does to the snapshot HTML: append a style that hides live features
// and add a banner. It deletes nothing, so React must still hydrate cleanly.
// The banner goes at the END of <body>: a banner prepended as body's first child makes React 19
// throw hydration error #418 on every page (verified), so the Worker must not prepend it.
const STYLE = '<style id="snapshot-style">[data-live-feature]{display:none!important}</style>';
const BANNER =
  '<div id="snapshot-banner" role="status">This is a backup copy of the site while my server is offline. Chat and the contact form are paused; email me at <a href="mailto:chguzman@augusta.edu">chguzman@augusta.edu</a>.</div>';

// [route, live features present on it]
const PAGES: [string, string[]][] = [
  ["/", ["status"]],
  ["/contact", ["contact", "subscribe"]],
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
        .replace("</head>", `${STYLE}</head>`)
        .replace("</body>", `${BANNER}</body>`);
      await r.fulfill({ response, body: html });
    });

    await page.goto(route);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#snapshot-banner")).toBeVisible();
    await expect(page.getByRole("button", { name: /Ask about Chris/ })).toBeHidden();
    if (features.includes("status")) {
      await expect(page.getByRole("region", { name: "Site status" })).toBeHidden();
    }
    if (features.includes("contact")) {
      await expect(page.locator("#contact-form-heading")).toBeHidden();
    }
    if (features.includes("subscribe")) {
      await expect(page.getByRole("form", { name: "Subscribe" })).toBeHidden();
    }

    for (const combo of ["Control+k", "Meta+k"]) {
      await page.keyboard.press(combo);
    }
    await expect(page.getByRole("region", { name: "Ask about Chris" })).toHaveCount(0);

    expect(hydration, "hydration messages").toEqual([]);
  });
}
