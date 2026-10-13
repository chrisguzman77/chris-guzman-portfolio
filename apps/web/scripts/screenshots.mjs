// README screenshots from the live site: `pnpm screenshots` (from apps/web).
// Writes docs/images/home-light.png and home-dark.png at 1280×800, and chat.png when the chat
// panel opens. An image over 300 KB as PNG is saved as JPEG instead (README.md must match).
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const SITE = "https://christopherguzman.me";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/images");
const VIEWPORT = { width: 1280, height: 800 };
const MAX_BYTES = 300_000;
const CHAT_TIMEOUT = 10_000;

async function save(page, name) {
  for (const ext of ["png", "jpg"]) await rm(path.join(OUT, `${name}.${ext}`), { force: true });
  let file = `${name}.png`;
  let image = await page.screenshot({ type: "png", animations: "disabled" });
  if (image.length > MAX_BYTES) {
    file = `${name}.jpg`;
    image = await page.screenshot({ type: "jpeg", quality: 80, animations: "disabled" });
  }
  const kb = Math.round(image.length / 1000);
  if (image.length > MAX_BYTES) throw new Error(`${name} is ${kb} KB even as JPEG`);
  await writeFile(path.join(OUT, file), image);
  console.log(`wrote docs/images/${file} (${kb} KB)`);
}

async function openHome(browser, theme) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: theme,
  });
  // Keep these visits out of the site's analytics (Umami is served under /stats/).
  await context.route(`${SITE}/stats/**`, (route) => route.abort());
  // The site ignores the OS scheme (next-themes with enableSystem off); its toggle stores the
  // choice under "theme", so set that too.
  await context.addInitScript((value) => window.localStorage.setItem("theme", value), theme);
  const page = await context.newPage();
  await page.goto(SITE, { waitUntil: "networkidle", timeout: 30_000 });
  await page
    .getByRole("heading", { level: 1, name: "Christopher Guzman" })
    .waitFor({ timeout: 15_000 });
  await page.waitForFunction((value) => document.documentElement.classList.contains(value), theme);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  return { context, page };
}

// Returns null once the panel is open, or why it could not be opened.
async function openChat(page) {
  const panel = page.getByRole("region", { name: "Ask about Chris" });
  const launcher = page.getByRole("button", { name: /Ask about Chris/ }).first();
  const deadline = Date.now() + CHAT_TIMEOUT;
  // The launcher's click and ⌘K handlers attach only after hydration, so keep trying.
  while (Date.now() < deadline) {
    if (await launcher.isVisible()) await launcher.click();
    else await page.keyboard.press("ControlOrMeta+k");
    try {
      await panel.waitFor({ state: "visible", timeout: 1_000 });
      return null;
    } catch {
      // not open yet
    }
  }
  return (await launcher.count())
    ? "the chat panel was not visible within 10 s"
    : 'no "Ask about Chris" launcher on the page (chat switched off in Directus?)';
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const theme of ["light", "dark"]) {
    const { context, page } = await openHome(browser, theme);
    await save(page, `home-${theme}`);
    if (theme === "dark") {
      const skipped = await openChat(page);
      if (skipped) {
        console.log(`skipped chat.png: ${skipped}`);
      } else {
        await page.waitForTimeout(1_500); // let the panel's Turnstile widget render
        await save(page, "chat");
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}
