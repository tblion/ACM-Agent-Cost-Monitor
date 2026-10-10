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

test.beforeEach(async () => {
  fixture = await createFixture();
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
  expect(internalStore.databasePath).toContain("acm-agent-cost-monitor/agent-usage.sqlite");
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
  const settingsDialog = page!.getByRole("dialog");
  await expect(settingsDialog).toContainText("Intégrations");
  await expect(settingsDialog).toContainText("Base de données");
  await expect(settingsDialog).toContainText("API OpenCode");
  await expect(settingsDialog).toContainText("toutes les 30 secondes");
  await settingsDialog.getByRole("button", { name: "Fermer les réglages" }).click();

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
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    if (request.headers.authorization !== `Basic ${Buffer.from(`opencode:${apiPassword}`).toString("base64")}`) {
      response.writeHead(401).end();
      return;
    }
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/session/active") {
      response.end(JSON.stringify({ data: { "session-parent": {} } }));
    } else if (request.url === "/api/session/session-parent") {
      response.end(JSON.stringify({ data: {
        id: "session-parent",
        title: "Updated through the API",
        parentID: null,
        projectID: "fixture-project",
        time: { created: 1790856000000 },
        location: { directory: "/fixtures/native" },
      } }));
    } else if (request.url === "/api/session/session-parent/message?limit=100&order=asc") {
      response.end(JSON.stringify({ data: [{
        id: "message-configured",
        type: "assistant",
        time: { created: 1790856000000 },
        model: { id: "fixture-model", providerID: "fixture-provider" },
        cost: 0,
      }], cursor: { next: "fixture-next-cursor", previous: null } }));
    } else if (request.url === "/api/session/session-parent/message?limit=100&cursor=fixture-next-cursor") {
      response.end(JSON.stringify({ data: [{
        id: "message-api-added",
        type: "assistant",
        time: { created: 1790859600000 },
        model: { id: "fixture-model", providerID: "fixture-provider" },
        cost: 0.3,
        tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
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
  const settingsDialog = page!.getByRole("dialog");
  await expect(settingsDialog.getByRole("heading", { name: "Base interne de l’application" })).toBeVisible();
  await settingsDialog.getByRole("button", { name: "Voir les logs .NET" }).click();
  const backendLog = settingsDialog.getByRole("log", { name: "Logs du backend .NET" });
  await expect(backendLog).toContainText("Backend host started");
  await page!.evaluate(async () => window.desktopApi!.getData());
  await expect(backendLog).toContainText('Processing backend operation "get_data"');
  await settingsDialog.getByRole("button", { name: "Masquer les logs .NET" }).click();
  await settingsDialog.getByRole("button", { name: "Exporter une sauvegarde" }).click();
  await expect(settingsDialog.getByRole("status")).toContainText("Sauvegarde exportée");
  await settingsDialog.getByRole("button", { name: "Fusionner une sauvegarde" }).click();
  await expect(settingsDialog.getByRole("status")).toContainText("Fusion terminée");
  await settingsDialog.getByRole("button", { name: "Fermer les réglages" }).click();
});

test("exports and merges the internal SQLite archive without duplicating records", async () => {
  const backupPath = path.join(fixture!.root, "agent-usage-backup.sqlite");
  await electronApp!.evaluate(({ dialog }, backup: string) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: backup });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [backup] });
  }, backupPath);

  await expect(page!.evaluate(async () => window.desktopApi!.exportInternalStore())).resolves.toBe(backupPath);
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
