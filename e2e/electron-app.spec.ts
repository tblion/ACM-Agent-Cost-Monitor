// Exercises Electron against an isolated real backend fixture.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import type { ElectronApplication, Page } from "playwright";
import initSqlJs from "sql.js";
import { expect, test } from "@playwright/test";
import type { DesktopApi } from "../electron/renderer-api";
import type { SessionRecord } from "../src/types";

interface ElectronFixture {
  root: string;
  databasePath: string;
  sqlite: SqlJsDatabase;
  databaseHash: string;
}

interface SqlJsDatabase {
  run(statement: string, parameters?: unknown[]): void;
  exec(statement: string): Array<{ columns: string[]; values: unknown[][] }>;
  export(): Uint8Array;
  close(): void;
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let electronApp: ElectronApplication | undefined;
let page: Page | undefined;
let fixture: ElectronFixture | undefined;
let pricingSourceServer: ReturnType<typeof createServer> | undefined;
let pricingSourceRequests: Array<{ method: string | undefined; url: string | undefined }> = [];

test.beforeEach(async () => {
  fixture = await createFixture(test.info().title === "applies GPT-6 Luna context pricing tiers");
  if (test.info().title === "loads legacy subscriptions and defaults versioned custom rates") {
    const settingsDirectory = path.join(fixture.root, "settings");
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(path.join(settingsDirectory, "settings.json"), JSON.stringify({
      fixedSubscriptions: [{
        provider: "legacy-provider",
        name: "Legacy plan",
        amount: 42,
        period: "monthly",
        models: ["legacy-model"],
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
      }],
    }), "utf8");
  }
  if (test.info().title === "uses versioned custom pricing on message dates") {
    const settingsDirectory = path.join(fixture.root, "settings");
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(path.join(settingsDirectory, "settings.json"), JSON.stringify({
      customRates: [
        {
          id: "fixture-rate-before-pivot",
          provider: "fixture-provider",
          model: "fixture-model",
          input: 2,
          output: 4,
          cacheRead: 0,
          cacheWrite: 0,
          effectiveFrom: "2026-10-01T00:00:00Z",
          source: "manual",
        },
        {
          id: "fixture-rate-after-pivot",
          provider: "fixture-provider",
          model: "fixture-model",
          input: 10,
          output: 20,
          cacheRead: 0,
          cacheWrite: 0,
          effectiveFrom: "2026-10-01T12:05:00Z",
          source: "manual",
        },
      ],
    }), "utf8");
  }
  const inheritedEnvironmentKeys = [
    "PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SYSTEMROOT", "WINDIR", "TEMP", "TMP",
    "DISPLAY", "XAUTHORITY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "DBUS_SESSION_BUS_ADDRESS", "LANG", "LC_ALL",
    "LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH", "DOTNET_ROOT", "DOTNET_ROOT_X64", "DOTNET_ROOT_ARM64", "CI",
  ];
  const environment = Object.fromEntries(
    inheritedEnvironmentKeys
      .map(key => [key, process.env[key]] as const)
      .filter((entry): entry is readonly [string, string] => typeof entry[1] === "string"),
  );
  Object.assign(environment, {
    XDG_DATA_HOME: path.join(fixture.root, "xdg-data"),
    XDG_CONFIG_HOME: path.join(fixture.root, "xdg-config"),
    XDG_STATE_HOME: path.join(fixture.root, "xdg-state"),
    OPENCODE_COSTS_VIEWER_SETTINGS_DIR: path.join(fixture.root, "settings"),
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  });
  if (test.info().title.startsWith("pricing source comparison")) {
    pricingSourceRequests = [];
    pricingSourceServer = createServer((request, response) => {
      pricingSourceRequests.push({ method: request.method, url: request.url });
      response.setHeader("content-type", "application/json");
      if (request.url === "/official") {
        response.end(JSON.stringify({
          candidates: [{ provider: "openai", model: "fixture-model", input: 2, output: 8, cacheRead: 0, cacheWrite: 0, currency: "USD", unit: "per_million_tokens", effectiveFrom: "2026-10-01" }],
        }));
      } else if (request.url === "/aggregator") {
        response.end(JSON.stringify({
          "fixture-model": { litellm_provider: "openai", input_cost_per_token: 0.000002, output_cost_per_token: 0.000008, cache_read_input_token_cost: null, cache_creation_input_token_cost: null },
          "fixture-model-preview": { litellm_provider: "openai", input_cost_per_token: 0.000003, output_cost_per_token: 0.000009 },
        }));
      } else if (request.url === "/subscription") {
        response.end(JSON.stringify({ candidates: [{ model: "Plus", amount: 20, currency: "USD", unit: "monthly", region: null }] }));
      } else {
        response.statusCode = 503;
        response.end("source unavailable");
      }
    });
    await new Promise<void>(resolve => pricingSourceServer!.listen(0, "127.0.0.1", resolve));
    const address = pricingSourceServer.address() as AddressInfo;
    const pricingSourceServerUrl = `http://127.0.0.1:${address.port}`;
    Object.assign(environment, {
      OPENCODE_COSTS_PRICING_OFFICIAL_URL: `${pricingSourceServerUrl}/official`,
      OPENCODE_COSTS_PRICING_AGGREGATOR_URL: `${pricingSourceServerUrl}/aggregator`,
      OPENCODE_COSTS_PRICING_FAILED_SOURCE_URL: `${pricingSourceServerUrl}/failed`,
      OPENCODE_COSTS_PRICING_SUBSCRIPTION_URL: `${pricingSourceServerUrl}/subscription`,
      OPENCODE_COSTS_PRICING_E2E: "true",
    });
  }
  delete environment.VITE_DEV_SERVER_URL;
  delete environment.VITE_OPENCODE_MOCK;

  const packagedExecutablePath = process.env.ELECTRON_EXECUTABLE_PATH;
  electronApp = await electron.launch({
    ...(packagedExecutablePath ? { executablePath: packagedExecutablePath } : {}),
    args: packagedExecutablePath ? [] : [repositoryRoot],
    env: environment,
  });
  page = await electronApp.firstWindow();
  page.on("console", message => console.log(`[Electron renderer ${message.type()}] ${message.text()}`));
  page.on("pageerror", error => console.error(`[Electron renderer error] ${error.message}`));
  await page.waitForLoadState("domcontentloaded");
  await expect(page).toHaveTitle("ACM Agent Cost Monitor");
  await expect(page.getByRole("banner")).toContainText("ACM Agent Cost Monitor");
  const settingsButton = page.getByRole("button", { name: /Réglages|Settings/ });
  await expect(settingsButton, `Electron page URL=${page.url()} title=${await page.title()} body=${await page.locator("body").innerText()}`).toBeVisible();
  await expect(page.getByRole("cell", { name: "Native fixture parent" })).toBeVisible();
});

test.afterEach(async () => {
  let cleanupError: unknown;
  try {
    if (electronApp) await electronApp.close();
  } catch (error) {
    cleanupError = error;
  }
  try {
    fixture?.sqlite.close();
  } catch (error) {
    cleanupError ??= error;
  }
  try {
    if (fixture) await rm(fixture.root, { recursive: true, force: true });
  } catch (error) {
    cleanupError ??= error;
  }
  try {
    if (pricingSourceServer) await new Promise<void>((resolve, reject) => pricingSourceServer!.close(error => error ? reject(error) : resolve()));
  } catch (error) {
    cleanupError ??= error;
  }
  electronApp = undefined;
  page = undefined;
  fixture = undefined;
  pricingSourceServer = undefined;
  pricingSourceRequests = [];
  if (cleanupError) throw cleanupError;
});

test("pricing source comparison isolates failures and rejects approximate model matches", async () => {
  const result = await page!.evaluate(async () => {
    const api = window.desktopApi as unknown as {
      getPricingCandidates(keys: unknown[]): Promise<{ sources: Array<{ sourceId: string; status: string; candidates: Array<{ model: string; matchStatus: string; input: number | null }> }> }>;
    };
    return api.getPricingCandidates([
      { kind: "usage", provider: "openai", model: "fixture-model" },
      { kind: "usage", provider: "openai", model: "fixture-model-pre" },
    ]);
  });
  expect(result.sources.find(source => source.sourceId === "openai-official")?.candidates)
    .toEqual([expect.objectContaining({ model: "fixture-model", matchStatus: "exact", input: 2 })]);
  expect(result.sources.find(source => source.sourceId === "litellm")?.candidates)
    .toEqual(expect.arrayContaining([
      expect.objectContaining({ model: "fixture-model", matchStatus: "exact", input: 2 }),
      expect.objectContaining({ model: "fixture-model-preview", matchStatus: "ambiguous" }),
    ]));
  expect(result.sources.find(source => source.status === "error")?.sourceId).toBe("failed-source");
  expect(pricingSourceRequests.map(request => request.method)).toEqual(["GET", "GET", "GET"]);
  expect(pricingSourceRequests.map(request => request.url).sort()).toEqual(["/aggregator", "/failed", "/official"]);
});

test("pricing source comparison keeps public subscription prices separate from actual paid amounts", async () => {
  const result = await page!.evaluate(async () => {
    const api = window.desktopApi as unknown as {
      getPricingCandidates(keys: unknown[]): Promise<{ sources: Array<{ sourceId: string; status: string; candidates: Array<{ model: string; input: number | null; currency: string; unit: string; region: string | null; matchStatus: string }> }> }>;
    };
    return api.getPricingCandidates([{ kind: "subscription", provider: "openai", model: "Plus" }]);
  });
  const candidate = result.sources.find(source => source.sourceId === "openai-subscription")?.candidates[0];
  expect(candidate).toMatchObject({ model: "Plus", input: 20, currency: "USD", unit: "monthly", region: null, matchStatus: "ambiguous" });
  expect(result.sources.find(source => source.sourceId === "openai-subscription")?.status).toBe("available");
  expect(pricingSourceRequests.map(request => request.url).sort()).toEqual(["/failed", "/subscription"]);
});

test("uses the real read-only SQLite backend for costs, rates, summary, audit, and settings", async () => {
  const sessionRecords = await page!.evaluate(async () => window.desktopApi!.getData());
  const parent = sessionRecords.find((session: SessionRecord) => session.id.endsWith("/session-parent"));
  const child = sessionRecords.find((session: SessionRecord) => session.id.endsWith("/session-child"));
  const fallback = sessionRecords.find((session: SessionRecord) => session.id.endsWith("/session-fallback"));

  expect(parent?.cost).toBeCloseTo(2.42, 10);
  expect(parent?.source).toBe("configured");
  expect(child?.cost).toBeCloseTo(0.1, 10);
  expect(child?.parentId?.endsWith("/session-parent")).toBe(true);
  expect(fallback?.cost).toBe(0.75);
  expect(fallback?.source).toBe("stored");
  expect(fallback?.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 });

  const rates = await page!.evaluate(async () => window.desktopApi!.getRates());
  expect(rates).toEqual([{
    provider: "fixture-provider",
    model: "fixture-model",
    input: 1,
    output: 2,
    cacheRead: 0.5,
    cacheWrite: 3,
    source: "configured",
    effectiveFrom: null,
  }]);

  const summary = await page!.evaluate(async () => window.desktopApi!.getCostSummary());
  expect(summary).toEqual(expect.arrayContaining([
    expect.objectContaining({ provider: "fixture-provider", model: "fixture-model", messages: 2, storedCost: 8.2, configured: true }),
    expect.objectContaining({ provider: "local", model: "unknown-model", messages: 1, storedCost: 0.75, configured: false }),
  ]));

  const catalog = await page!.evaluate(async () => window.desktopApi!.getCatalogStatus());
  expect(catalog.valid).toBe(true);
  expect(catalog.rateCount).toBeGreaterThan(0);

  const recalculation = await page!.evaluate(async () => window.desktopApi!.recalculateData());
  expect(recalculation.diagnostics.recalculableMessages).toBe(2);
  expect(recalculation.diagnostics.missingTokens).toBe(1);
  expect(recalculation.diagnostics.missingRates).toBe(1);

  const audit = await page!.evaluate(async () => window.desktopApi!.getAuditReport());
  expect(audit.valid).toBe(true);
  expect(audit.summary).toMatchObject({
    allSessions: 3,
    totalMessages: 4,
    assistantMessages: 3,
    ignoredMessages: 1,
    recalculableMessages: 2,
    storedFallbackMessages: 1,
    missingTokenMessages: 1,
    missingRateMessages: 1,
  });
  expect(audit.messages.find(message => message.messageId.endsWith("/message-fallback"))?.anomalies)
    .toEqual(["missingTokens", "missingRate", "storedCostFallback"]);

  const internalStore = await page!.evaluate(async () => window.desktopApi!.getInternalStoreStatus());
  expect(internalStore).toMatchObject({ projects: 1, sessions: 3, messages: 4, sources: 1 });
  expect(internalStore.databasePath.replaceAll("\\", "/")).toContain("acm-agent-cost-monitor/agent-usage.sqlite");
  const importChannels = await page!.evaluate(async () => window.desktopApi!.getInternalStoreSources());
  expect(importChannels.map(channel => channel.channelKey).sort()).toEqual(["api", "database"]);

  await page!.getByRole("button", { name: "État et actualisation des sources" }).click();
  const sourcesPopover = page!.getByRole("region", { name: "Sources de données" });
  await expect(sourcesPopover).toContainText("OpenCode");
  await expect(sourcesPopover).toContainText("Mise à jour :");
  await expect(sourcesPopover.getByRole("button", { name: "Rafraîchir la source Base de données" })).toBeVisible();
  await expect(sourcesPopover).toContainText("API OpenCode");
  await expect(sourcesPopover).not.toContainText("Tout rafraîchir");
  await page!.getByRole("button", { name: "Réglages" }).click();
  const settingsPage = page!.locator(".settings-page");
  await settingsPage.getByRole("button", { name: "Sources et données" }).click();
  await expect(settingsPage).toContainText("Intégrations");
  await expect(settingsPage).toContainText("Base de données");
  await expect(settingsPage).toContainText("API OpenCode");
  await expect(settingsPage).toContainText("toutes les 30 secondes");
  await settingsPage.getByRole("button", { name: "Retour au tableau de bord" }).click();

  const settings = await page!.evaluate(async () => window.desktopApi!.getSettings());
  const settingsStatus = await page!.evaluate(async () => window.desktopApi!.getSettingsStatus());
  const resolvedPaths = await page!.evaluate(async () => window.desktopApi!.getResolvedPaths());
  const metricsWithSize = await page!.evaluate(async () => window.desktopApi!.getRuntimeMetrics(true));
  const metricsWithoutSize = await page!.evaluate(async () => window.desktopApi!.getRuntimeMetrics(false));
  expect(settingsStatus.diagnostic).toBeNull();
  expect(settingsStatus.settings).toEqual(settings);
  expect(resolvedPaths.db).toBe(fixture!.databasePath);
  expect(resolvedPaths.config).toContain("opencode.jsonc");
  expect(metricsWithSize.databaseSizeBytes).toBeGreaterThan(0);
  expect(metricsWithSize.processMemoryBytes).toBeGreaterThan(0);
  expect(metricsWithoutSize.databaseSizeBytes).toBeNull();
  await page!.evaluate(async value => window.desktopApi!.saveSettings({ ...value, defaultPeriodDays: 7 }), settings);
  await expect.poll(async () => page!.evaluate(async () => (await window.desktopApi!.getSettings()).defaultPeriodDays)).toBe(7);

  const currentDatabaseHash = createHash("sha256").update(await readFile(fixture!.databasePath)).digest("hex");
  expect(currentDatabaseHash).toBe(fixture!.databaseHash);
});

