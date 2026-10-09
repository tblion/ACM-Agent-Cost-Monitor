// Implements deterministic desktop API responses for browser demo and E2E modes.
import type { RuntimeMetrics, Settings, SettingsResponse, ResolvedPaths, SessionRecord } from "../types";
import { DEMO_AUDIT_REPORT } from "../demo/audit-fixture";
import { createDemoRecalculationResult, generateDemoSnapshot, type DemoSnapshot } from "../demo/generator";

const e2e = import.meta.env.VITE_E2E === "true";
const e2eFixtureId = import.meta.env.VITE_E2E_FIXTURE_ID ?? "";
const e2eFixtureSha256 = import.meta.env.VITE_E2E_FIXTURE_SHA256 ?? "";
const e2eFixtureSqlPath = import.meta.env.VITE_E2E_FIXTURE_SQL_PATH ?? "";
const e2eFixtureManifestPath = import.meta.env.VITE_E2E_FIXTURE_MANIFEST_PATH ?? "";
const e2eFixtureSnapshotPath = import.meta.env.VITE_E2E_FIXTURE_SNAPSHOT_PATH ?? "";
const e2eAlternateSnapshotPath = import.meta.env.VITE_E2E_FIXTURE_ALTERNATE_SNAPSHOT_PATH ?? "";
const e2eControlUrl = import.meta.env.VITE_E2E_CONTROL_URL ?? "";
const e2eFixtureSnapshot = import.meta.env.VITE_E2E_FIXTURE_SNAPSHOT
  ? JSON.parse(import.meta.env.VITE_E2E_FIXTURE_SNAPSHOT) as DemoSnapshot
  : null;
const e2eScenario = e2e ? new URLSearchParams(globalThis.location?.search).get("e2e") : null;
const resolvedPaths: ResolvedPaths = {
  db: "/demo/opencode.db",
  config: "/demo/opencode.jsonc",
};

const settings: Settings = {
  dbPath: "/demo/opencode.db",
  configPath: "/demo/opencode.jsonc",
  live: false,
  theme: "system",
  language: null,
  defaultPeriodDays: e2eScenario === "settings-period" ? 7 : e2eScenario === "settings-period-invalid" ? 0 : 30,
  customGroups: [],
};
const demoSnapshot = generateDemoSnapshot(Date.now());
let currentSnapshot = e2eFixtureSnapshot ?? demoSnapshot;
const demoRuntimeMetrics: RuntimeMetrics = {
  databaseSizeBytes: 14_000_000_000,
  processMemoryBytes: 82_000_000,
  measuredAt: Date.UTC(2026, 8, 23, 14, 30),
};

const listeners = new Set<() => void>();
let e2eVariant = "initial";
let e2eReloadCount = 0;

function e2eSession(id: string, title: string, date: number): SessionRecord {
  const tokens = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
  return {
    id, project: "/fixtures/e2e", title, date, cost: 1, tokens,
    isSubagent: false, parentId: null, source: "configured",
    models: [{ provider: "fixture", model: "fixture-model", cost: 1, tokens, source: "configured" }],
  };
}

function getE2eSnapshot(): DemoSnapshot {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const sessions = e2eVariant === "added-session"
    ? [...currentSnapshot.sessions, e2eSession("added", "Added fixture session", today.getTime())]
    : e2eVariant === "recalculated"
      ? [...currentSnapshot.sessions, e2eSession("recalculated", "Recalculated fixture session", today.getTime())]
      : [
          ...currentSnapshot.sessions,
        ];
  return { ...currentSnapshot, sessions };
}

export function getE2eDemoSnapshot(): DemoSnapshot {
  return e2e ? getE2eSnapshot() : demoSnapshot;
}

