// Lighthouse soft gate: mobile performance score, median of 3 runs per route; fails below 85.
//   pnpm perf:lighthouse          against a server already on 127.0.0.1:3100
//   pnpm perf:lighthouse --serve  starts the standalone build and the fake backend first, the
//                                 way playwright.config.ts does (run `pnpm build` before)
import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { chromium } from "@playwright/test";

import { report, summarizeLighthouse } from "./perf-lib.mjs";

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "http://127.0.0.1:3100";
const BACKEND = "http://127.0.0.1:3101";
const ROUTES = ["/", "/blog", "/blog/hello-world"];
const RUNS = 3;
const THRESHOLD = 85;

async function isUp(url) {
  return fetch(url, { signal: AbortSignal.timeout(2000) }).then(
    (res) => res.ok,
    () => false,
  );
}

async function waitFor(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server for ${url} exited (${child.exitCode})`);
    if (await isUp(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function startServers() {
  if ((await isUp(`${BASE}/api/healthz`)) || (await isUp(`${BACKEND}/v1/status`))) {
    throw new Error("port 3100 or 3101 is already in use; stop it, or run without --serve");
  }
  const env = JSON.parse(readFileSync(path.join(APP, "e2e/server-env.json"), "utf8"));
  const opts = { cwd: APP, stdio: ["ignore", "ignore", "inherit"] };
  const backend = spawn("node", ["e2e/fake-backend.mjs"], opts);
  const web = spawn("bash", ["e2e/serve.sh"], { ...opts, env: { ...process.env, ...env } });
  const stop = () => [backend, web].forEach((child) => child.kill());
  try {
    await waitFor(`${BACKEND}/v1/status`, backend);
    await waitFor(`${BASE}/api/healthz`, web);
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}

// Lighthouse's default config is mobile (Moto G Power, simulated slow 4G and 4x CPU slowdown).
async function lighthouse(url) {
  const { stdout } = await promisify(execFile)(
    path.join(APP, "node_modules/.bin/lighthouse"),
    [
      url,
      "--only-categories=performance",
      "--output=json",
      "--output-path=stdout",
      "--quiet",
      "--chrome-flags=--headless=new --no-sandbox",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const lhr = JSON.parse(stdout);
  if (lhr.runtimeError || lhr.categories.performance.score === null) {
    throw new Error(`lighthouse failed on ${url}: ${lhr.runtimeError?.message ?? "no score"}`);
  }
  return {
    score: Math.round(lhr.categories.performance.score * 100),
    lcp: lhr.audits["largest-contentful-paint"].numericValue,
    tbt: lhr.audits["total-blocking-time"].numericValue,
    cpu: lhr.environment.benchmarkIndex,
  };
}

async function main() {
  // Playwright's Chromium, already installed for the e2e suite.
  process.env.CHROME_PATH ??= chromium.executablePath();

  const stop = process.argv.includes("--serve") ? await startServers() : () => {};
  try {
    // A cold server loads route code and fills its data cache on the first request, on the same
    // CPU as Chrome. Scored cold, the home page dropped from 95 to the 70s (TBT ~800 ms).
    for (const route of ROUTES) {
      const res = await fetch(`${BASE}${route}`);
      if (!res.ok) throw new Error(`warm-up ${route}: HTTP ${res.status}`);
      await res.arrayBuffer();
    }
    const runs = {};
    for (const route of ROUTES) {
      runs[route] = [];
      for (let i = 0; i < RUNS; i++) runs[route].push(await lighthouse(`${BASE}${route}`));
    }
    const { rows, failures } = summarizeLighthouse(runs, THRESHOLD);
    report(
      `Lighthouse mobile performance (median of ${RUNS}; fails below ${THRESHOLD})`,
      ["route", "score", "runs", "LCP", "TBT", "CPU benchmark (median)"],
      rows.map((r) => [
        r.route,
        String(r.score),
        r.scores.join(", "),
        `${(r.lcp / 1000).toFixed(2)} s`,
        `${Math.round(r.tbt)} ms`,
        String(Math.round(r.cpu)),
      ]),
    );
    if (failures.length) {
      console.error(failures.join("\n"));
      process.exitCode = 1;
    }
  } finally {
    stop();
  }
}

await main();
