// Verifies live database refresh and watcher state through the browser UI.
import { expect, test } from "@playwright/test";

test.describe("live mode", () => {
  test("activates, reloads after a database fixture change, and deactivates", async ({ page }) => {
    await page.goto("/?e2e=live");
    const live = page.getByRole("button", { name: /Mode live|Réactiver le mode live/ });
    await page.getByRole("button", { name: "Réglages" }).click();
    await page.getByRole("button", { name: "Fermer les réglages" }).click();

    const realLive = page.getByRole("button", { name: /Mode live|Réactiver le mode live/ });
    await realLive.click();
    await expect(realLive).toHaveAttribute("aria-pressed", "true");

    await page.evaluate(() => window.__E2E__.mutateSql());
    await expect(page.getByRole("cell", { name: "Live SQL inserted session" })).toBeVisible();

    await realLive.click();
    await expect(realLive).toHaveAttribute("aria-pressed", "false");
  });

  test("reports a translated backend error when live settings cannot be saved", async ({ page }) => {
    await page.goto("/?e2e=live-save-error");
    await page.getByRole("button", { name: "Réglages" }).click();
    await page.getByRole("button", { name: "Fermer les réglages" }).click();
    const live = page.getByRole("button", { name: /Mode live|Réactiver le mode live/ });
    await live.click();
    await expect(page.getByRole("alert")).toContainText("Erreur du mode live");
  });
});
