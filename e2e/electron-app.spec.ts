// Exercises Electron against an isolated real backend fixture.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  export(): Uint8Array;
  close(): void;
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let electronApp: ElectronApplication | undefined;
let page: Page | undefined;
let fixture: ElectronFixture | undefined;

test.beforeEach(async () => {
  fixture = await createFixture();
  const inheritedEnvironmentKeys = [
    "PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SYSTEMROOT", "WINDIR", "TEMP", "TMP",
    "DISPLAY", "XAUTHORITY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "LANG", "LC_ALL",
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
    OPENCODE_COSTS_VIEWER_SETTINGS_DIR: path.join(fixture.root, "settings"),
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  });
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
  electronApp = undefined;
  page = undefined;
  fixture = undefined;
  if (cleanupError) throw cleanupError;
});

test("uses the real read-only SQLite backend for costs, rates, summary, audit, and settings", async () => {
  const sessionRecords = await page!.evaluate(async () => window.desktopApi!.getData());
  const parent = sessionRecords.find((session: SessionRecord) => session.id === "session-parent");
  const child = sessionRecords.find((session: SessionRecord) => session.id === "session-child");
  const fallback = sessionRecords.find((session: SessionRecord) => session.id === "session-fallback");

  expect(parent?.cost).toBeCloseTo(2.42, 10);
  expect(parent?.source).toBe("configured");
  expect(child?.cost).toBeCloseTo(0.1, 10);
  expect(child?.parentId).toBe("session-parent");
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
  expect(audit.messages.find(message => message.messageId === "message-fallback")?.anomalies)
    .toEqual(["missingTokens", "missingRate", "storedCostFallback"]);

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

test("routes file dialogs and audit export through Electron main", async () => {
  const selectedPath = path.join(fixture!.root, "selected-opencode.db");
  const exportPath = path.join(fixture!.root, "audit-report.json");
  await electronApp!.evaluate(({ dialog }, paths: { selectedPath: string; exportPath: string }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.selectedPath] });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.exportPath });
  }, { selectedPath, exportPath });

  await expect(page!.evaluate(async () => window.desktopApi!.pickPath())).resolves.toBe(selectedPath);
  const content = JSON.stringify({ valid: true, source: "electron-e2e" });
  await expect(page!.evaluate(async (payload) =>
    window.desktopApi!.exportAuditReport(payload.content, payload.suggestedName),
  { content, suggestedName: "audit-report.json" })).resolves.toBe(exportPath);
  await expect(readFile(exportPath, "utf8")).resolves.toBe(content);
});

async function createFixture(): Promise<ElectronFixture> {
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

    const sqlSource = await readFile(path.join(repositoryRoot, "e2e", "fixtures", "opencode-backend-fixture.sql"), "utf8");
    const configSource = await readFile(path.join(repositoryRoot, "e2e", "fixtures", "opencode-backend-config.jsonc"), "utf8");
    const sqlJsEntry = fileURLToPath(import.meta.resolve("sql.js"));
    const SQL = await initSqlJs({ locateFile: (file: string) => path.join(path.dirname(sqlJsEntry), file) });
    const database = new SQL.Database();
    sqlite = database;
    database.run(sqlSource);

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
