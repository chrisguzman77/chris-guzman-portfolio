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

test("resume: download link and PDF embed", async ({ page }) => {
  await page.goto("/resume");
  await expect(page.getByRole("link", { name: /download/i })).toHaveAttribute("href", /.+/);
  await expect(page.locator("object")).toHaveCount(1);
  await expect(page.locator("object")).toBeVisible();
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
  // The launcher's key and click handlers exist only after hydration, which can lag the load
  // event on a slow CI runner; retry until the terminal opens.
  await expect(async () => {
    if (isMobile) await pressChatShortcut(page);
    else await page.getByRole("button", { name: /Ask about Chris/ }).click();
    await expect(terminal).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  const input = terminal.getByRole("textbox", { name: "Ask a question about Chris" });
  await expect(input).toHaveAttribute("placeholder", "type a question…");
  await input.fill("what stack is this site?");
  await input.press("Enter");
  // The typed paragraph, not the sr-only live region that announces the same text.
  await expect(
    terminal
      .getByRole("paragraph")
      .filter({ hasText: "Chris built this site with Next.js and FastAPI [1]." }),
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

test("chat on a phone: a floating card that the backdrop closes", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone layout only");
  await page.goto("/");
  const terminal = page.getByRole("region", { name: "Ask about Chris" });
  await expect(async () => {
    await pressChatShortcut(page);
    await expect(terminal).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  const viewport = page.viewportSize()!;
  const box = (await terminal.boundingBox())!;
  expect(box.height).toBeLessThan(viewport.height * 0.85);
  expect(box.x).toBeGreaterThan(0);
  expect(box.x + box.width).toBeLessThan(viewport.width);
  await expectNoAxeViolations(page);

  await page.touchscreen.tap(viewport.width / 2, 20); // above the card, on the backdrop
  await expect(terminal).toBeHidden();
  await expect(page.getByRole("button", { name: /Ask about Chris/ })).toBeVisible();
});

test("chat pill clears the footer after client-side navigation", async ({ page, isMobile }) => {
  test.skip(isMobile, "the header nav links are desktop only");
  await page.goto("/");
  const pill = page.getByRole("button", { name: /Ask about Chris/ });
  // The shortcut label renders only once hydrated, so the click below is a client navigation.
  await expect(pill.locator("kbd")).toBeVisible();
  await page.evaluate(() => Object.assign(window, { __sameDocument: true }));
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "education" })
    .click();
  await expect(page).toHaveURL(/\/education$/);
  expect(await page.evaluate(() => "__sameDocument" in window)).toBe(true);

  const footer = page.locator("footer");
  await expect
    .poll(async () => {
      const p = (await pill.boundingBox())!;
      const f = (await footer.boundingBox())!;
      return p.y + p.height <= f.y || p.y >= f.y + f.height;
    })
    .toBe(true);
});

test.describe("404", () => {
  test.use({ allowedDocumentStatus: [404] });

  test("404: not found page", async ({ page }) => {
    const response = await page.goto("/nope");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
    await expectNoAxeViolations(page);
  });
});

test("light theme: pages stay accessible", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("theme", "light"));
  for (const path of ["/", "/projects", "/contact"]) {
    const response = await page.goto(path);
    expect(response?.ok()).toBe(true);
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

test("blog: subscribe", async ({ page }) => {
  await page.goto("/blog");
  const box = page.getByRole("region", { name: "Subscribe" });
  await box.getByRole("textbox", { name: "Email" }).fill("ada@example.com");
  await box.getByRole("button", { name: "Subscribe" }).click();
  await expect(box.getByText("Check your inbox to confirm.")).toBeVisible();
  await expectNoAxeViolations(page);
});

test("newsletter: confirm and unsubscribe links", async ({ page }) => {
  await page.goto("/newsletter/confirm?token=good");
  await expect(
    page.getByText("You're subscribed. You'll get an email when there's a new post."),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  await page.goto("/newsletter/unsubscribe?token=good");
  await expect(page.getByText("You're unsubscribed.")).toBeVisible();
  await expectNoAxeViolations(page);
});

test.describe("newsletter: expired link", () => {
  test.use({ allowedFetchStatus: [400] });

  test("confirm explains and links to the blog", async ({ page }) => {
    await page.goto("/newsletter/confirm?token=old");
    await expect(page.getByText(/This link has expired/)).toBeVisible();
    await expect(page.getByRole("link", { name: "the blog" })).toHaveAttribute("href", "/blog");
  });
});
