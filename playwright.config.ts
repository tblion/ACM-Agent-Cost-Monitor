import { defineConfig } from "@playwright/test";

if (!process.env.E2E_PORT) throw new Error("E2E_PORT is required; use npm run test:e2e or set it explicitly");
const port = Number(process.env.E2E_PORT);
const reportDir = process.env.E2E_REPORT_DIR ?? "playwright-report";
const testResultsDir = process.env.E2E_TEST_RESULTS_DIR ?? "test-results";
const workers = Number(process.env.E2E_WORKERS ?? 1);
const webServerCommand = process.platform === "win32" ? "node e2e/start-mock.mjs" : "exec node e2e/start-mock.mjs";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["**/electron-app.spec.ts"],
  outputDir: testResultsDir,
  fullyParallel: false,
  workers,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: reportDir, open: "never" }]]
    : [["list"], ["html", { outputFolder: reportDir, open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    headless: true,
    locale: "fr-FR",
    trace: "retain-on-failure",
  },
  webServer: {
    command: webServerCommand,
    url: `http://127.0.0.1:${port}`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
