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
  await card.hover();
  await expect(card).not.toHaveCSS("transform", "none");
});