test("applies GPT-6 Luna context pricing tiers", async () => {
  const sessions = await page!.evaluate(async () => window.desktopApi!.getData());
  expect(sessions.find((session: SessionRecord) => session.title === "GPT-6 Luna short context")?.cost)
    .toBeCloseTo(0.0272, 10);
  expect(sessions.find((session: SessionRecord) => session.title === "GPT-6 Luna long context")?.cost)
    .toBeCloseTo(0.0544002, 10);
  expect(sessions.find((session: SessionRecord) => session.title === "GPT-6 Luna yesterday")?.cost)
    .toBeCloseTo(0.2, 10);

  const audit = await page!.evaluate(async () => window.desktopApi!.getAuditReport());
  expect(audit.valid).toBe(true);
});

test("adds fixed subscriptions separately and zeroes covered model usage", async () => {
  await page!.getByRole("button", { name: "Réglages" }).click();
  const settingsPage = page!.locator(".settings-page");
  await settingsPage.getByRole("button", { name: "Tarifs" }).click();
  await settingsPage.getByRole("button", { name: "Abonnements" }).click();
  await settingsPage.getByRole("button", { name: "+ Ajouter un forfait" }).click();
  await settingsPage.locator("#subscription-0-provider").fill("fixture-provider");
  await settingsPage.locator("#subscription-0-amount").fill("120");
  await settingsPage.locator("#subscription-0-period").selectOption("annual");
  await settingsPage.locator("#subscription-0-from").fill("2026-10-01");
  await settingsPage.locator("#subscription-0-models").fill("fixture-model");
  await settingsPage.getByRole("button", { name: "Enregistrer" }).click();
  await expect.poll(async () => page!.evaluate(async () => (await window.desktopApi!.getSettings()).fixedSubscriptions.length)).toBe(1);

  const sessions = await page!.evaluate(async () => window.desktopApi!.getData());
  expect(sessions.find((session: SessionRecord) => session.title === "Native fixture parent")?.cost).toBe(0);
  expect(sessions.find((session: SessionRecord) => session.title === "Native fixture child")?.cost).toBe(0);
  expect(sessions.find((session: SessionRecord) => session.title === "Native stored fallback")?.cost).toBe(0.75);

  const totalCostCard = page!.locator(".kpi-grid .panel").first();
  await expect(totalCostCard).toContainText("Forfaits fixes (hors sessions)");
  await expect(totalCostCard).toContainText("10,00");
  await expect(totalCostCard).toContainText("10,75");
});

