import { expect, expectNoAxeViolations, test } from "./helpers";

test("grid behind every page; spotlight follows a mouse but never a touch screen", async ({
  page,
  isMobile,
}) => {
  await page.goto("/projects");
  const grid = await page.evaluate(
    () => getComputedStyle(document.body, "::before").backgroundImage,
  );
  expect(grid).toContain("linear-gradient");

  await page.mouse.move(200, 300);
  await page.mouse.move(240, 320);
  const html = page.locator("html");
  if (isMobile) {
    await expect(html).not.toHaveAttribute("data-spotlight");
    const display = await page.evaluate(() => getComputedStyle(document.body, "::after").display);
    expect(display).toBe("none");
  } else {
    await expect(html).toHaveAttribute("data-spotlight", "");
    await expect(html).toHaveCSS("--spot-x", "240px");
  }
  await expectNoAxeViolations(page);
});

test("project cards lift and turn mint on hover", async ({ page, isMobile }) => {
  test.skip(isMobile, "hover effects are mouse-only");
  await page.goto("/projects");
  const card = page.getByRole("link", { name: /^This portfolio/ });
  const border = () => card.evaluate((element) => getComputedStyle(element).borderTopColor);
  const resting = await border();
  await card.hover();
  await expect(card).not.toHaveCSS("transform", "none");
  await expect.poll(border).not.toBe(resting);
});

test("project cards turn mint on keyboard focus", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard focus ring is checked on desktop");
  await page.goto("/projects");
  const card = page.getByRole("link", { name: /^This portfolio/ });
  const border = () => card.evaluate((element) => getComputedStyle(element).borderTopColor);
  const resting = await border();
  await page.keyboard.press("Tab"); // switch to keyboard modality so :focus-visible applies
  await card.focus();
  await expect.poll(border).not.toBe(resting);
});

test("the chat pill's mint arc spins, and stands still as a full ring with reduced motion", async ({
  page,
}) => {
  await page.goto("/");
  const pill = page.getByRole("button", { name: /Ask about Chris/ });
  await expect(pill).toBeVisible();
  const arc = () =>
    pill.evaluate((element) => {
      const style = getComputedStyle(element, "::after");
      return { animation: style.animationName, background: style.backgroundImage };
    });
  expect(await arc()).toMatchObject({ animation: "chat-arc-spin" });
  expect((await arc()).background).toContain("conic-gradient");

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await arc()).toMatchObject({ animation: "none", background: "none" });
});

test("theme toggle switches the theme through the circular reveal", async ({ page }) => {
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).toHaveClass(/\bdark\b/);
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(html).not.toHaveClass(/\bdark\b/);
  await page.waitForTimeout(800); // let the 650 ms reveal finish before axe reads colours
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(html).toHaveClass(/\bdark\b/);
});

test("the logo shows the section you are in", async ({ page, isMobile }) => {
  await page.goto("/");
  const suffix = page.locator("[data-logo-suffix]");
  await expect(suffix).toHaveText("");
  if (isMobile) await page.getByRole("button", { name: "Open menu" }).click();
  const nav = page.getByRole("navigation", { name: isMobile ? "Mobile" : "Main" });
  await nav.getByRole("link", { name: "projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(suffix).toHaveText("/projects");
  if (!isMobile) {
    await expect(page.locator("[data-nav-indicator]")).toHaveCSS("opacity", "1");
  }
});

test.describe("missing pages", () => {
  test.use({ allowedDocumentStatus: [404] });

  test("the logo shows /404 on a missing page, nested or not", async ({ page }) => {
    for (const path of ["/nope", "/projects/does-not-exist"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.locator("[data-logo-suffix]")).toHaveText("/404");
    }
  });
});

test("the header never overflows the viewport", async ({ page }) => {
  for (const width of [360, 800, 1024, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/experience");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
  }
});

test("footer shows the build it was deployed from", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  const release = process.env.NEXT_PUBLIC_APP_RELEASE;
  if (release) {
    const sha = process.env.NEXT_PUBLIC_APP_VERSION!.slice(0, 7);
    await expect(footer.getByRole("link", { name: `commit ${sha} on GitHub` })).toHaveText(sha);
    await expect(
      footer.getByRole("link", { name: `release ${release} on GitHub` }),
    ).toHaveAttribute(
      "href",
      `https://github.com/chrisguzman77/chris-guzman-portfolio/releases/tag/${release}`,
    );
    await expect(footer.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d\d-\d\dT/);
  } else {
    await expect(footer.getByText("dev", { exact: true })).toBeVisible();
  }
  await expectNoAxeViolations(page);
});
