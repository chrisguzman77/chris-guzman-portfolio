import { expect, expectNoAxeViolations, pressChatShortcut, test } from "./helpers";

test("home: profile, status, featured work, skip link", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Christopher Guzman");
  await expect(page.getByText(/all systems operational/)).toBeVisible();
  await expect(page.getByRole("link", { name: /^Cyber Threat Lakehouse/ })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("projects: list to detail", async ({ page }) => {
  await page.goto("/projects");
  await expectNoAxeViolations(page);
  await page.getByRole("link", { name: /^This portfolio/ }).click();
  await expect(page).toHaveURL(/\/projects\/this-portfolio$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This portfolio");
  await expectNoAxeViolations(page);
});

test("resume: download link", async ({ page }) => {
  await page.goto("/resume");
  await expect(page.getByRole("link", { name: /download/i })).toHaveAttribute("href", /.+/);
  await expectNoAxeViolations(page);
});

test("contact: validation, then send", async ({ page }) => {
  await page.goto("/contact");
  const send = page.getByRole("button", { name: "Send message" });
  await send.click();
  await expect(page.getByText("Enter your name.")).toBeVisible();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await expect(page.getByText("Message must be at least 10 characters.")).toBeVisible();

  await page.getByRole("textbox", { name: "Name" }).fill("Ada Lovelace");
  await page.getByRole("textbox", { name: "Email" }).fill("ada@example.com");
  await page
    .getByRole("textbox", { name: "Message" })
    .fill("Hello Chris, this is an end-to-end test.");
  await send.click();
  await expect(page.getByText("Message sent. I'll reply to the email you gave.")).toBeVisible();
  await expectNoAxeViolations(page);
});

test("chat: ask a question, get a cited answer", async ({ page, isMobile }) => {
  await page.goto("/");
  const terminal = page.getByRole("region", { name: "Ask about Chris" });
  if (isMobile) await pressChatShortcut(page);
  else await page.getByRole("button", { name: /Ask about Chris/ }).click();
  await expect(terminal).toBeVisible();

  const input = terminal.getByRole("textbox", { name: "Ask a question about Chris" });
  await expect(input).toHaveAttribute("placeholder", "type a question…");
  await input.fill("what stack is this site?");
  await input.press("Enter");
  await expect(
    terminal.getByText("Chris built this site with Next.js and FastAPI [1]."),
  ).toBeVisible();
  await expect(terminal.getByRole("link", { name: "[1] This portfolio" })).toHaveAttribute(
    "href",
    "/projects/this-portfolio",
  );

  await page.keyboard.press("Escape");
  await expect(terminal).toBeHidden();
  await pressChatShortcut(page);
  await expect(terminal).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(terminal).toBeHidden();
});

test("404: not found page", async ({ page }) => {
  const response = await page.goto("/nope");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
  await expectNoAxeViolations(page);
});

test("light theme: pages stay accessible", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("theme", "light"));
  for (const path of ["/", "/projects", "/contact"]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveClass(/\blight\b/);
    await expectNoAxeViolations(page);
  }
});

test("headers: nonce CSP and static security headers", async ({ request }) => {
  const response = await request.get("/");
  const headers = response.headers();
  expect(headers["content-security-policy"]).toMatch(/'nonce-[A-Za-z0-9+/=]{24}'/);
  expect(headers["strict-transport-security"]).toBeTruthy();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBeTruthy();
  expect(headers["permissions-policy"]).toBeTruthy();
  expect(headers["cross-origin-opener-policy"]).toBeTruthy();
  expect(headers["x-powered-by"]).toBeUndefined();
});