test("loads legacy subscriptions and defaults versioned custom rates", async () => {
  const settings = await page!.evaluate(async () => window.desktopApi!.getSettings());
  expect(settings.fixedSubscriptions).toEqual([expect.objectContaining({
    provider: "legacy-provider",
    name: "Legacy plan",
    amount: 42,
    period: "monthly",
    models: ["legacy-model"],
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
  })]);
  expect((settings as typeof settings & { customRates?: unknown[] }).customRates).toEqual([]);

  const legacySubscriptionId = (settings.fixedSubscriptions[0] as typeof settings.fixedSubscriptions[number] & { id?: string }).id;
  expect(legacySubscriptionId).toBeTruthy();
  await page!.evaluate(async value => window.desktopApi!.saveSettings(value), settings);
  let saved = await page!.evaluate(async () => window.desktopApi!.getSettings());
  expect((saved.fixedSubscriptions[0] as typeof saved.fixedSubscriptions[number] & { id?: string }).id)
    .toBe(legacySubscriptionId);
  expect(saved.fixedSubscriptions[0].name).toBe("Legacy plan");

  const customRate = {
    id: "legacy-model-rate-2026",
    provider: "legacy-provider",
    model: "legacy-model",
    input: 0.25,
    output: 1.5,
    cacheRead: 0.1,
    cacheWrite: 0.3,
    effectiveFrom: "2026-01-01T00:00:00Z",
    source: "manual",
  };
  await page!.evaluate(async ({ value, rate }) => window.desktopApi!.saveSettings({ ...value, customRates: [rate] }), {
    value: settings,
    rate: customRate,
  });
  saved = await page!.evaluate(async () => window.desktopApi!.getSettings());
  expect(saved.customRates).toEqual([customRate]);

  const invalidRates = {
    ...saved,
    customRates: [{
      id: "invalid-rate",
      provider: "legacy-provider",
      model: "legacy-model",
      input: -1,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      effectiveFrom: "2026-01-01T00:00:00Z",
      source: "manual",
    }],
  };
  await expect(page!.evaluate(async value => window.desktopApi!.saveSettings(value), invalidRates)).rejects.toThrow();
});

