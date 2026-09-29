import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.e2e.ts",
  workers: 1,
  retries: 0,
  timeout: 120_000,
  globalSetup: "./e2e/global-setup.ts",
  reporter: "list",
  outputDir: ".playwright-results",
  use: {
    browserName: "chromium",
    channel: process.env.E2E_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : "chromium"),
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
});
