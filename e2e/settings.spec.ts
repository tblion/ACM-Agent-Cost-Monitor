// Verifies settings and data-mode workflows in the browser application.
import { expect, test } from "@playwright/test";
import { FIXTURE_ID, FIXTURE_SHA256, readFixtureManifest } from "./fixtures/isolated-fixture";

test("keeps the primary navigation collapsible on desktop and compact on narrow windows", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?e2e=fixture");
  const sidebar = page.locator(".app-sidebar");
  await expect(sidebar).not.toHaveClass(/is-collapsed/);
  await page.getByRole("button", { name: "Replier la navigation" }).click();
  await expect(sidebar).toHaveClass(/is-collapsed/);
  await expect(page.getByRole("button", { name: "Déployer la navigation" })).toBeVisible();

  await page.setViewportSize({ width: 640, height: 900 });
  await page.reload();
  await expect(sidebar).toHaveClass(/is-collapsed/);
  await page.getByRole("button", { name: "Déployer la navigation" }).click();
  await expect(sidebar).not.toHaveClass(/is-collapsed/);
  await expect(sidebar).toHaveCSS("position", "absolute");
});

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

test("round-trips versioned custom rates through the settings API and rejects invalid rates", async ({ page }) => {
  await page.goto("/?e2e=settings-pricing-api");
  const customRate = {
    id: "manual-rate-2026",
    provider: "fixture-provider",
    model: "fixture-model",
    input: 0.25,
    output: 1.5,
    cacheRead: 0.1,
    cacheWrite: 0.3,
    effectiveFrom: "2026-01-01T00:00:00Z",
    source: "manual",
  };
  const result = await page.evaluate(async rate => {
    const api = await import("/src/api.ts");
    const settings = await api.getSettings();
    await api.saveSettings({ ...settings, customRates: [rate] });
    return api.getSettings();
  }, customRate);
  expect(result.customRates).toEqual([customRate]);

  await expect(page.evaluate(async rate => {
    const api = await import("/src/api.ts");
    const settings = await api.getSettings();
    return api.saveSettings({ ...settings, customRates: [{ ...rate, input: -1 }] });
  }, customRate)).rejects.toThrow();
});