test("uses versioned custom pricing on message dates", async () => {
  const sessions = await page!.evaluate(async () => window.desktopApi!.getData());
  expect(sessions.find((session: SessionRecord) => session.title === "Native fixture parent")?.cost).toBeCloseTo(4.04, 10);
  expect(sessions.find((session: SessionRecord) => session.title === "Native fixture child")?.cost).toBeCloseTo(1, 10);

  const rates = await page!.evaluate(async () => window.desktopApi!.getRates());
  expect(rates).toEqual(expect.arrayContaining([
    expect.objectContaining({ input: 2, output: 4, source: "configured", effectiveFrom: "2026-10-01T00:00:00Z" }),
    expect.objectContaining({ input: 10, output: 20, source: "configured", effectiveFrom: "2026-10-01T12:05:00Z" }),
  ]));

  const recalculation = await page!.evaluate(async () => window.desktopApi!.recalculateData());
  expect(recalculation.sessions.find((session: SessionRecord) => session.title === "Native fixture parent")?.cost).toBeCloseTo(4.04, 10);
  expect(recalculation.sessions.find((session: SessionRecord) => session.title === "Native fixture child")?.cost).toBeCloseTo(1, 10);

  const audit = await page!.evaluate(async () => window.desktopApi!.getAuditReport());
  expect(audit.messages.find(message => message.messageId.endsWith("/message-configured"))?.calculatedCost).toBeCloseTo(4.04, 10);
  expect(audit.messages.find(message => message.messageId.endsWith("/message-child"))?.calculatedCost).toBeCloseTo(1, 10);
  expect(createHash("sha256").update(await readFile(fixture!.databasePath)).digest("hex")).toBe(fixture!.databaseHash);
});

test("historical recalculation preview computes impact without applying it", async () => {
  const before = await page!.evaluate(async () => window.desktopApi!.getData());
  const sourceHash = createHash("sha256").update(await readFile(fixture!.databasePath)).digest("hex");
  const preview = await page!.evaluate(async () => {
    const api = window.desktopApi as DesktopApi & {
      previewRecalculation: () => Promise<{ sessions: SessionRecord[]; diagnostics: { recalculableMessages: number; missingDates: number; missingTokens: number; missingRates: number } }>;
    };
    return api.previewRecalculation();
  });
  expect(preview.sessions.length).toBeGreaterThan(0);
  expect(preview.diagnostics.recalculableMessages).toBeGreaterThan(0);
  expect(preview.diagnostics.missingDates).toBe(0);
  expect(preview.diagnostics.missingTokens).toBeGreaterThan(0);
  expect(preview.diagnostics.missingRates).toBeGreaterThan(0);

  const after = await page!.evaluate(async () => window.desktopApi!.getData());
  expect(after).toEqual(before);

  await page!.getByRole("button", { name: /Réglages/ }).click();
  const settingsPage = page!.locator(".settings-page");
  await settingsPage.getByRole("button", { name: "Tarifs" }).click();
  await settingsPage.getByRole("button", { name: "Tarifs à l’usage" }).click();
  await settingsPage.getByRole("button", { name: "Prévisualiser le recalcul" }).click();
  await expect(settingsPage.getByRole("heading", { name: "Aperçu du recalcul historique" })).toBeVisible();
  await expect(settingsPage).toContainText("Coût affiché actuellement");
  await expect(settingsPage).toContainText("Coût estimé après recalcul");
  await settingsPage.getByRole("button", { name: "Annuler l’aperçu" }).click();
  expect(await page!.evaluate(async () => window.desktopApi!.getData())).toEqual(before);

  await settingsPage.getByRole("button", { name: "Prévisualiser le recalcul" }).click();
  await settingsPage.getByRole("button", { name: "Confirmer le recalcul" }).click();
  await expect(settingsPage.getByRole("status")).toContainText("Recalcul terminé pour");
  await page!.locator(".app-sidebar").getByRole("button", { name: "Retour au tableau de bord" }).click();
  const applied = await page!.evaluate(async () => window.desktopApi!.getData());
  expect(applied).toEqual(preview.sessions);
  expect(createHash("sha256").update(await readFile(fixture!.databasePath)).digest("hex")).toBe(sourceHash);
});

