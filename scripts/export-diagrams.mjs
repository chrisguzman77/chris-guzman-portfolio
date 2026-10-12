// scripts/export-diagrams.mjs: render content/diagrams/*.svg to 2x PNG for upload to Directus.
// Run from the repo root: node scripts/export-diagrams.mjs
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const dir = new URL("../content/diagrams/", import.meta.url);
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
for (const name of (await readdir(dir)).filter((f) => f.endsWith(".svg")).sort()) {
  const svg = await readFile(new URL(name, dir), "utf8");
  const [, w, h] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg) ?? [];
  if (!w) throw new Error(`${name}: viewBox must be "0 0 W H"`);
  await page.setViewportSize({ width: Number(w), height: Number(h) });
  await page.setContent(`<style>html,body{margin:0}svg{display:block}</style>${svg}`);
  const out = new URL(name.replace(/\.svg$/, ".png"), dir);
  await page.locator("svg").screenshot({ path: out.pathname });
  console.log(`${name} -> ${out.pathname.split("/").pop()} (${w * 2}x${h * 2})`);
}
await browser.close();
