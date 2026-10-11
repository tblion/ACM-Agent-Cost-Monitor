// Implements deterministic desktop API responses for browser demo and E2E modes.
import type { RuntimeMetrics, Settings, SettingsResponse, ResolvedPaths, SessionRecord } from "../types";
import { DEMO_AUDIT_REPORT } from "../demo/audit-fixture";
import { createDemoRecalculationResult, generateDemoSnapshot, type DemoSnapshot } from "../demo/generator";
import { DEMO_RATES } from "../demo/catalog";

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
  customRates: [],
  fixedSubscriptions: e2eScenario === "subscription-comparison" ? [{
    id: "subscription-fixture", provider: "openai", name: "Plus", amount: 30, period: "monthly",
    models: ["gpt-4.1"], effectiveFrom: "2026-01-01", effectiveTo: null,
  }] : [],
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

export function getE2eRecalculationPreview() {
  const preview = createDemoRecalculationResult(getE2eSnapshot());
  if (!e2e) return preview;
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  return {
    ...preview,
    sessions: [...preview.sessions, e2eSession("recalculated", "Recalculated fixture session", date.getTime())],
  };
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
      const customRateIds = new Set<string>();
      const customRateVersions = new Set<string>();
      const validCustomRates = Array.isArray(next.customRates) && next.customRates.every(rate => {
        const version = `${rate.provider}\u0000${rate.model}\u0000${rate.effectiveFrom}`;
        const valid = typeof rate.id === "string" && rate.id.trim().length > 0
          && typeof rate.provider === "string" && rate.provider.trim().length > 0
          && typeof rate.model === "string" && rate.model.trim().length > 0
          && [rate.input, rate.output, rate.cacheRead, rate.cacheWrite].every(value => Number.isFinite(value) && value >= 0)
          && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(rate.effectiveFrom)
          && Number.isFinite(Date.parse(rate.effectiveFrom))
          && typeof rate.source === "string" && rate.source.trim().length > 0
          && !customRateIds.has(rate.id) && !customRateVersions.has(version);
        customRateIds.add(rate.id);
        customRateVersions.add(version);
        return valid;
      });
      if (!validCustomRates) throw { code: "settings", message: "customRates is invalid" };
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
    case "get_internal_store_status": return {
      databasePath: "/demo/acm-agent-cost-monitor/agent-usage.sqlite",
      projects: getE2eSnapshot().sessions.length > 0 ? 1 : 0,
      sessions: getE2eSnapshot().sessions.length,
      messages: getE2eSnapshot().sessions.length,
      sources: 1,
      lastImportedAt: "2026-10-09T12:00:00.000Z",
      lastSyncError: null,
    } as unknown as T;
    case "get_internal_store_sources": return [{
      sourceId: "demo-opencode-source",
      agentName: "OpenCode",
      sourcePath: "/demo/opencode.db",
      lastImportedAt: "2026-10-09T12:00:00.000Z",
      lastSyncAttemptAt: "2026-10-09T12:00:00.000Z",
      lastSyncError: null,
      channelKey: "database",
    }, {
      sourceId: "demo-opencode-source",
      agentName: "OpenCode",
      sourcePath: "/demo/opencode-service.json",
      lastImportedAt: null,
      lastSyncAttemptAt: "2026-10-09T12:00:00.000Z",
      lastSyncError: null,
      channelKey: "api",
    }] as unknown as T;
    case "refresh_internal_store_source": return undefined as T;
    case "refresh_opencode_api": return undefined as T;
    case "reimport_all_sources": return undefined as T;
    case "export_internal_store": return "synthetic://agent-usage.sqlite" as unknown as T;
    case "merge_internal_store": return { projectsAdded: 0, sessionsAdded: 0, messagesAdded: 0 } as unknown as T;
    case "get_backend_logs": return [] as unknown as T;
    case "get_data": return getE2eSnapshot().sessions as unknown as T;
    case "get_rates": return getE2eSnapshot().rates as unknown as T;
    case "get_catalog_rates": return DEMO_RATES as unknown as T;
    case "get_cost_summary": return getE2eSnapshot().costSummary as unknown as T;
    case "get_catalog_status":
      return { valid: true, version: 1, generatedAt: "2026-01-01T00:00:00Z", sourceVersion: "demo", rateCount: demoSnapshot.rates.length } as unknown as T;
    case "get_pricing_candidates":
      {
        const requested = (args as { keys?: Array<{ kind: string; provider: string; model: string }> } | undefined)?.keys ?? [];
        if (e2eScenario === "subscription-comparison" && requested.some(key => key.kind === "subscription")) {
          const retrievedAt = new Date().toISOString();
          return {
            retrievedAt,
            sources: [{
              sourceId: "openai-subscription", sourceType: "official", sourceName: "OpenAI (official)",
              sourceUrl: "https://chatgpt.com/pricing/", status: "available", error: null,
              candidates: [{ sourceId: "openai-subscription", sourceType: "official", sourceName: "OpenAI (official)",
                sourceUrl: "https://chatgpt.com/pricing/", retrievedAt, effectiveFrom: null, provider: "openai",
                model: "Plus", region: null, currency: "USD", unit: "monthly", input: 20, output: null,
                cacheRead: null, cacheWrite: null, matchStatus: "ambiguous",
                confidenceReasons: ["Official source", "Region not specified", "Taxes not specified"] }],
            }],
          } as unknown as T;
        }
        const matches = requested.some(key => key.provider.toLowerCase() === "openai" && key.model === "gpt-4.1");
        if (!matches || e2eScenario !== "pricing-comparison") {
          return { retrievedAt: new Date().toISOString(), sources: [] } as unknown as T;
        }
        const retrievedAt = new Date().toISOString();
        return {
          retrievedAt,
          sources: [
            {
              sourceId: "openai-official", sourceType: "official", sourceName: "OpenAI (official)",
              sourceUrl: "https://developers.openai.com/api/docs/pricing", status: "available", error: null,
              candidates: [{ sourceId: "openai-official", sourceType: "official", sourceName: "OpenAI (official)",
                sourceUrl: "https://developers.openai.com/api/docs/pricing", retrievedAt, effectiveFrom: "2026-10-01",
                provider: "OpenAI", model: "gpt-4.1", region: null, currency: "USD", unit: "per_million_tokens",
                input: 2.1, output: 8.2, cacheRead: 0.5, cacheWrite: null, matchStatus: "exact",
                confidenceReasons: ["Tarif officiel", "Identifiant exact", "Dernière vérification récente"] }],
            },
            {
              sourceId: "litellm", sourceType: "aggregator", sourceName: "LiteLLM (community-maintained)",
              sourceUrl: "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
              status: "available", error: null,
              candidates: [{ sourceId: "litellm", sourceType: "aggregator", sourceName: "LiteLLM (community-maintained)",
                sourceUrl: "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json", retrievedAt,
                effectiveFrom: null, provider: "OpenAI", model: "gpt-4.1", region: null, currency: "USD",
                unit: "per_million_tokens", input: 2, output: 8, cacheRead: 0.5, cacheWrite: null,
                matchStatus: "exact", confidenceReasons: ["Agrégateur communautaire", "Désaccord sur le tarif"] }],
            },
          ],
        } as unknown as T;
      }
    case "get_runtime_metrics": {
      const includeDatabaseSize = (args as { includeDatabaseSize?: boolean } | undefined)?.includeDatabaseSize ?? false;
      return { ...demoRuntimeMetrics, databaseSizeBytes: includeDatabaseSize ? demoRuntimeMetrics.databaseSizeBytes : null } as unknown as T;
    }
    case "recalculate_data":
      if (e2e) e2eVariant = "recalculated";
      return createDemoRecalculationResult(getE2eSnapshot()) as unknown as T;
    case "preview_recalculation": return getE2eRecalculationPreview() as unknown as T;
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