test("imports OpenCode V2 tables alongside legacy V1 records", async () => {
  const firstMessageDate = Date.UTC(2026, 9, 8, 10);
  const secondMessageDate = Date.UTC(2026, 9, 9, 10);
  fixture!.sqlite.run(`
    CREATE TABLE session_v2 (
      id TEXT PRIMARY KEY,
      directory TEXT,
      title TEXT,
      parent_id TEXT,
      time_created INTEGER NOT NULL
    );
    CREATE TABLE session_message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);
  fixture!.sqlite.run(
    "INSERT INTO session_v2 (id, directory, title, parent_id, time_created) VALUES (?, ?, ?, NULL, ?)",
    ["session-v2-multiday", "/fixtures/v2", "V2 multi-day session", Date.UTC(2026, 9, 7, 10)],
  );
  fixture!.sqlite.run(
    "INSERT INTO session_v2 (id, directory, title, parent_id, time_created) VALUES (?, ?, ?, NULL, ?)",
    ["session-parent", "/fixtures/native", "V2 updated parent title", 1790856000000],
  );
  const assistantMessage = (cost: number) => JSON.stringify({
    model: { id: "v2-model", providerID: "v2-provider", variant: "default" },
    cost,
    tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 10, write: 2 } },
  });
  fixture!.sqlite.run(
    "INSERT INTO session_message (id, session_id, type, time_created, data) VALUES (?, ?, 'assistant', ?, ?)",
    ["message-v2-first", "session-v2-multiday", firstMessageDate, assistantMessage(1.25)],
  );
  fixture!.sqlite.run(
    "INSERT INTO session_message (id, session_id, type, time_created, data) VALUES (?, ?, 'assistant', ?, ?)",
    ["message-v2-second", "session-v2-multiday", secondMessageDate, assistantMessage(0.75)],
  );
  fixture!.sqlite.run(
    "INSERT INTO session_message (id, session_id, type, time_created, data) VALUES (?, ?, 'assistant', ?, ?)",
    ["message-configured", "session-parent", 1790856000000, JSON.stringify({
      model: { id: "fixture-model", providerID: "fixture-provider", variant: "default" },
      cost: 8,
      tokens: { input: 1000000, output: 500000, reasoning: 10000, cache: { read: 200000, write: 100000 } },
    })],
  );
  fixture!.sqlite.run(
    "INSERT INTO session_message (id, session_id, type, time_created, data) VALUES (?, ?, 'user', ?, ?)",
    ["message-v2-user", "session-v2-multiday", secondMessageDate, JSON.stringify({})],
  );
  await writeFile(fixture!.databasePath, Buffer.from(fixture!.sqlite.export()));

  const sessions = await page!.evaluate(async () => window.desktopApi!.getData());
  const v2Session = sessions.find((session: SessionRecord) => session.id.endsWith("/session-v2-multiday"));
  expect(v2Session?.date).toBe(Date.UTC(2026, 9, 7, 10));
  expect(v2Session?.cost).toBe(2);
  expect(v2Session?.models).toEqual([expect.objectContaining({ provider: "v2-provider", model: "v2-model", cost: 2 })]);
  expect(v2Session?.messages?.map(message => message.date)).toEqual([firstMessageDate, secondMessageDate]);
  const parent = sessions.find((session: SessionRecord) => session.id.endsWith("/session-parent"));
  expect(parent?.title).toBe("V2 updated parent title");
  expect(parent?.cost).toBeCloseTo(2.42, 10);

  const status = await page!.evaluate(async () => window.desktopApi!.getInternalStoreStatus());
  expect(status).toMatchObject({ sessions: 4, messages: 7, sources: 1 });
});

test("refreshes the OpenCode V2 API channel without replacing complete database usage", async () => {
  const apiPassword = "fixture-api-secret";
  const requests: string[] = [];
  let incrementalUpdate = false;
  let fullReimport = false;
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    if (request.headers.authorization !== `Basic ${Buffer.from(`opencode:${apiPassword}`).toString("base64")}`) {
      response.writeHead(401).end();
      return;
    }
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/session/active") {
      response.end(JSON.stringify({ data: { "session-parent": {} } }));
    } else if (request.url === "/api/session?limit=100") {
      response.end(JSON.stringify({ data: [{ id: "session-parent" }], cursor: { next: null } }));
    } else if (request.url === "/api/session/session-parent") {
      response.end(JSON.stringify({ data: {
        id: "session-parent",
        title: "Updated through the API",
        parentID: null,
        projectID: "fixture-project",
        time: { created: 1790856000000 },
        location: { directory: "/fixtures/native" },
      } }));
    } else if (request.url === "/api/session/session-parent/message?limit=100&order=desc" && incrementalUpdate && !fullReimport) {
      response.end(JSON.stringify({ data: [{
        id: "message-api-new",
        type: "assistant",
        time: { created: 1790863200000 },
        model: { id: "fixture-model", providerID: "fixture-provider" },
        cost: 0.4,
        tokens: { input: 200, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
      }], cursor: { next: null, previous: "fixture-previous-cursor" } }));
    } else if (request.url === "/api/session/session-parent/message?limit=100&order=desc" && fullReimport) {
      response.end(JSON.stringify({ data: [
        {
          id: "message-api-new",
          type: "assistant",
          time: { created: 1790863200000 },
          model: { id: "fixture-model", providerID: "fixture-provider" },
          cost: 0.4,
          tokens: { input: 200, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        {
          id: "message-api-added",
          type: "assistant",
          time: { created: 1790859600000 },
          model: { id: "fixture-model", providerID: "fixture-provider" },
          cost: 0.3,
          tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        {
          id: "message-configured",
          type: "assistant",
          time: { created: 1790856000000 },
          model: { id: "fixture-model", providerID: "fixture-provider" },
          cost: 0,
        },
      ], cursor: { next: null, previous: null } }));
    } else if (request.url === "/api/session/session-parent/message?limit=100&order=desc") {
      response.end(JSON.stringify({ data: [{
        id: "message-api-added",
        type: "assistant",
        time: { created: 1790859600000 },
        model: { id: "fixture-model", providerID: "fixture-provider" },
        cost: 0.3,
        tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
      }], cursor: { next: "fixture-next-cursor", previous: null } }));
    } else if (request.url === "/api/session/session-parent/message?limit=100&cursor=fixture-next-cursor") {
      response.end(JSON.stringify({ data: [{
        id: "message-configured",
        type: "assistant",
        time: { created: 1790856000000 },
        model: { id: "fixture-model", providerID: "fixture-provider" },
        cost: 0,
      }], cursor: { next: null, previous: "fixture-previous-cursor" } }));
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const stateDirectory = path.join(fixture!.root, "xdg-state", "opencode");
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(path.join(stateDirectory, "service.json"), JSON.stringify({
      url: `http://127.0.0.1:${port}`,
      password: apiPassword,
    }));

    await page!.evaluate(async () => window.desktopApi!.refreshOpenCodeApi());
    const sessions = await page!.evaluate(async () => window.desktopApi!.getData());
    const parent = sessions.find((session: SessionRecord) => session.id.endsWith("/session-parent"));
    expect(sessions).toHaveLength(3);
    expect(parent?.title).toBe("Native fixture parent");
    expect(parent?.cost).toBeGreaterThan(2.4);
    expect(parent?.cost).toBeLessThan(2.43);
    expect(parent?.messages?.filter(message => message.date === 1790856000000)).toHaveLength(1);
    expect(parent?.messages?.map(message => message.date)).toContain(1790859600000);
    expect(requests).toContain("/api/session/session-parent/message?limit=100&cursor=fixture-next-cursor");

    const channels = await page!.evaluate(async () => window.desktopApi!.getInternalStoreSources());
    expect(channels.find(channel => channel.channelKey === "api")?.lastSyncError).toBeNull();
    expect(channels.find(channel => channel.channelKey === "api")?.lastImportedAt).not.toBeNull();

    requests.length = 0;
    incrementalUpdate = true;
    await page!.evaluate(async () => window.desktopApi!.refreshOpenCodeApi());
    expect(requests).toContain("/api/session/session-parent/message?limit=100&order=desc");
    expect(requests).not.toContain("/api/session/session-parent/message?limit=100&cursor=fixture-next-cursor");
    const afterIncremental = await page!.evaluate(async () => window.desktopApi!.getData());
    const updatedParent = afterIncremental.find((session: SessionRecord) => session.id.endsWith("/session-parent"));
    expect(updatedParent?.messages?.filter(message => message.date === 1790863200000)).toHaveLength(1);

    requests.length = 0;
    fullReimport = true;
    const reimportResult = await page!.evaluate(async () => window.desktopApi!.reimportAllSources().then(
      () => ({ success: true }),
      error => ({ success: false, error: JSON.stringify(error) }),
    ));
    expect(reimportResult, `Full reimport result: ${JSON.stringify(reimportResult)}`).toEqual({ success: true });
    expect(requests).toContain("/api/session?limit=100");
    const afterFullReimport = await page!.evaluate(async () => window.desktopApi!.getData());
    expect(afterFullReimport).toHaveLength(3);
    const storeStatus = await page!.evaluate(async () => window.desktopApi!.getInternalStoreStatus());
    expect(storeStatus.messages).toBe(6);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("assigns sessions without a project to the source-specific unknown project", async () => {
  fixture!.sqlite.run(
    "INSERT INTO session (id, directory, title, parent_id, time_created) VALUES (?, ?, ?, NULL, ?)",
    ["session-no-project", "", "Missing project fixture", 1790859600000],
  );
  fixture!.sqlite.run(
    "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
    ["message-no-project", "session-no-project", 1790859600000, JSON.stringify({
      role: "assistant",
      providerID: "fixture-provider",
      modelID: "fixture-model",
      cost: 0.1,
      tokens: { input: 10, output: 5, cache: { read: 0, write: 0 }, reasoning: 0 },
    })],
  );
  await writeFile(fixture!.databasePath, Buffer.from(fixture!.sqlite.export()));

  const sessions = await page!.evaluate(async () => window.desktopApi!.getData());
  expect(sessions.find((session: SessionRecord) => session.id.endsWith("/session-no-project"))?.project).toBe("Inconnu");
  const status = await page!.evaluate(async () => window.desktopApi!.getInternalStoreStatus());
  expect(status.projects).toBe(2);
});

