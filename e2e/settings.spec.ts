import { expect, test } from "@playwright/test";
import { FIXTURE_ID, FIXTURE_SHA256, readFixtureManifest } from "./fixtures/isolated-fixture";

test("uses a versioned SQL fixture copied outside the repository database paths", async ({ page }) => {
  await page.goto("/?e2e=fixture");
  const manifestPath = await page.evaluate(() => window.__E2E__.fixtureManifestPath);
  const manifest = await readFixtureManifest(manifestPath);
  expect(manifest.fixtureId).toBe(FIXTURE_ID);
  expect(manifest.sourceSha256).toBe(FIXTURE_SHA256);
  expect(manifest.sourcePath).toContain("e2e/fixtures/opencode-fixture.sql");
  expect(manifest.isolatedSqlPath).not.toContain("opencode.db");
  await expect.poll(() => page.evaluate(() => window.__E2E__.fixtureId)).toBe(FIXTURE_ID);
  await expect.poll(() => page.evaluate(() => window.__E2E__.fixtureSha256)).toBe(FIXTURE_SHA256);
  await expect.poll(() => page.evaluate(() => window.__E2E__.fixtureSqlPath)).toBe(manifest.isolatedSqlPath);
  await expect.poll(() => page.evaluate(() => window.__E2E__.fixtureSnapshotPath)).toBe(manifest.snapshotPath);
  expect(await page.evaluate(() => window.__E2E__.fixtureSnapshotSessionCount)).toBe(2);
  expect(await page.evaluate(() => window.__E2E__.fixtureSnapshotBoundaryDate)).toBe(Date.parse(manifest.boundaryDate));
  expect(await page.evaluate(() => window.__E2E__.fixtureSnapshotBoundaryCost)).toBe(manifest.boundaryCost);
  const boundaryDate = manifest.boundaryDate.slice(0, 10);
  await page.locator("#filter-start-date").fill(boundaryDate);
  await page.locator("#filter-end-date").fill(boundaryDate);
  await expect(page.getByLabel(/Input.*1.*000.*Output.*200.*Cache R.*30.*Cache W.*4.*Reason.*5/)).toBeVisible();
  await expect(page.getByRole("cell", { name: manifest.boundaryTitle })).toBeVisible();
});

test("starts without persisted settings in isolated demo mode", async ({ page }) => {
  await page.goto("/?e2e=no-settings");
  expect(await page.evaluate(() => localStorage.getItem("opencode-costs-viewer:data-mode"))).toBeNull();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await expect(page.getByRole("button", { name: "Réglages" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("displays invalid settings diagnostics and translates backend errors", async ({ page }) => {
  await page.goto("/?e2e=settings-invalid");
  await expect(page.getByRole("alert")).toContainText("Les réglages sont invalides");
  await expect(page.getByRole("alert")).toContainText("defaultPeriodDays");
});

test("persists defaultPeriodDays and keeps the end date inclusive", async ({ page }) => {
  await page.goto("/?e2e=settings-period");
  const manifestPath = await page.evaluate(() => window.__E2E__.fixtureManifestPath);
  const manifest = await readFixtureManifest(manifestPath);
  await page.getByRole("button", { name: "Réglages" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Période par défaut en jours").fill("7");
  await dialog.getByRole("button", { name: "Enregistrer" }).click();

  await page.getByRole("button", { name: "Réglages" }).click();
  await expect(page.getByRole("dialog").getByLabel("Période par défaut en jours")).toHaveValue("7");
  await page.getByRole("button", { name: "Fermer les réglages" }).click();

  const boundary = Date.parse(manifest.boundaryDate.slice(0, 10));
  const fixtureStart = new Date(boundary - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const fixtureEnd = manifest.boundaryDate.slice(0, 10);
  await page.locator("#filter-start-date").fill(fixtureStart);
  await page.locator("#filter-end-date").fill(fixtureEnd);
  expect(Date.parse(`${fixtureEnd}T00:00:00Z`) - Date.parse(`${fixtureStart}T00:00:00Z`)).toBe(6 * 24 * 60 * 60 * 1000);
  await expect(page.getByRole("cell", { name: "Boundary fixture session" })).toBeVisible();
});

test("falls back to a 30-day period after an invalid UI value", async ({ page }) => {
  await page.goto("/?e2e=settings-period-invalid");
  await page.getByRole("button", { name: "Réglages" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Période par défaut en jours").fill("0");
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await page.getByRole("button", { name: "Réglages" }).click();
  await expect(page.getByRole("dialog").getByLabel("Période par défaut en jours")).toHaveValue("30");
});

test("changes the database path without touching a real opencode database", async ({ page }) => {
  await page.goto("/?e2e=db-path");
  await page.getByRole("button", { name: "Réglages" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Chemin base de données").fill("/fixtures/alternate.db");
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect.poll(() => page.evaluate(() => window.__E2E__.reloadCount)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__E2E__.dbPath)).toBe("/fixtures/alternate.db");
  await expect(page.evaluate(() => window.__E2E__.dbPath)).not.toBe("/demo/opencode.db");
  await expect(page.getByRole("cell", { name: "Alternate SQLite fixture session" })).toBeVisible();
});
