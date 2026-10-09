// Configures Playwright scenarios that launch the Electron application.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "electron-app.spec.ts",
  outputDir: process.env.E2E_TEST_RESULTS_DIR ?? "test-results/electron",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    locale: "fr-FR",
    trace: "retain-on-failure",
  },
});