test("refreshes from live database changes and stops watching when disabled", async () => {
  const liveButton = page!.getByRole("button", { name: /mode live|live mode|réactiver le mode live/i });
  await liveButton.click();
  await expect(liveButton).toHaveAttribute("aria-pressed", "true");
  await expect(liveButton).toHaveAttribute("aria-busy", "false");
  await expect.poll(async () => (await page!.evaluate(async () => window.desktopApi!.getSettingsStatus())).liveActive).toBe(true);

  fixture!.sqlite.run(
    "INSERT INTO session (id, directory, title, parent_id, time_created) VALUES (?, ?, ?, NULL, ?)",
    ["session-live", "/fixtures/live", "Live inserted session", 1790857800000],
  );
  fixture!.sqlite.run(
    "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
    ["message-live", "session-live", 1790857800000, JSON.stringify({
      role: "assistant",
      providerID: "fixture-provider",
      modelID: "fixture-model",
      cost: 0.4,
      tokens: { input: 400000, output: 0, cache: { read: 0, write: 0 }, reasoning: 0 },
    })],
  );
  await writeFile(fixture!.databasePath, Buffer.from(fixture!.sqlite.export()));
  await expect(page!.getByRole("cell", { name: "Live inserted session" })).toBeVisible({ timeout: 15_000 });

  await liveButton.click();
  await expect(liveButton).toHaveAttribute("aria-pressed", "false");
  await expect(liveButton).toHaveAttribute("aria-busy", "false");
  await expect.poll(async () => (await page!.evaluate(async () => window.desktopApi!.getSettingsStatus())).liveActive).toBe(false);

  fixture!.sqlite.run(
    "INSERT INTO session (id, directory, title, parent_id, time_created) VALUES (?, ?, ?, NULL, ?)",
    ["session-after-live", "/fixtures/live", "After live disabled", 1790858400000],
  );
  fixture!.sqlite.run(
    "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
    ["message-after-live", "session-after-live", 1790858400000, JSON.stringify({
      role: "assistant",
      providerID: "fixture-provider",
      modelID: "fixture-model",
      cost: 0,
      tokens: { input: 0, output: 0, cache: { read: 0, write: 0 }, reasoning: 0 },
    })],
  );
  await writeFile(fixture!.databasePath, Buffer.from(fixture!.sqlite.export()));
  await page!.waitForTimeout(2500);
  await expect(page!.getByRole("cell", { name: "After live disabled" })).toHaveCount(0);
});

