import { defineConfig, devices } from "@playwright/test";

import serverEnv from "./e2e/server-env.json";

const backend = "http://127.0.0.1:3101";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    {
      command: "node e2e/fake-backend.mjs",
      url: `${backend}/v1/status`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "bash e2e/serve.sh",
      url: "http://127.0.0.1:3100/api/healthz",
      reuseExistingServer: !process.env.CI,
      // Shared with scripts/lighthouse-ci.mjs --serve.
      env: serverEnv,
    },
  ],
});
