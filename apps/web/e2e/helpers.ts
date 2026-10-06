import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Page } from "@playwright/test";

const TURNSTILE_STUB = path.join(__dirname, "turnstile-stub.js");

declare global {
  interface Window {
    __csp?: string[];
  }
}

// Every test gets hermetic Turnstile and fails on any console error, page error or CSP violation.
export const test = base.extend<{ gates: void }>({
  gates: [
    async ({ page }, use) => {
      const errors: string[] = [];
      // A page served with an error status (the 404 test) makes Chrome log "Failed to load
      // resource" for the document itself. Tests assert those statuses directly; any other
      // failed resource still fails the gate.
      const errorDocuments = new Set<string>();
      page.on("response", (response) => {
        const request = response.request();
        if (response.status() >= 400 && request.isNavigationRequest()) {
          errorDocuments.add(response.url());
        }
      });
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const fromErrorDocument =
          message.text().startsWith("Failed to load resource") &&
          errorDocuments.has(message.location().url);
        if (!fromErrorDocument)
          errors.push(`console: ${message.text()} (${message.location().url})`);
      });
      page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
      await page.route("https://challenges.cloudflare.com/**", (route) =>
        route.fulfill({ path: TURNSTILE_STUB, contentType: "text/javascript" }),
      );
      await page.addInitScript(() =>
        document.addEventListener("securitypolicyviolation", (e) =>
          (window.__csp ??= []).push(
            `${e.violatedDirective} ${e.blockedURI} (${e.sourceFile}:${e.lineNumber}:${e.columnNumber})`,
          ),
        ),
      );

      await use();

      const csp = page.isClosed() ? [] : await page.evaluate(() => window.__csp ?? []);
      expect(errors, "console errors").toEqual([]);
      expect(csp, "CSP violations").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const summary = violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(summary, `axe violations on ${page.url()}`).toEqual([]);
  expect(violations).toEqual([]);
}

// The chat shortcut is Meta+K on Apple platforms and Ctrl+K elsewhere, judged by the page's own
// platform (the emulated device), not the host OS that ControlOrMeta follows.
export async function pressChatShortcut(page: Page) {
  const apple = await page.evaluate(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || "");
  });
  await page.keyboard.press(apple ? "Meta+k" : "Control+k");
}