test("keeps archived data available when the OpenCode source is temporarily unavailable", async () => {
  const unavailablePath = `${fixture!.databasePath}.unavailable`;
  await rename(fixture!.databasePath, unavailablePath);
  try {
    const archived = await page!.evaluate(async () => window.desktopApi!.getData());
    expect(archived).toHaveLength(3);
    const status = await page!.evaluate(async () => window.desktopApi!.getInternalStoreStatus());
    expect(status.lastSyncError).toBeTruthy();
    await page!.getByRole("button", { name: "État et actualisation des sources" }).click();
    const sourcesPopover = page!.getByRole("region", { name: "Sources de données" });
    const syncError = sourcesPopover.getByRole("img", { name: /Erreur de synchronisation/ });
    await expect(syncError).toBeVisible();
    await expect(syncError).toHaveAttribute("title", /Erreur de synchronisation/);
  } finally {
    await rename(unavailablePath, fixture!.databasePath);
  }

  const refreshed = await page!.evaluate(async () => window.desktopApi!.getData());
  expect(refreshed).toHaveLength(3);
  const status = await page!.evaluate(async () => window.desktopApi!.getInternalStoreStatus());
  expect(status.lastSyncError).toBeNull();
});

test("routes file dialogs and audit export through Electron main", async () => {
  const selectedPath = path.join(fixture!.root, "selected-opencode.db");
  const exportPath = path.join(fixture!.root, "audit-report.json");
  const backupPath = path.join(fixture!.root, "agent-usage-ui-backup.sqlite");
  await electronApp!.evaluate(({ dialog }, paths: { selectedPath: string; exportPath: string; backupPath: string }) => {
    dialog.showOpenDialog = async (_window: unknown, options?: { filters?: Array<{ extensions: string[] }> }) => {
      const isBackup = options?.filters?.some(filter => filter.extensions.includes("sqlite")) ?? false;
      return { canceled: false, filePaths: [isBackup ? paths.backupPath : paths.selectedPath] };
    };
    dialog.showSaveDialog = async (_window: unknown, options?: { defaultPath?: string }) => ({
      canceled: false,
      filePath: options?.defaultPath === "agent-usage.sqlite" ? paths.backupPath : paths.exportPath,
    });
  }, { selectedPath, exportPath, backupPath });

  await expect(page!.evaluate(async () => window.desktopApi!.pickPath())).resolves.toBe(selectedPath);
  const content = JSON.stringify({ valid: true, source: "electron-e2e" });
  await expect(page!.evaluate(async (payload) =>
    window.desktopApi!.exportAuditReport(payload.content, payload.suggestedName),
  { content, suggestedName: "audit-report.json" })).resolves.toBe(exportPath);
  await expect(readFile(exportPath, "utf8")).resolves.toBe(content);

  await page!.getByRole("button", { name: /Réglages|Settings/ }).click();
  const settingsPage = page!.locator(".settings-page");
  await settingsPage.getByRole("button", { name: "Sources et données" }).click();
  await expect(settingsPage.getByRole("button", { name: "Tout réimporter" })).toBeVisible();
  await settingsPage.getByRole("button", { name: "Diagnostic et sauvegardes" }).click();
  await expect(settingsPage.getByRole("heading", { name: "Base interne de l’application" })).toBeVisible();
  await settingsPage.getByRole("button", { name: "Voir les logs .NET" }).click();
  const backendLog = settingsPage.getByRole("log", { name: "Logs du backend .NET" });
  await expect(backendLog).toContainText("Backend host started");
  await page!.evaluate(async () => window.desktopApi!.getData());
  await expect(backendLog).toContainText('Processing backend operation "get_data"');
  await settingsPage.getByRole("button", { name: "Masquer les logs .NET" }).click();
  await settingsPage.getByRole("button", { name: "Exporter une sauvegarde" }).click();
  await expect(settingsPage.getByRole("status")).toContainText("Sauvegarde exportée");
  await settingsPage.getByRole("button", { name: "Fusionner une sauvegarde" }).click();
  await expect(settingsPage.getByRole("status")).toContainText("Fusion terminée");
  await settingsPage.getByRole("button", { name: "Retour au tableau de bord" }).click();
});

