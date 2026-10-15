import { expect, expectNoAxeViolations, test } from "./helpers";

test("grid and spotlight behind the home hero only; the spotlight never shows on touch", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  const hero = page.locator("section.hero-glow");
  await expect(hero).toHaveCount(1);
  const layer = (pseudo: "::before" | "::after", prop: "backgroundImage" | "opacity") =>
    hero.evaluate((element, [p, k]) => getComputedStyle(element, p)[k as "opacity"], [
      pseudo,
      prop,
    ] as const);
  expect(await layer("::before", "backgroundImage")).toContain("linear-gradient");

  const box = (await hero.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 80);
  await page.mouse.move(box.x + 140, box.y + 120);
  if (isMobile) {
    expect(await layer("::after", "opacity")).toBe("0");
  } else {
    await expect(hero).toHaveCSS("--hero-x", "140px");
    await expect.poll(() => layer("::after", "opacity")).toBe("1");
  }
  await expectNoAxeViolations(page);

  // Other pages are plain: no hero layer and no page-wide grid.
  await page.goto("/projects");
  await expect(page.locator(".hero-glow")).toHaveCount(0);
  expect(
    await page.evaluate(() => getComputedStyle(document.body, "::before").backgroundImage),
  ).toBe("none");
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

test("the hero prompt types once per browser session", async ({ page }) => {
  await page.goto("/");
  const prompt = page.getByText("$ whoami", { exact: true });
  await expect(prompt).toHaveClass(/hero-type/);
  await expect(page.getByRole("link", { name: "Download resume" })).toHaveCSS("opacity", "1");
  await page.reload();
  await expect(prompt).not.toHaveClass(/hero-type/);
  await expect(page.locator(".hero-fade")).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the hero shows its final state immediately", async ({ page }) => {
    await page.goto("/");
    const prompt = page.getByText("$ whoami", { exact: true });
    await expect(prompt).toHaveCSS("animation-name", "none");
    await expect(page.locator(".hero-caret")).toBeHidden();
    // No 0.65 s delay: the actions are fully visible at once.
    expect(
      await page
        .getByRole("link", { name: "Download resume" })
        .evaluate((element) => getComputedStyle(element.closest(".hero-fade")!).opacity),
    ).toBe("1");
  });

  test("the experience timeline is full and lit", async ({ page }) => {
    await page.goto("/experience");
    const list = page.locator("ol.timeline");
    await expect(list.locator("li").first()).toBeVisible();
    await expect(list).not.toHaveAttribute("data-timeline-ready");
    const fill = await list.evaluate((element) => getComputedStyle(element, "::after").transform);
    expect(fill === "none" || fill === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
  });
});

test("the experience timeline lights each entry as you scroll", async ({ page }) => {
  await page.goto("/experience");
  const list = page.locator("ol.timeline");
  await expect(list).toHaveAttribute("data-timeline-ready", "");
  await expect(list.locator(":scope > li").first()).toHaveAttribute("data-lit", "");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(list.locator(":scope > li").last()).toHaveAttribute("data-lit", "");
  await expect(list).toHaveCSS("--timeline-progress", "1");
  await expectNoAxeViolations(page);
});