test("persists defaultPeriodDays and keeps the end date inclusive", async ({ page }) => {
  await page.goto("/?e2e=settings-period");
  const manifestPath = await page.evaluate(() => window.__E2E__.fixtureManifestPath);
  const manifest = await readFixtureManifest(manifestPath);
  await page.getByRole("button", { name: "Réglages" }).click();
  const settingsPage = page.locator(".settings-page");
  await settingsPage.getByLabel("Période par défaut en jours").fill("7");
  await settingsPage.getByRole("button", { name: "Enregistrer" }).click();

  await page.getByRole("button", { name: "Réglages" }).click();
  await expect(page.locator(".settings-page").getByLabel("Période par défaut en jours")).toHaveValue("7");
  await page.locator(".settings-page").getByRole("button", { name: "Retour au tableau de bord" }).click();

  const boundary = Date.parse(manifest.boundaryDate.slice(0, 10));
  const fixtureStart = new Date(boundary - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const fixtureEnd = manifest.boundaryDate.slice(0, 10);
  await page.locator("#filter-start-date").fill(fixtureStart);
  await page.locator("#filter-end-date").fill(fixtureEnd);
  expect(Date.parse(`${fixtureEnd}T00:00:00Z`) - Date.parse(`${fixtureStart}T00:00:00Z`)).toBe(6 * 24 * 60 * 60 * 1000);
  await expect(page.getByRole("cell", { name: "Boundary fixture session" })).toBeVisible();
});

test("shows one settings section at a time and keeps unsaved edits while switching sections", async ({ page }) => {
  await page.goto("/?e2e=settings-sections");
  await page.getByRole("button", { name: "Réglages" }).click();
  const settingsPage = page.locator(".settings-page");
  const defaultPeriod = settingsPage.getByLabel("Période par défaut en jours");
  await defaultPeriod.fill("17");
  await settingsPage.getByRole("button", { name: "Sources et données" }).click();
  await expect(settingsPage.getByLabel("Chemin base de données")).toBeVisible();
  await expect(defaultPeriod).toBeHidden();
  await settingsPage.getByRole("button", { name: "Général" }).click();
  await expect(defaultPeriod).toHaveValue("17");
  await settingsPage.getByRole("button", { name: "Annuler" }).click();
});

test("manages usage rates and subscriptions inside the pricing settings section", async ({ page }) => {
  await page.goto("/?e2e=settings-tools");
  await page.getByRole("button", { name: "Réglages" }).click();
  const settingsPage = page.locator(".settings-page");
  const defaultPeriod = settingsPage.getByLabel("Période par défaut en jours");
  await defaultPeriod.fill("17");

  await settingsPage.getByRole("button", { name: "Tarifs" }).click();
  await expect(settingsPage.getByRole("button", { name: "Tarifs à l’usage" })).toBeVisible();
  await expect(settingsPage.getByRole("button", { name: "Abonnements" })).toBeVisible();
  await settingsPage.getByRole("button", { name: "Tarifs à l’usage" }).click();
  await expect(settingsPage.getByRole("heading", { name: "Tarifs à l’usage" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const rateSearch = settingsPage.getByRole("searchbox", { name: "Rechercher un fournisseur ou un modèle" });
  await rateSearch.fill("aucun-modele-correspondant");
  await expect(settingsPage.getByRole("status").filter({ hasText: "Aucun tarif ne correspond à cette recherche." })).toBeVisible();
  await rateSearch.fill("");
  await settingsPage.getByRole("button", { name: "Général" }).click();
  await expect(defaultPeriod).toHaveValue("17");
  await settingsPage.getByRole("button", { name: "Tarifs" }).click();
  await settingsPage.getByRole("button", { name: "Abonnements" }).click();
  await expect(settingsPage.getByRole("heading", { name: "Abonnements" })).toBeVisible();
  await expect(settingsPage.getByRole("heading", { name: "Forfaits fixes" })).toBeVisible();

  await settingsPage.getByRole("button", { name: "Audit des coûts" }).click();
  await expect(page.getByRole("main", { name: "Audit des coûts" })).toBeVisible();
  await page.getByRole("button", { name: "← Retour aux réglages" }).click();
  await expect(settingsPage).toBeVisible();
  await settingsPage.getByRole("button", { name: "Général" }).click();
  await expect(defaultPeriod).toHaveValue("17");
  await settingsPage.getByRole("button", { name: "Annuler" }).click();
});

test("creates dated custom model rates and preserves each pricing version", async ({ page }) => {
  await page.goto("/?e2e=pricing-editor");
  await page.getByRole("button", { name: "Réglages" }).click();
  const settingsPage = page.locator(".settings-page");
  await settingsPage.getByRole("button", { name: "Tarifs" }).click();
  await settingsPage.getByRole("button", { name: "Tarifs à l’usage" }).click();
  await settingsPage.getByRole("button", { name: "Ajouter un tarif personnalisé" }).click();
  await settingsPage.getByRole("textbox", { name: "Fournisseur", exact: true }).fill("manual-provider");
  await settingsPage.getByLabel("Identifiant exact du modèle").fill("custom-model-x");
  await settingsPage.getByLabel("Tarif input par million de tokens").fill("0");
  await settingsPage.getByLabel("Tarif output par million de tokens").fill("1.25");
  await settingsPage.getByLabel("Tarif cache read par million de tokens").fill("0");
  await settingsPage.getByLabel("Tarif cache write par million de tokens").fill("0.4");
  await settingsPage.getByLabel("Date d’effet").fill("2026-01-01");
  await settingsPage.getByRole("button", { name: "Enregistrer cette version" }).click();
  await expect(settingsPage.locator(".custom-rate-entry").filter({ hasText: "custom-model-x" })).toBeVisible();

  await settingsPage.getByRole("button", { name: "Nouvelle version de manual-provider/custom-model-x" }).click();
  await settingsPage.getByLabel("Tarif input par million de tokens").fill("3");
  await settingsPage.getByLabel("Date d’effet").fill("2026-06-01");
  await settingsPage.getByRole("button", { name: "Enregistrer cette version" }).click();
  await expect(settingsPage.getByText("2 versions", { exact: true })).toBeVisible();
  await settingsPage.getByRole("button", { name: "Abonnements" }).click();
  await settingsPage.getByRole("button", { name: "+ Ajouter un forfait" }).click();
  const subscriptionForms = settingsPage.locator("fieldset");
  await subscriptionForms.nth(0).getByRole("textbox", { name: "Provider (identifiant exact)", exact: true }).fill("manual-sub-provider");
  await subscriptionForms.nth(0).getByRole("spinbutton", { name: "Montant payé (USD)" }).fill("10");
  await subscriptionForms.nth(0).getByRole("textbox", { name: "Actif depuis" }).fill("2025-01-01");
  await subscriptionForms.nth(0).locator("textarea").fill("custom-model-x");
  await settingsPage.getByRole("button", { name: "Créer une nouvelle version du forfait manual-sub-provider" }).click();
  await subscriptionForms.nth(1).getByRole("spinbutton", { name: "Montant payé (USD)" }).fill("20");
  await expect(settingsPage.getByText("Le montant payé est votre dépense réelle.")).toBeVisible();
  await settingsPage.getByRole("button", { name: "Enregistrer" }).click();

  await page.getByRole("button", { name: "Réglages" }).click();
  await settingsPage.getByRole("button", { name: "Tarifs" }).click();
  await settingsPage.getByRole("button", { name: "Abonnements" }).click();
  const savedSubscriptions = settingsPage.locator("fieldset");
  await expect(savedSubscriptions.nth(0).getByRole("spinbutton", { name: "Montant payé (USD)" })).toHaveValue("10");
  await expect(savedSubscriptions.nth(1).getByRole("spinbutton", { name: "Montant payé (USD)" })).toHaveValue("20");
  await expect(savedSubscriptions.nth(0).getByRole("spinbutton", { name: "Montant payé (USD)" })).toBeDisabled();
  await expect(savedSubscriptions.nth(0).getByRole("button", { name: "Créer une nouvelle version du forfait manual-sub-provider" })).toBeEnabled();
  const newSubscriptionStart = await savedSubscriptions.nth(1).getByRole("textbox", { name: "Actif depuis" }).inputValue();
  const previousPeriodEnd = await savedSubscriptions.nth(0).getByRole("textbox", { name: "Actif jusqu'au (facultatif)" }).inputValue();
  expect(Date.parse(`${previousPeriodEnd}T00:00:00Z`)).toBe(Date.parse(`${newSubscriptionStart}T00:00:00Z`) - 86_400_000);

  await settingsPage.getByRole("button", { name: "Tarifs à l’usage" }).click();
  await expect(settingsPage.getByText("2026-01-01T00:00:00Z")).toBeVisible();
  await expect(settingsPage.getByText("2026-06-01T00:00:00Z")).toBeVisible();
});

test("compares pricing sources and applies only the explicitly confirmed candidate", async ({ page }) => {
  await page.goto("/?e2e=pricing-comparison");
  await page.getByRole("button", { name: "Réglages" }).click();
  const settingsPage = page.locator(".settings-page");
  await settingsPage.getByRole("button", { name: "Tarifs" }).click();
  await settingsPage.getByRole("button", { name: "Tarifs à l’usage" }).click();

  await settingsPage.getByRole("button", { name: "Comparer les sources de tarifs" }).click();
  await expect(settingsPage.getByRole("heading", { name: "Comparer avec les sources publiques" })).toBeVisible();
  await expect(settingsPage).toContainText("OpenAI (official)");
  await expect(settingsPage).toContainText("LiteLLM (community-maintained)");
  await expect(settingsPage).toContainText("Désaccord sur le tarif");
  await expect(settingsPage.getByRole("link", { name: "Consulter OpenAI (official)" })).toHaveAttribute("href", "https://developers.openai.com/api/docs/pricing");

  const candidate = settingsPage.getByRole("checkbox", { name: /Sélectionner.*OpenAI.*gpt-4.1/ }).first();
  await candidate.check();
  await settingsPage.getByRole("button", { name: "Appliquer la sélection" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Confirmer le tarif à appliquer" });
  await expect(confirmation).toContainText("Actuel");
  await expect(confirmation).toContainText("Proposé");
  await confirmation.getByRole("button", { name: "Annuler" }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.evaluate(async () => {
    const api = await import("/src/api.ts");
    return (await api.getSettings()).customRates;
  })).resolves.toEqual([]);

  await candidate.check();
  await settingsPage.getByRole("button", { name: "Appliquer la sélection" }).click();
  await page.getByRole("alertdialog", { name: "Confirmer le tarif à appliquer" })
    .getByRole("button", { name: "Confirmer l’application" }).click();
  await expect(settingsPage.getByRole("status")).toContainText("Tarif appliqué");
  await expect(page.evaluate(async () => {
    const api = await import("/src/api.ts");
    return (await api.getSettings()).customRates;
  }))
    .resolves.toEqual([expect.objectContaining({ provider: "OpenAI", model: "gpt-4.1", input: 2.1, output: 8.2 })]);
});

test("compares public subscription prices without changing the amount actually paid", async ({ page }) => {
  await page.goto("/?e2e=subscription-comparison");
  await page.getByRole("button", { name: "Réglages" }).click();
  const settingsPage = page.locator(".settings-page");
  await settingsPage.getByRole("button", { name: "Tarifs" }).click();
  await settingsPage.getByRole("button", { name: "Abonnements" }).click();

  await expect(settingsPage.getByRole("textbox", { name: "Formule ou offre" })).toHaveValue("Plus");
  await expect(settingsPage.getByRole("spinbutton", { name: "Montant payé (USD)" })).toHaveValue("30");
  await settingsPage.getByRole("button", { name: "Comparer les prix publics" }).click();
  const comparison = settingsPage.getByRole("region", { name: "Comparaison des offres publiques" });
  await expect(comparison).toContainText("OpenAI (official)");
  await expect(comparison).toContainText("20 USD / monthly");
  await expect(comparison).toContainText("Taxes non précisées");
  await expect(comparison).toContainText(/région non précisée/i);
  await expect(settingsPage.getByRole("spinbutton", { name: "Montant payé (USD)" })).toHaveValue("30");
  await expect(comparison.getByRole("button", { name: /Appliquer|Remplacer/ })).toHaveCount(0);
  await expect(page.evaluate(async () => {
    const api = await import("/src/api.ts");
    return (await api.getSettings()).fixedSubscriptions[0].amount;
  })).resolves.toBe(30);
});

test("creates a new version from a catalog rate and can restore that reference", async ({ page }) => {
  await page.goto("/?e2e=catalog-rate-editor");
  const reference = await page.evaluate(async () => (await (await import("/src/api.ts")).getCatalogRates())[0]);
  expect(reference).toBeTruthy();
  await page.getByRole("button", { name: "Réglages" }).click();
  const settingsPage = page.locator(".settings-page");
  await settingsPage.getByRole("button", { name: "Tarifs" }).click();
  const referenceEntry = settingsPage.locator(".catalog-rate-entry").filter({ hasText: reference.model });
  await referenceEntry.getByRole("button", { name: `Personnaliser le tarif catalogue de ${reference.provider}/${reference.model}` }).click();
  await settingsPage.getByLabel("Tarif input par million de tokens").fill("7");
  await settingsPage.getByLabel("Date d’effet").fill("2026-01-01");
  await settingsPage.getByRole("button", { name: "Enregistrer cette version" }).click();
  const customEntry = settingsPage.locator(".custom-rate-entry").filter({ hasText: reference.model });
  await customEntry.getByRole("button", { name: "Revenir à la référence catalogue" }).click();
  await expect(customEntry).toContainText("Référence catalogue");
  await settingsPage.getByRole("button", { name: "Enregistrer" }).click();

  await page.getByRole("button", { name: "Réglages" }).click();
  await page.locator(".settings-page").getByRole("button", { name: "Tarifs" }).click();
  await expect(page.locator(".settings-page").locator(".custom-rate-entry").filter({ hasText: reference.model })).toContainText("Référence catalogue");
});

test("falls back to a 30-day period after an invalid UI value", async ({ page }) => {
  await page.goto("/?e2e=settings-period-invalid");
  await page.getByRole("button", { name: "Réglages" }).click();
  const settingsPage = page.locator(".settings-page");
  await settingsPage.getByLabel("Période par défaut en jours").fill("0");
  await settingsPage.getByRole("button", { name: "Enregistrer" }).click();
  await page.getByRole("button", { name: "Réglages" }).click();
  await expect(page.locator(".settings-page").getByLabel("Période par défaut en jours")).toHaveValue("30");
});

test("changes the database path without touching a real opencode database", async ({ page }) => {
  await page.goto("/?e2e=db-path");
  await page.getByRole("button", { name: "Réglages" }).click();
  const settingsPage = page.locator(".settings-page");
  await settingsPage.getByRole("button", { name: "Sources et données" }).click();
  await settingsPage.getByLabel("Chemin base de données").fill("/fixtures/alternate.db");
  await settingsPage.getByRole("button", { name: "Enregistrer" }).click();
  await expect.poll(() => page.evaluate(() => window.__E2E__.reloadCount)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__E2E__.dbPath)).toBe("/fixtures/alternate.db");
  await expect(page.evaluate(() => window.__E2E__.dbPath)).not.toBe("/demo/opencode.db");
  await expect(page.getByRole("cell", { name: "Alternate SQLite fixture session" })).toBeVisible();
});