test("exports and merges the internal SQLite archive without duplicating records", async () => {
  const backupPath = path.join(fixture!.root, "agent-usage-backup.sqlite");
  await electronApp!.evaluate(({ dialog }, backup: string) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: backup });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [backup] });
  }, backupPath);

  const exportResult = await page!.evaluate(async () => window.desktopApi!.exportInternalStore().then(
    value => ({ value }),
    error => ({ error: JSON.stringify(error) }),
  ));
  expect(exportResult, `Internal store export result: ${JSON.stringify(exportResult)}`).toEqual({ value: backupPath });
  await expect(readFile(backupPath)).resolves.toBeTruthy();
  await expect(page!.evaluate(async () => window.desktopApi!.mergeInternalStore())).resolves.toMatchObject({
    projectsAdded: 0,
    sessionsAdded: 0,
    messagesAdded: 0,
  });

  const sqlJsEntry = fileURLToPath(import.meta.resolve("sql.js"));
  const SQL = await initSqlJs({ locateFile: (file: string) => path.join(path.dirname(sqlJsEntry), file) });
  const backupDatabase = new SQL.Database(new Uint8Array(await readFile(backupPath)));
  try {
    const sourceId = backupDatabase.exec("SELECT source_id FROM data_sources")[0]?.values[0]?.[0] as string;
    backupDatabase.run(
      "INSERT INTO projects (source_id, external_id, display_name, project_path) VALUES (?, ?, ?, ?)",
      [sourceId, "/fixtures/restored", "/fixtures/restored", "/fixtures/restored"],
    );
    backupDatabase.run(
      "INSERT INTO sessions (source_id, external_id, project_external_id, title, parent_external_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
      [sourceId, "session-restored", "/fixtures/restored", "Restored fixture session", 1790859000000],
    );
    backupDatabase.run(
      "INSERT INTO messages (source_id, external_id, session_external_id, role, message_at, provider_id, model_id, stored_cost, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens) VALUES (?, ?, ?, 'assistant', ?, ?, ?, 0.4, 100, 20, 0, 0, 0)",
      [sourceId, "message-restored", "session-restored", 1790859000000, "fixture-provider", "fixture-model"],
    );
    await writeFile(backupPath, Buffer.from(backupDatabase.export()));
  } finally {
    backupDatabase.close();
  }

  await expect(page!.evaluate(async () => window.desktopApi!.mergeInternalStore())).resolves.toMatchObject({
    projectsAdded: 1,
    sessionsAdded: 1,
    messagesAdded: 1,
  });
  const restored = await page!.evaluate(async () => window.desktopApi!.getData());
  expect(restored).toHaveLength(4);
  expect(restored.some((session: SessionRecord) => session.id.endsWith("/session-restored"))).toBe(true);
});

async function createFixture(includeContextTierMessages = false): Promise<ElectronFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-costs-electron-e2e-"));
  let sqlite: SqlJsDatabase | undefined;
  try {
    const dataHome = path.join(root, "xdg-data");
    const configHome = path.join(root, "xdg-config");
    const databaseDirectory = path.join(dataHome, "opencode");
    const configDirectory = path.join(configHome, "opencode");
    await Promise.all([
      mkdir(databaseDirectory, { recursive: true }),
      mkdir(configDirectory, { recursive: true }),
      mkdir(path.join(root, "settings"), { recursive: true }),
    ]);
    await writeFile(path.join(root, "settings", "settings.json"), JSON.stringify({ language: "fr" }), "utf8");

    const sqlSource = await readFile(path.join(repositoryRoot, "e2e", "fixtures", "opencode-backend-fixture.sql"), "utf8");
    const configSource = await readFile(path.join(repositoryRoot, "e2e", "fixtures", "opencode-backend-config.jsonc"), "utf8");
    const sqlJsEntry = fileURLToPath(import.meta.resolve("sql.js"));
    const SQL = await initSqlJs({ locateFile: (file: string) => path.join(path.dirname(sqlJsEntry), file) });
    const database = new SQL.Database();
    sqlite = database;
    database.run(sqlSource);
    if (includeContextTierMessages) {
      const createdAt = Date.UTC(2026, 9, 11, 12);
      database.run(
        "INSERT INTO session (id, directory, title, parent_id, time_created) VALUES (?, ?, ?, NULL, ?), (?, ?, ?, NULL, ?), (?, ?, ?, NULL, ?)",
        ["session-gpt6-short", "/fixtures/gpt6", "GPT-6 Luna short context", createdAt,
          "session-gpt6-long", "/fixtures/gpt6", "GPT-6 Luna long context", createdAt + 1,
          "session-gpt6-yesterday", "/fixtures/gpt6", "GPT-6 Luna yesterday", Date.UTC(2026, 9, 9, 22, 5)],
      );
      database.run(
        "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)",
        ["message-gpt6-short", "session-gpt6-short", createdAt,
          JSON.stringify({ role: "assistant", providerID: "openai", modelID: "gpt-6-luna", cost: 0,
            tokens: { input: 272000, output: 0, cache: { read: 0, write: 0 }, reasoning: 0 } }),
          "message-gpt6-long", "session-gpt6-long", createdAt + 1,
          JSON.stringify({ role: "assistant", providerID: "openai", modelID: "gpt-6-luna", cost: 0,
            tokens: { input: 272001, output: 0, cache: { read: 0, write: 0 }, reasoning: 0 } }),
          "message-gpt6-yesterday", "session-gpt6-yesterday", Date.UTC(2026, 9, 9, 22, 5),
          JSON.stringify({ role: "assistant", providerID: "openai", modelID: "gpt-6-luna", cost: 0,
            tokens: { input: 1000000, output: 0, cache: { read: 0, write: 0 }, reasoning: 0 } })],
      );
    }

    const databasePath = path.join(databaseDirectory, "opencode.db");
    await writeFile(databasePath, Buffer.from(database.export()));
    await writeFile(path.join(configDirectory, "opencode.jsonc"), configSource, "utf8");
    const databaseHash = createHash("sha256").update(await readFile(databasePath)).digest("hex");
    return { root, databasePath, sqlite: database, databaseHash };
  } catch (error) {
    try { sqlite?.close(); } catch { /* Preserve the fixture creation error. */ }
    try { await rm(root, { recursive: true, force: true }); } catch { /* Preserve the fixture creation error. */ }
    throw error;
  }
}