if (e2e) {
  window.__E2E__ = {
    fixtureId: e2eFixtureId,
    fixtureSha256: e2eFixtureSha256,
    fixtureSqlPath: e2eFixtureSqlPath,
    fixtureManifestPath: e2eFixtureManifestPath,
    fixtureSnapshotPath: e2eFixtureSnapshotPath,
    fixtureAlternateSnapshotPath: e2eAlternateSnapshotPath,
    fixtureSnapshotSessionCount: currentSnapshot.sessions.length,
    fixtureSnapshotBoundaryDate: currentSnapshot.sessions.find(session => session.id === "today")?.date ?? 0,
    fixtureSnapshotBoundaryCost: currentSnapshot.sessions.find(session => session.id === "today")?.cost ?? 0,
    get dbPath() { return settings?.dbPath ?? ""; },
    get reloadCount() { return e2eReloadCount; },
    mutateSql: async () => {
      const response = await fetch(`${e2eControlUrl}/mutate-live`, { method: "POST" });
      currentSnapshot = await response.json() as DemoSnapshot;
      e2eVariant = "sql-mutated";
      listeners.forEach(listener => listener());
    },
    changeDbPath: path => {
      if (!settings) return;
      settings.dbPath = path;
      e2eVariant = "db-path-changed";
      e2eReloadCount += 1;
      listeners.forEach(listener => listener());
    },
    changeData: ({ variant }) => { e2eVariant = variant; },
    emitDbChanged: () => { listeners.forEach(listener => listener()); },
    markRecalculated: () => { e2eVariant = "recalculated"; },
  };
}

export async function invoke<T>(cmd: string, args?: unknown): Promise<T> {
  switch (cmd) {
    case "get_settings_status":
      return {
      settings,
      diagnostic: e2eScenario === "settings-invalid" ? { code: "settings", message: "defaultPeriodDays is invalid" } : null,
      liveActive: settings.live,
    } as SettingsResponse as unknown as T;
    case "get_settings":
      return settings as unknown as T;
    case "save_settings": {
      const next = (args as { s: Settings }).s;
      if (e2eScenario === "live-save-error" && next.live) throw { code: "watcher", message: "fixture refused" };
      const previousDbPath = settings.dbPath;
      if (!Number.isInteger(next.defaultPeriodDays) || next.defaultPeriodDays < 1 || next.defaultPeriodDays > 3650) next.defaultPeriodDays = 30;
      Object.assign(settings, next);
      if (e2e && next.dbPath === "/fixtures/alternate.db") {
        const response = await fetch(`${e2eControlUrl}/snapshot?database=alternate`);
        currentSnapshot = await response.json() as DemoSnapshot;
        e2eVariant = "db-path-changed";
      }
      if (next.dbPath !== previousDbPath) {
        e2eVariant = "db-path-changed";
        e2eReloadCount += 1;
        listeners.forEach(listener => listener());
      }
      return undefined as unknown as T;
    }
    case "pick_path": return null as unknown as T;
    case "get_resolved_paths": return resolvedPaths as unknown as T;
    case "get_data": return getE2eSnapshot().sessions as unknown as T;
    case "get_rates": return getE2eSnapshot().rates as unknown as T;
    case "get_cost_summary": return getE2eSnapshot().costSummary as unknown as T;
    case "get_catalog_status":
      return { valid: true, version: 1, generatedAt: "2026-01-01T00:00:00Z", sourceVersion: "demo", rateCount: demoSnapshot.rates.length } as unknown as T;
    case "get_runtime_metrics": {
      const includeDatabaseSize = (args as { includeDatabaseSize?: boolean } | undefined)?.includeDatabaseSize ?? false;
      return { ...demoRuntimeMetrics, databaseSizeBytes: includeDatabaseSize ? demoRuntimeMetrics.databaseSizeBytes : null } as unknown as T;
    }
    case "recalculate_data":
      if (e2e) e2eVariant = "recalculated";
      return createDemoRecalculationResult(getE2eSnapshot()) as unknown as T;
    case "get_audit_report":
      return DEMO_AUDIT_REPORT as unknown as T;
    case "export_audit_report":
      return "synthetic://audit-export" as unknown as T;
    default: throw new Error(`Mock: commande inconnue ${cmd}`);
  }
}

export function listen(event: string, cb: (e: unknown) => void) {
  if (e2e && event === "db-changed") {
    listeners.add(cb as () => void);
    return Promise.resolve(() => listeners.delete(cb as () => void));
  }
  return Promise.resolve(() => {});
}
