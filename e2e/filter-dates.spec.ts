// Verifies dashboard date filters in the browser-based application.
import { expect, test } from "@playwright/test";
import { readFixtureManifest } from "./fixtures/isolated-fixture";

test("filters by an inclusive local date range", async ({ page }) => {
  await page.goto("/?e2e=dates");
  const manifestPath = await page.evaluate(() => window.__E2E__.fixtureManifestPath);
  const manifest = await readFixtureManifest(manifestPath);
  const boundaryDate = manifest.boundaryDate.slice(0, 10);
  await page.locator("#filter-start-date").fill(boundaryDate);
  await page.locator("#filter-end-date").fill(boundaryDate);

  await expect(page.getByRole("cell", { name: "Boundary fixture session" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Outside fixture session" })).toBeHidden();
});

test("refreshes the dashboard after recalculation and marks the audit stale", async ({ page }) => {
  await page.goto("/?e2e=recalculation");
  await page.getByRole("button", { name: "Audit des coûts" }).click();
  await page.getByRole("button", { name: "Actualiser l’audit" }).click();
  await expect(page.getByRole("heading", { name: "Résumé" })).toBeVisible();
  await page.getByRole("button", { name: "← Retour au tableau de bord" }).click();

  await page.getByRole("button", { name: "Tarifs des modèles" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Recalculer les coûts" }).click();
  await dialog.getByRole("button", { name: "Confirmer le recalcul" }).click();
  await expect(page.getByText("Recalcul terminé pour")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Recalculated fixture session" })).toBeVisible();

  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByRole("button", { name: "Audit des coûts" }).click();
  await expect(page.getByText("Audit obsolète")).toBeVisible();
});
