import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Page } from "@playwright/test";

const TURNSTILE_STUB = path.join(__dirname, "turnstile-stub.js");

declare global {
  interface Window {
    __reportCsp?: (violation: string) => void;
  }
}

type Gates = {
  // Document statuses a test expects (the 404 test sets [404]); Chrome's "Failed to load
  // resource" for such a document is then not a console error. Empty everywhere else.
  allowedDocumentStatus: number[];
  gates: void;
};

// Every test gets hermetic Turnstile and fails on any console error, page error or CSP violation.
export const test = base.extend<Gates>({
  allowedDocumentStatus: [[], { option: true }],
  gates: [
    async ({ page, allowedDocumentStatus }, use) => {
      const errors: string[] = [];
      const csp: string[] = [];
      const allowedDocuments = new Set<string>();
      page.on("response", (response) => {
        if (
          response.request().isNavigationRequest() &&
          allowedDocumentStatus.includes(response.status())
        ) {
          allowedDocuments.add(response.url());
        }
      });
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const allowed =
          message.text().startsWith("Failed to load resource") &&
          allowedDocuments.has(message.location().url);
        if (!allowed) errors.push(`console: ${message.text()} (${message.location().url})`);
      });
      page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
      await page.route("https://challenges.cloudflare.com/**", (route) =>
        route.fulfill({ path: TURNSTILE_STUB, contentType: "text/javascript" }),
      );
      // Reported straight to Node, so violations survive every navigation in a test.
      await page.exposeFunction("__reportCsp", (violation: string) => csp.push(violation));
      await page.addInitScript(() =>
        document.addEventListener("securitypolicyviolation", (e) =>
          window.__reportCsp?.(
            `${e.violatedDirective} ${e.blockedURI} (${e.sourceFile}:${e.lineNumber}:${e.columnNumber})`,
          ),
        ),
      );

      await use();

      if (!page.isClosed()) {
        // Let violation events fired by the last frame reach Node.
        await page.evaluate(
          () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50))),
        );
      }
      expect.soft(errors, "console errors").toEqual([]);
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
