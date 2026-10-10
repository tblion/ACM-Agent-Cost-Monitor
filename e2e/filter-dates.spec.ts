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

test("includes whole multi-day sessions by default and can restrict totals to messages in range", async ({ page }) => {
  await page.goto("/?e2e=dates");
  const manifestPath = await page.evaluate(() => window.__E2E__.fixtureManifestPath);
  const manifest = await readFixtureManifest(manifestPath);
  const boundaryDate = manifest.boundaryDate.slice(0, 10);
  await page.locator("#filter-start-date").fill(boundaryDate);
  await page.locator("#filter-end-date").fill(boundaryDate);

  const includeWholeSessions = page.getByRole("checkbox", { name: "Inclure les sessions entières" });
  const sessionRow = page.getByRole("row", { name: /Boundary fixture session/ });
  await expect(includeWholeSessions).toBeChecked();
  await expect(sessionRow).toBeVisible();
  const fullSessionCost = await sessionRow.locator("td").nth(3).innerText();

  await includeWholeSessions.uncheck();

  const periodMessageCost = await sessionRow.locator("td").nth(3).innerText();
  expect(periodMessageCost).not.toBe(fullSessionCost);
});

test("selects a complete local calendar month from the period presets", async ({ page }) => {
  await page.goto("/?e2e=dates");
  await page.locator("#filter-date-preset").selectOption("thisMonth");

  const range = await page.evaluate(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const format = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { start: format(start), end: format(end) };
  });

  await expect(page.locator("#filter-start-date")).toHaveValue(range.start);
  await expect(page.locator("#filter-end-date")).toHaveValue(range.end);
});

test("keeps every date preset aligned to local calendar boundaries", async ({ page }) => {
  await page.clock.install({ time: new Date(2024, 1, 29, 12) });
  await page.goto("/?e2e=dates");

  const presets = ["today", "yesterday", "last7Days", "thisWeek", "last30Days", "thisMonth", "lastMonth", "thisYear", "allTime"];
  for (const preset of presets) {
    const expected = await page.evaluate((selectedPreset) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let start: Date | null = null;
      let end: Date | null = null;
      const shift = (date: Date, days: number) => {
        const shifted = new Date(date);
        shifted.setDate(shifted.getDate() + days);
        return shifted;
      };
      switch (selectedPreset) {
        case "today": start = today; end = today; break;
        case "yesterday": start = shift(today, -1); end = start; break;
        case "last7Days": start = shift(today, -6); end = today; break;
        case "thisWeek": {
          start = shift(today, -((today.getDay() + 6) % 7));
          end = shift(start, 6);
          break;
        }
        case "last30Days": start = shift(today, -29); end = today; break;
        case "thisMonth": start = new Date(today.getFullYear(), today.getMonth(), 1); end = new Date(today.getFullYear(), today.getMonth() + 1, 0); break;
        case "lastMonth": start = new Date(today.getFullYear(), today.getMonth() - 1, 1); end = new Date(today.getFullYear(), today.getMonth(), 0); break;
        case "thisYear": start = new Date(today.getFullYear(), 0, 1); end = new Date(today.getFullYear(), 11, 31); break;
        case "allTime": break;
      }
      const format = (date: Date | null) => date && `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      return { from: format(start), to: format(end) };
    }, preset);

    await page.locator("#filter-date-preset").selectOption(preset);
    await expect(page.locator("#filter-start-date")).toHaveValue(expected.from ?? "");
    await expect(page.locator("#filter-end-date")).toHaveValue(expected.to ?? "");
  }
});

test("adjusts the opposite custom date when a range becomes inverted", async ({ page }) => {
  await page.goto("/?e2e=dates");
  await page.locator("#filter-start-date").fill("2026-01-10");
  await page.locator("#filter-end-date").fill("2026-01-20");
  await page.locator("#filter-start-date").fill("2026-01-22");

  await expect(page.locator("#filter-date-preset")).toHaveValue("custom");
  await expect(page.locator("#filter-end-date")).toHaveValue("2026-01-22");

  await page.locator("#filter-end-date").fill("2026-01-19");
  await expect(page.locator("#filter-start-date")).toHaveValue("2026-01-19");
});

test("resolves the previous month across a year boundary", async ({ page }) => {
  await page.clock.install({ time: new Date(2025, 0, 15, 12) });
  await page.goto("/?e2e=dates");
  await page.locator("#filter-date-preset").selectOption("lastMonth");

  await expect(page.locator("#filter-start-date")).toHaveValue("2024-12-01");
  await expect(page.locator("#filter-end-date")).toHaveValue("2024-12-31");
});

test("refreshes a selected current-month preset at local midnight", async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 9, 31, 23, 59, 50) });
  await page.goto("/?e2e=dates");
  await page.locator("#filter-date-preset").selectOption("thisMonth");
  await expect(page.locator("#filter-start-date")).toHaveValue("2026-10-01");
  await expect(page.locator("#filter-end-date")).toHaveValue("2026-10-31");

  await page.clock.fastForward(15_000);

  await expect(page.locator("#filter-start-date")).toHaveValue("2026-11-01");
  await expect(page.locator("#filter-end-date")).toHaveValue("2026-11-30");
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
