import { expect, test } from "./helpers";

const SITE = "Christopher Guzman";

const meta = (property: string) => `meta[property="${property}"]`;

// A shared link shows the page's own title and description, and an image that loads.
for (const path of [
  "/",
  "/projects",
  "/projects/this-portfolio",
  "/blog/hello-world",
  "/contact",
]) {
  test(`open graph: ${path} describes its own page`, async ({ page }) => {
    await page.goto(path);
    const ownTitle = (await page.title()).replace(` · ${SITE}`, "");
    if (path !== "/") expect(ownTitle).not.toBe(SITE);

    await expect(page.locator(meta("og:title"))).toHaveAttribute("content", ownTitle);
    const description = await page.locator('meta[name="description"]').getAttribute("content");
    expect(description).toBeTruthy();
    expect(description).toBe(description!.trim());
    await expect(page.locator(meta("og:description"))).toHaveAttribute("content", description!);
    const url = await page.locator(meta("og:url")).getAttribute("content");
    expect(new URL(url!).pathname).toBe(path);

    const image = await page.locator(meta("og:image")).first().getAttribute("content");
    expect(image).toBeTruthy();
    const response = await page.request.get(image!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");

    await expect(page.locator(meta("og:type"))).toHaveAttribute(
      "content",
      path.startsWith("/blog/") ? "article" : "website",
    );
  });
}
