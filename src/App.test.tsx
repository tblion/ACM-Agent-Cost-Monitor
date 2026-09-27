// @vitest-environment happy-dom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider, useTranslation } from "react-i18next";
import i18n from "./i18n/config";
import type { AppDataSource } from "./data-source";
import type { RuntimeMetrics, SessionRecord, Settings, SettingsResponse } from "./types";
import type { Filters } from "./lib/aggregate";
import type { ProjectFilterOptions } from "./lib/projectFilters";
import { DEMO_AUDIT_REPORT } from "./demo/audit-fixture";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocked = vi.hoisted(() => ({
  getSettings: vi.fn(),
  source: null as AppDataSource | null,
  dbChanged: null as (() => void) | null,
  chartSuspended: false,
  resolveChart: null as (() => void) | null,
}));

vi.mock("./api", () => ({
  getSettings: vi.fn(),
  getSettingsStatus: mocked.getSettings,
  getRuntimeMetrics: vi.fn(),
  saveSettings: vi.fn(),
  translateApiError: (error: unknown, _translate: (key: string) => string, fallback?: string) => {
    if (error instanceof Error) return fallback ?? error.message;
    if (typeof error === "object" && error !== null && "message" in error) return String(error.message);
    return fallback ?? String(error);
  },
  onDbChanged: vi.fn((callback: () => void) => {
    mocked.dbChanged = callback;
    return Promise.resolve(() => {
      if (mocked.dbChanged === callback) mocked.dbChanged = null;
    });
  }),
}));
vi.mock("./data-source", () => ({
  createDataSource: vi.fn(() => mocked.source),
  isMockBuild: vi.fn(() => false),
  resolveDataMode: vi.fn(() => "real"),
  writeDataMode: vi.fn(),
}));
vi.mock("./components/Header", () => ({ Header: ({ onOpenRates, onOpenSettings, onOpenAbout, onOpenAudit, onToggleLive, onDisableLive, liveConfigured, liveActive, auditButtonRef, metrics, updatedAt }: { onOpenRates: () => void; onOpenSettings: () => void; onOpenAbout: () => void; onOpenAudit: () => void; onToggleLive: () => void; onDisableLive: () => void; liveConfigured: boolean; liveActive: boolean; auditButtonRef?: { current: HTMLButtonElement | null }; metrics: RuntimeMetrics | null; updatedAt: number | null }) => {
  const formatBytes = (value: number) => value >= 1024 ? `${value / 1024} KiB` : `${value} B`;
  const databaseSize = metrics?.databaseSizeBytes == null ? "Valeur indisponible" : formatBytes(metrics.databaseSizeBytes);
  const memory = metrics?.processMemoryBytes == null ? "Valeur indisponible" : formatBytes(metrics.processMemoryBytes);
  const lastUpdated = updatedAt == null ? "Valeur indisponible" : new Date(updatedAt).toLocaleDateString("fr-FR", { timeZone: "UTC" });
  return createElement("div", {},
    createElement("div", { className: "header-runtime" }, `Taille de la base de données ${databaseSize} Mémoire RSS du processus ${memory}`),
    createElement("span", { className: "header-updated" }, `Dernière mise à jour des données : ${lastUpdated}`),
      createElement("button", { onClick: onOpenRates }, "rates"),
      createElement("button", { onClick: onOpenSettings }, "settings"),
      createElement("button", { onClick: onOpenAbout }, "about"),
      createElement("button", { ref: auditButtonRef, onClick: onOpenAudit }, "audit"),
      createElement("button", { "data-testid": "live-toggle", onClick: onToggleLive }, "live"),
      liveConfigured && !liveActive ? createElement("button", { "data-testid": "live-disable", onClick: onDisableLive }, "disable live") : null,
  );
}}));
vi.mock("./components/AuditView", () => ({ AuditView: ({ dataSource, onBack, stale, auditGeneration, onSuccessfulReport }: { dataSource: Pick<AppDataSource, "getAuditReport">; onBack: () => void; stale: boolean; auditGeneration: number; onSuccessfulReport: (generation: number) => void }) => {
  const [hasReport, setHasReport] = useState(false);
  return createElement("main", { className: "audit-view", "aria-labelledby": "audit-title" },
    createElement("h1", { id: "audit-title" }, "Audit test"),
    createElement("button", { onClick: async () => { const generation = auditGeneration; await dataSource.getAuditReport(); setHasReport(true); onSuccessfulReport(generation); } }, "refresh audit"),
    createElement("button", { onClick: onBack }, "back audit"),
    createElement("span", { "data-testid": "audit-report" }, hasReport ? "report" : "empty"),
    createElement("span", { "data-testid": "audit-stale" }, stale ? "stale" : "current"),
  );
}}));
vi.mock("./components/FilterBar", () => ({ FilterBar: ({ filters, onChange, onReset, projectFilterOptions }: { filters: Filters; onChange: (next: Filters) => void; onReset: () => void; projectFilterOptions: ProjectFilterOptions }) => {
  const { t } = useTranslation();
  return createElement("div", {},
  createElement("button", { onClick: () => onChange({ projects: ["project"] }) }, `filter:${filters.projects?.join(",") ?? "none"}`),
  createElement("button", { "data-testid": "filter-reset", onClick: onReset }, "reset"),
  createElement("span", { "data-testid": "filter-from" }, filters.from?.toString() ?? ""),
  createElement("span", { "data-testid": "filter-to" }, filters.to?.toString() ?? ""),
  createElement("span", { "data-testid": "filter-projects" }, projectFilterOptions.projects.map(option => option.value).join(",")),
  createElement("span", { "data-testid": "selected-projects" }, filters.projects?.join(",") ?? "all"),
  createElement("h3", {}, t("filters.projectGroups")),
  createElement("h3", {}, t("filters.projects")),
  ...projectFilterOptions.groups.map(group => createElement("button", {
    key: group.value,
    "data-testid": `group-${group.label}`,
    "aria-label": group.ariaLabel,
    onClick: () => onChange({ ...filters, projects: [
      ...projectFilterOptions.projects.map(option => option.value).filter(value => !(group.members ?? []).includes(value)),
      group.value,
    ] }),
  }, group.label)),
  );
} }));
vi.mock("./components/KpiCards", () => ({ KpiCards: ({ data }: { data: SessionRecord[] }) => createElement("div", { "data-testid": "kpis" }, data.map(session => session.id).join(",")) }));
vi.mock("./components/SessionTable", () => ({ SessionTable: ({ data }: { data: SessionRecord[] }) => createElement("div", { "data-testid": "table" }, data.map(session => session.id).join(",")) }));
vi.mock("./components/RatesModal", () => ({ RatesModal: ({ onRecalculationStart, onDataRecalculated, onRecalculationError }: { onRecalculationStart: () => void; onDataRecalculated: (sessions: SessionRecord[]) => void; onRecalculationError: () => void }) => createElement("div", { "data-testid": "rates-modal" },
  createElement("button", { onClick: onRecalculationStart }, "start recalculation"),
  createElement("button", { onClick: () => onDataRecalculated([session("new-kept", "project"), session("new-hidden", "other")] as SessionRecord[]) }, "finish recalculation"),
  createElement("button", { onClick: onRecalculationError }, "fail recalculation"),
)}));
vi.mock("./components/SettingsModal", () => ({ SettingsModal: ({ onDataModeChange, projects, settings, onSave }: { onDataModeChange: (mode: "demo") => void; projects: string[]; settings: Settings; onSave: (settings: Settings) => Promise<void> }) => createElement("div", { "data-testid": "settings-modal" },
  createElement("span", { "data-testid": "settings-projects" }, projects.join(",")),
  createElement("button", { onClick: () => onDataModeChange("demo") }, "switch mode"),
  createElement("button", { onClick: () => onSave({ ...settings, customGroups: [{ name: "Renamed Clients", projects: ["/work/a"] }] }) }, "rename group"),
) }));
vi.mock("./components/AboutModal", () => ({ AboutModal: () => createElement("div", { "data-testid": "about-modal" }) }));
vi.mock("./components/charts/CostOverTime", () => ({ CostOverTime: ({ data }: { data: SessionRecord[] }) => {
  if (mocked.chartSuspended) {
    throw new Promise<void>(resolve => { mocked.resolveChart = resolve; });
  }
  return createElement("div", { "data-testid": "cost-over-time" }, `sessions:${data.length}`);
} }));
vi.mock("./components/charts/CostByProject", () => ({ CostByProject: ({ activeGroup }: { activeGroup?: { name: string } }) => activeGroup
  ? createElement("span", { "data-testid": "active-project-group" }, activeGroup.name)
  : null }));
vi.mock("./components/charts/CostByModel", () => ({ CostByModel: () => null }));
vi.mock("./components/charts/CostByProvider", () => ({ CostByProvider: () => null }));
vi.mock("./components/charts/TokenBreakdown", () => ({ TokenBreakdown: () => null }));
vi.mock("./components/charts/TopSessions", () => ({ TopSessions: () => null }));
vi.mock("./components/charts/CostByGroup", () => ({ CostByGroup: ({ groups }: { groups: string[] }) => createElement("div", { "data-testid": "cost-by-group" }, `groups:${groups.length}`) }));
vi.mock("./components/charts/UsageByBilling", () => ({ UsageByBilling: () => null }));

import { getRuntimeMetrics, getSettingsStatus, saveSettings } from "./api";
import App, { defaultFilters } from "./App";

const settings: Settings = { dbPath: null, configPath: null, live: false, theme: "light", language: "fr", defaultPeriodDays: 3650, customGroups: [] };
const getSettings = getSettingsStatus as unknown as () => Promise<SettingsResponse>;
const settingsResponse = (overrides: Partial<SettingsResponse> = {}): SettingsResponse => ({
  settings: overrides.settings ?? settings,
  diagnostic: null,
  liveActive: (overrides.settings ?? settings).live,
  ...overrides,
});
const session = (id: string, project = "project"): SessionRecord => ({ id, project, title: id, date: Date.UTC(2026, 0, 1), cost: 1, tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, isSubagent: false, parentId: null, source: "configured", models: [{ provider: "p", model: "m", cost: 1, tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, source: "configured" }] });
const mounted: Root[] = [];

async function renderApp(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(root);
  await act(async () => { root.render(createElement(I18nextProvider, { i18n }, createElement(App))); });
  await act(async () => { await Promise.resolve(); });
  return container;
}

beforeEach(async () => {
  await i18n.changeLanguage("fr");
  mocked.dbChanged = null;
  mocked.chartSuspended = false;
  mocked.resolveChart = null;
  vi.mocked(getSettings).mockResolvedValue(settingsResponse());
  vi.mocked(getRuntimeMetrics).mockResolvedValue({ databaseSizeBytes: 1024, processMemoryBytes: 2048, measuredAt: 1000 } satisfies RuntimeMetrics);
  mocked.source = {
    getData: vi.fn().mockResolvedValue([session("old")]),
    getRates: vi.fn().mockResolvedValue([]),
    getCostSummary: vi.fn().mockResolvedValue([]),
    getCatalogStatus: vi.fn().mockResolvedValue({ valid: true, version: 1, generatedAt: "2026-01-01", sourceVersion: "test", rateCount: 0 }),
    recalculate: vi.fn(),
    getAuditReport: vi.fn(),
  };
});

afterEach(async () => {
  await act(async () => { for (const root of mounted.splice(0)) root.unmount(); });
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
  await i18n.changeLanguage("en");
});

describe("App deferred modals", () => {
  it("applique defaultPeriodDays et réutilise la période configurée au reset", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 7, 15, 30));
    vi.mocked(getSettings).mockResolvedValueOnce(settingsResponse({ settings: { ...settings, defaultPeriodDays: 7 } }));
    const container = await renderApp();

    const expectedFrom = new Date(2026, 0, 1, 0, 0, 0, 0).getTime();
    const expectedTo = new Date(2026, 0, 7, 23, 59, 59, 999).getTime();
    expect(container.querySelector('[data-testid="filter-from"]')?.textContent).toBe(String(expectedFrom));
    expect(container.querySelector('[data-testid="filter-to"]')?.textContent).toBe(String(expectedTo));

    await act(async () => { (container.querySelector('[data-testid="filter-reset"]') as HTMLButtonElement).click(); });
    expect(container.querySelector('[data-testid="filter-from"]')?.textContent).toBe(String(expectedFrom));
    expect(container.querySelector('[data-testid="filter-to"]')?.textContent).toBe(String(expectedTo));
  });

  it("resolves the SettingsModal after showing the compact modal fallback", async () => {
    const container = await renderApp();

    act(() => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "settings") as HTMLButtonElement).click(); });

    expect(container.querySelector(".modal-overlay .deferred-loading-modal")).not.toBeNull();

    await act(async () => { await Promise.resolve(); });

    expect(container.querySelector('[data-testid="settings-modal"]')).not.toBeNull();
    expect(container.querySelector(".modal-overlay .deferred-loading-modal")).toBeNull();
  });

  it("resolves the RatesModal after showing the compact modal fallback and preserves callbacks", async () => {
    const container = await renderApp();

    act(() => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "rates") as HTMLButtonElement).click(); });

    expect(container.querySelector(".modal-overlay .deferred-loading-modal")).not.toBeNull();

    await act(async () => { await Promise.resolve(); });

    expect(container.querySelector('[data-testid="rates-modal"]')).not.toBeNull();
    expect(container.querySelector(".modal-overlay .deferred-loading-modal")).toBeNull();

    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "start recalculation") as HTMLButtonElement).click(); });
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Chargement");
  });

  it("resolves the AboutModal after showing the compact modal fallback", async () => {
    const container = await renderApp();

    act(() => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "about") as HTMLButtonElement).click(); });

    expect(container.querySelector(".modal-overlay .deferred-loading-modal")).not.toBeNull();

    await act(async () => { await Promise.resolve(); });

    expect(container.querySelector('[data-testid="about-modal"]')).not.toBeNull();
    expect(container.querySelector(".modal-overlay .deferred-loading-modal")).toBeNull();
  });
});

describe("defaultFilters", () => {
  it.each([undefined, null, Number.NaN, 0, -1, 3651])("utilise 30 jours pour une période invalide: %s", period => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 7, 15, 30));
    const filters = defaultFilters([session("one")], period);

    expect(filters.from).toBe(new Date(2025, 11, 9, 0, 0, 0, 0).getTime());
    expect(filters.to).toBe(new Date(2026, 0, 7, 23, 59, 59, 999).getTime());
  });
});

describe("App settings diagnostics", () => {
  it("keeps live inactive when the runtime activity field is unexpectedly absent", async () => {
    vi.mocked(getSettings).mockResolvedValueOnce({
      ...settingsResponse({ settings: { ...settings, live: true } }),
      liveActive: undefined as unknown as boolean,
    });

    const container = await renderApp();

    expect(container.querySelector('[aria-pressed="true"]')).toBeNull();
  });

  it("renders default settings and a repairable diagnostic", async () => {
    vi.mocked(getSettings).mockResolvedValueOnce({
      settings,
       diagnostic: { code: "legacy", message: "invalid settings.json" },
      liveActive: false,
    });

    const container = await renderApp();

    expect(container.querySelector("main")).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("invalid settings.json");
  });

  it("renders the translated settings diagnostic and keeps its technical detail", async () => {
    vi.mocked(getSettings).mockResolvedValueOnce({
      settings,
      diagnostic: { code: "settings", message: "theme must be one of system, light, dark" },
      liveActive: false,
    });

    const container = await renderApp();
    const alert = container.querySelector('[role="alert"]');

    expect(alert?.textContent).toContain("Les réglages sont invalides");
    expect(alert?.textContent).toContain("theme must be one of system, light, dark");
  });

  it("reloads data after repairing settings and clears the diagnostic", async () => {
    vi.mocked(getSettings).mockResolvedValueOnce({
      settings,
      diagnostic: { code: "settings", message: "theme is invalid" },
      liveActive: false,
    });
    vi.mocked(saveSettings).mockResolvedValueOnce(undefined);
    const source = mocked.source!;
    vi.mocked(source.getData)
      .mockResolvedValueOnce([session("old")])
      .mockResolvedValueOnce([session("repaired")]);

    const container = await renderApp();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("theme is invalid");

    await act(async () => {
      (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "settings") as HTMLButtonElement).click();
      await Promise.resolve();
    });
    await act(async () => {
      (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "rename group") as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(source.getData).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="table"]')?.textContent).toContain("repaired");
    expect(container.querySelector('[role="alert"]')?.textContent ?? "").not.toContain("theme is invalid");
  });

  it("reactivates a configured live mode when the watcher is inactive", async () => {
    vi.mocked(getSettings).mockResolvedValueOnce({
      settings: { ...settings, live: true },
       diagnostic: { code: "legacy", message: "DB introuvable" },
      liveActive: false,
    });
    vi.mocked(saveSettings).mockResolvedValueOnce(undefined);

    const container = await renderApp();

    await act(async () => {
      (container.querySelector('[data-testid="live-toggle"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(saveSettings).toHaveBeenCalledWith({ ...settings, live: true });
  });

  it("synchronizes live activity after retry and hides disable after deactivation", async () => {
    vi.mocked(getSettings).mockResolvedValueOnce({
      settings: { ...settings, live: true },
      diagnostic: null,
      liveActive: false,
    });
    vi.mocked(saveSettings).mockResolvedValue(undefined);

    const container = await renderApp();
    expect(container.querySelector('[data-testid="live-disable"]')).not.toBeNull();

    await act(async () => {
      (container.querySelector('[data-testid="live-toggle"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="live-disable"]')).toBeNull();

    await act(async () => {
      (container.querySelector('[data-testid="live-toggle"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(saveSettings).toHaveBeenLastCalledWith({ ...settings, live: false });
    expect(container.querySelector('[data-testid="live-disable"]')).toBeNull();
  });
});

describe("App audit navigation", () => {
  it("removes the dashboard from visual and accessible rendering while audit is open", async () => {
    const container = await renderApp();
    const auditButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "audit") as HTMLButtonElement;

    await act(async () => { auditButton.click(); await Promise.resolve(); });

    const dashboard = container.querySelector("main[hidden]") as HTMLElement;
    expect(dashboard.hidden).toBe(true);
    expect(dashboard.style.display).toBe("none");
  });

  it("focuses audit content on open and returns focus to the audit trigger", async () => {
    const container = await renderApp();
    const auditButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "audit") as HTMLButtonElement;

    await act(async () => { auditButton.click(); await Promise.resolve(); });

    const auditContent = container.querySelector('[data-testid="audit-content"]') as HTMLElement;
    expect(document.activeElement).toBe(auditContent);

    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "back audit") as HTMLButtonElement).click(); });

    expect(document.activeElement).toBe(auditButton);
  });

  it("keeps the report mounted and marks it stale after data or settings changes", async () => {
    mocked.source!.getAuditReport = vi.fn().mockResolvedValue(DEMO_AUDIT_REPORT);
    const container = await renderApp();
    const auditButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "audit") as HTMLButtonElement;

    await act(async () => { auditButton.click(); await Promise.resolve(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "refresh audit") as HTMLButtonElement).click(); });
    expect(container.querySelector('[data-testid="audit-report"]')?.textContent).toBe("report");
    expect(container.querySelector('[data-testid="audit-stale"]')?.textContent).toBe("current");

    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "back audit") as HTMLButtonElement).click(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "rates") as HTMLButtonElement).click(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "start recalculation") as HTMLButtonElement).click(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "finish recalculation") as HTMLButtonElement).click(); });
    await act(async () => { auditButton.click(); await Promise.resolve(); });

    expect(container.querySelector('[data-testid="audit-report"]')?.textContent).toBe("report");
    expect(container.querySelector('[data-testid="audit-stale"]')?.textContent).toBe("stale");
  });

  it("keeps an audit stale when a refresh completes after a settings change", async () => {
    let resolveAudit: ((report: typeof DEMO_AUDIT_REPORT) => void) | undefined;
    mocked.source!.getAuditReport = vi.fn().mockImplementation(() => new Promise(resolve => {
      resolveAudit = resolve;
    }));
    const container = await renderApp();
    const auditButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "audit") as HTMLButtonElement;

    await act(async () => { auditButton.click(); await Promise.resolve(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "refresh audit") as HTMLButtonElement).click(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "settings") as HTMLButtonElement).click(); await Promise.resolve(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "rename group") as HTMLButtonElement).click(); });

    await act(async () => { resolveAudit?.(DEMO_AUDIT_REPORT); });

    expect(container.querySelector('[data-testid="audit-stale"]')?.textContent).toBe("stale");
  });
});

describe("App recalculation integration", () => {
  it("keeps the loading state until the initial data response is published", async () => {
    let resolveData!: (sessions: SessionRecord[]) => void;
    const pendingData = new Promise<SessionRecord[]>(resolve => { resolveData = resolve; });
    mocked.source!.getData = vi.fn().mockReturnValue(pendingData);

    const container = await renderApp();

    expect(container.querySelector('[role="status"]')?.textContent).toContain("Chargement");
    expect(container.querySelector('[data-testid="kpis"]')?.textContent).toBe("");

    await act(async () => {
      resolveData([session("initial")]);
      await pendingData;
    });

    expect(container.querySelector('[data-testid="kpis"]')?.textContent).toBe("initial");
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("ignores an older LIVE response that resolves after a newer response", async () => {
    let resolveFirst!: (sessions: SessionRecord[]) => void;
    let resolveSecond!: (sessions: SessionRecord[]) => void;
    const firstData = new Promise<SessionRecord[]>(resolve => { resolveFirst = resolve; });
    const secondData = new Promise<SessionRecord[]>(resolve => { resolveSecond = resolve; });
    vi.mocked(getSettings).mockResolvedValueOnce(settingsResponse({ settings: { ...settings, live: true } }));
    mocked.source!.getData = vi.fn()
      .mockResolvedValueOnce([session("initial")])
      .mockReturnValueOnce(firstData)
      .mockReturnValueOnce(secondData);

    const container = await renderApp();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { mocked.dbChanged?.(); });
    await act(async () => { mocked.dbChanged?.(); });

    await act(async () => {
      resolveSecond([session("newest")]);
      await secondData;
    });
    await act(async () => {
      resolveFirst([session("stale")]);
      await firstData;
    });

    expect(container.querySelector('[data-testid="kpis"]')?.textContent).toBe("newest");
  });

  it("serializes settings saves while preserving the latest update", async () => {
    let resolveFirst!: () => void;
    const firstSave = new Promise<void>(resolve => { resolveFirst = resolve; });
    vi.mocked(saveSettings)
      .mockReturnValueOnce(firstSave)
      .mockResolvedValueOnce(undefined);

    const container = await renderApp();
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "settings") as HTMLButtonElement).click(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "rename group") as HTMLButtonElement).click(); });
    expect(vi.mocked(saveSettings)).toHaveBeenCalledTimes(1);

    await act(async () => {
      (container.querySelector('[data-testid="live-toggle"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(vi.mocked(saveSettings)).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst();
      await firstSave;
    });
    expect(vi.mocked(saveSettings)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(saveSettings).mock.calls[1][0]).toMatchObject({ live: true });
  });

  it("rebuilds translated group options when the application language changes", async () => {
    vi.mocked(getSettings).mockResolvedValueOnce(settingsResponse({
      settings: { ...settings, customGroups: [{ name: "Clients", projects: ["/work/a"] }] },
    }));
    mocked.source!.getData = vi.fn().mockResolvedValue([session("a", "/work/a")]);

    const container = await renderApp();
    expect([...container.querySelectorAll("h3")].map(heading => heading.textContent)).toEqual(["Groupes", "Projets"]);
    expect(container.querySelector('[aria-label="Groupe Clients"]')).not.toBeNull();

    await act(async () => { await i18n.changeLanguage("en"); });

    expect([...container.querySelectorAll("h3")].map(heading => heading.textContent)).toEqual(["Groups", "Projects"]);
    expect(container.querySelector('[aria-label="Group Clients"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Groupe Clients"]')).toBeNull();
  });

  it("builds grouped project options and resolves a selected group before filtering", async () => {
    vi.mocked(getSettings).mockResolvedValueOnce(settingsResponse({
      settings: {
        ...settings,
        customGroups: [
          { name: "Clients", projects: ["/work/a"] },
          { name: "Other", projects: ["/work/c"] },
        ],
      },
    }));
    mocked.source!.getData = vi.fn().mockResolvedValue([
      session("a", "/work/a"),
      session("b", "/work/b"),
      session("c", "/work/c"),
    ]);

    const container = await renderApp();

    expect(container.querySelector('[data-testid="filter-projects"]')?.textContent).toBe("/work/a,/work/b,/work/c");
    expect(container.querySelector('[data-testid="group-Clients"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="kpis"]')?.textContent).toBe("a,b,c");

    await act(async () => { (container.querySelector('[data-testid="group-Clients"]') as HTMLButtonElement).click(); });
    expect(container.querySelector('[data-testid="kpis"]')?.textContent).toBe("a,b,c");
    expect(container.querySelector('[data-testid="active-project-group"]')?.textContent).toBe("Clients");
    expect(container.querySelector('[data-testid="selected-projects"]')?.textContent).toContain("/work/b,/work/c");
    expect(container.querySelector('[data-testid="selected-projects"]')?.textContent).not.toContain(",/work/a");

    await act(async () => { (container.querySelector('[data-testid="group-Other"]') as HTMLButtonElement).click(); });
    expect(container.querySelector('[data-testid="kpis"]')?.textContent).toBe("a,b,c");
  });

  it("reconciles a selected group when settings rename it", async () => {
    vi.mocked(getSettings).mockResolvedValueOnce(settingsResponse({
      settings: { ...settings, customGroups: [{ name: "Clients", projects: ["/work/a"] }] },
    }));
    mocked.source!.getData = vi.fn().mockResolvedValue([
      session("a", "/work/a"),
      session("b", "/work/b"),
    ]);

    const container = await renderApp();
    await act(async () => { (container.querySelector('[data-testid="group-Clients"]') as HTMLButtonElement).click(); });
    expect(container.querySelector('[data-testid="kpis"]')?.textContent).toBe("a,b");

    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "settings") as HTMLButtonElement).click(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "rename group") as HTMLButtonElement).click(); });

    expect(container.querySelector('[data-testid="group-Clients"]')).toBeNull();
    expect(container.querySelector('[data-testid="group-Renamed Clients"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="kpis"]')?.textContent).toBe("a,b");
  });

  it("shows the dashboard fallback while charts suspend and preserves chart props after resolution", async () => {
    mocked.chartSuspended = true;

    const container = await renderApp();

    expect(container.querySelector('[role="status"]')?.textContent).toContain("Chargement");
    expect(container.querySelector('[role="status"]')?.parentElement?.style.minHeight).toBe("300px");

    await act(async () => {
      mocked.chartSuspended = false;
      mocked.resolveChart?.();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[data-testid="cost-over-time"]')?.textContent).toBe("sessions:1");
    expect(container.querySelector('[data-testid="cost-by-group"]')?.textContent).toBe("groups:0");
  });

  it("keeps the update date unavailable when the initial data load fails", async () => {
    mocked.source!.getData = vi.fn().mockRejectedValueOnce(new Error("initial data load failed"));

    const container = await renderApp();

    expect(container.querySelector(".header-updated")?.textContent).toContain("Valeur indisponible");
    expect(container.textContent).toContain("Impossible de charger les sessions");
  });

  it("replaces sessions, refreshes views and keeps filters while clearing loading and errors", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1)));
    const container = await renderApp();
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "filter:none") as HTMLButtonElement).click(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "rates") as HTMLButtonElement).click(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "start recalculation") as HTMLButtonElement).click(); });
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Chargement");

    vi.setSystemTime(new Date(Date.UTC(2026, 0, 2)));
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "finish recalculation") as HTMLButtonElement).click(); });

    expect(container.querySelector('[data-testid="kpis"]')?.textContent).toBe("new-kept");
    expect(container.querySelector('[data-testid="table"]')?.textContent).toBe("new-kept");
    expect(container.textContent).toContain("filter:project");
    expect(container.textContent).not.toContain("new-hidden");
    expect(vi.mocked(getRuntimeMetrics)).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("2 KiB");
    expect(container.textContent).toContain("02/01/2026");
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("clears loading and exposes an error when recalculation fails", async () => {
    const container = await renderApp();
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "rates") as HTMLButtonElement).click(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "start recalculation") as HTMLButtonElement).click(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "fail recalculation") as HTMLButtonElement).click(); });

    expect(container.textContent).toContain("Impossible de recalculer les coûts");
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("clears loading before the post-recalculation metrics finish", async () => {
    let resolveMetrics!: (metrics: RuntimeMetrics) => void;
    const pendingMetrics = new Promise<RuntimeMetrics>(resolve => { resolveMetrics = resolve; });
    vi.mocked(getRuntimeMetrics)
      .mockResolvedValueOnce({ databaseSizeBytes: 1024, processMemoryBytes: 2048, measuredAt: 1000 })
      .mockImplementationOnce(() => pendingMetrics);

    const container = await renderApp();
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "rates") as HTMLButtonElement).click(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "start recalculation") as HTMLButtonElement).click(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "finish recalculation") as HTMLButtonElement).click(); });

    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(getRuntimeMetrics).toHaveBeenLastCalledWith(true);

    await act(async () => {
      resolveMetrics({ databaseSizeBytes: 2048, processMemoryBytes: 4096, measuredAt: 2000 });
      await pendingMetrics;
    });
  });

  it("ignores a runtime metric started before recalculation", async () => {
    let resolveLiveData!: (sessions: SessionRecord[]) => void;
    const liveData = new Promise<SessionRecord[]>(resolve => { resolveLiveData = resolve; });
    let resolveOldMetrics!: (metrics: RuntimeMetrics) => void;
    let resolveNewMetrics!: (metrics: RuntimeMetrics) => void;
    const oldMetrics = new Promise<RuntimeMetrics>(resolve => { resolveOldMetrics = resolve; });
    const newMetrics = new Promise<RuntimeMetrics>(resolve => { resolveNewMetrics = resolve; });
    vi.mocked(getSettings).mockResolvedValueOnce(settingsResponse({ settings: { ...settings, live: true } }));
    vi.mocked(getRuntimeMetrics)
      .mockResolvedValueOnce({ databaseSizeBytes: 1024, processMemoryBytes: 2048, measuredAt: 1000 })
      .mockImplementationOnce(() => oldMetrics)
      .mockImplementationOnce(() => newMetrics);
    mocked.source!.getData = vi.fn()
      .mockResolvedValueOnce([session("old")])
      .mockReturnValueOnce(liveData);

    const container = await renderApp();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { mocked.dbChanged?.(); });
    await act(async () => {
      resolveLiveData([session("live")]);
      await liveData;
    });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "rates") as HTMLButtonElement).click(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "start recalculation") as HTMLButtonElement).click(); });

    await act(async () => {
      resolveOldMetrics({ databaseSizeBytes: 16_384, processMemoryBytes: 32_768, measuredAt: 1000 });
      await oldMetrics;
    });
    expect(container.textContent).toContain("1 KiB");
    expect(container.textContent).toContain("2 KiB");
    expect(container.textContent).not.toContain("16 KiB");
    expect(container.textContent).not.toContain("32 KiB");

    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "finish recalculation") as HTMLButtonElement).click(); });

    await act(async () => {
      resolveNewMetrics({ databaseSizeBytes: 4096, processMemoryBytes: 8192, measuredAt: 2000 });
      await newMetrics;
    });

    expect(container.textContent).toContain("4 KiB");
    expect(container.textContent).toContain("8 KiB");
    expect(container.textContent).not.toContain("16 KiB");
    expect(container.textContent).not.toContain("32 KiB");
  });

  it("keeps recalculated data and date when its runtime metrics fail", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1)));
    vi.mocked(getRuntimeMetrics)
      .mockResolvedValueOnce({ databaseSizeBytes: 1024, processMemoryBytes: 2048, measuredAt: 1000 })
      .mockRejectedValueOnce(new Error("metrics unavailable"));

    const container = await renderApp();
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "rates") as HTMLButtonElement).click(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "start recalculation") as HTMLButtonElement).click(); });
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 2)));
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "finish recalculation") as HTMLButtonElement).click(); });

    expect(container.querySelector('[data-testid="kpis"]')?.textContent).toBe("new-kept,new-hidden");
    expect(container.querySelector(".header-updated")?.textContent).toContain("02/01/2026");
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("ignores a LIVE result that was already running when recalculation started", async () => {
    let resolveLiveData!: (sessions: SessionRecord[]) => void;
    const liveData = new Promise<SessionRecord[]>(resolve => { resolveLiveData = resolve; });
    vi.mocked(getSettings).mockResolvedValueOnce(settingsResponse({ settings: { ...settings, live: true } }));
    mocked.source!.getData = vi.fn()
      .mockResolvedValueOnce([session("old")])
      .mockReturnValueOnce(liveData);

    const container = await renderApp();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { mocked.dbChanged?.(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "filter:none") as HTMLButtonElement).click(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "rates") as HTMLButtonElement).click(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "start recalculation") as HTMLButtonElement).click(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "finish recalculation") as HTMLButtonElement).click(); });

    await act(async () => {
      resolveLiveData([session("live-result")]);
      await liveData;
    });
    expect(container.querySelector('[data-testid="kpis"]')?.textContent).toBe("new-kept");
    expect(container.textContent).not.toContain("new-hidden");
  });

  it("clears runtime metrics while changing data mode", async () => {
    let resolveModeData!: (sessions: SessionRecord[]) => void;
    const modeData = new Promise<SessionRecord[]>(resolve => { resolveModeData = resolve; });
    let resolveMetrics!: (metrics: RuntimeMetrics) => void;
    const modeMetrics = new Promise<RuntimeMetrics>(resolve => { resolveMetrics = resolve; });
    vi.mocked(getRuntimeMetrics)
      .mockResolvedValueOnce({ databaseSizeBytes: 1024, processMemoryBytes: 2048, measuredAt: 1000 })
      .mockReturnValueOnce(modeMetrics);
    mocked.source!.getData = vi.fn().mockResolvedValueOnce([session("old")]).mockReturnValueOnce(modeData);

    const container = await renderApp();
    const initialUpdatedText = container.querySelector(".status-bar p:last-child")?.textContent;
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "settings") as HTMLButtonElement).click(); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "switch mode") as HTMLButtonElement).click(); });

    expect(container.querySelector('[role="status"]')?.textContent).toContain("Chargement");
    expect(container.textContent).toContain("Valeur indisponible");
    expect(container.querySelector(".header-updated")?.textContent).toContain("Valeur indisponible");
    expect(container.querySelector(".header-updated")?.textContent).not.toBe(initialUpdatedText);

    await act(async () => { resolveModeData([session("demo")]); await modeData; });
    await act(async () => {
      resolveMetrics({ databaseSizeBytes: 4096, processMemoryBytes: 8192, measuredAt: 2000 });
      await modeMetrics;
    });
    expect(getRuntimeMetrics).toHaveBeenLastCalledWith(false);
    expect(container.textContent).toContain("4 KiB");
    expect(container.textContent).toContain("8 KiB");
  });

  it("passes the loaded projects to SettingsModal", async () => {
    const container = await renderApp();

    await act(async () => { (Array.from(container.querySelectorAll("button")).find(button => button.textContent === "settings") as HTMLButtonElement).click(); });

    expect(container.querySelector('[data-testid="settings-projects"]')?.textContent).toBe("project");
  });

  it("updates the status date after a successful LIVE reload", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1)));
    let resolveLiveData!: (sessions: SessionRecord[]) => void;
    const liveData = new Promise<SessionRecord[]>(resolve => { resolveLiveData = resolve; });
    vi.mocked(getSettings).mockResolvedValueOnce(settingsResponse({ settings: { ...settings, live: true } }));
    mocked.source!.getData = vi.fn()
      .mockResolvedValueOnce([session("old")])
      .mockReturnValueOnce(liveData);

    const container = await renderApp();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { mocked.dbChanged?.(); });
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 2)));
    await act(async () => {
      resolveLiveData([session("live")]);
      await liveData;
    });

    expect(container.querySelector('[data-testid="kpis"]')?.textContent).toBe("live");
    expect(container.querySelector(".header-updated")?.textContent).toContain("02/01/2026");
  });

  it("preserves the selected group and relevant filters during a LIVE reload", async () => {
    let resolveLiveData!: (sessions: SessionRecord[]) => void;
    const liveData = new Promise<SessionRecord[]>(resolve => { resolveLiveData = resolve; });
    vi.mocked(getSettings).mockResolvedValueOnce(settingsResponse({
      settings: {
        ...settings,
        live: true,
        customGroups: [{ name: "Clients", projects: ["/work/a"] }],
      },
    }));
    mocked.source!.getData = vi.fn()
      .mockResolvedValueOnce([session("a", "/work/a"), session("b", "/work/b")])
      .mockReturnValueOnce(liveData);

    const container = await renderApp();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { (container.querySelector('[data-testid="group-Clients"]') as HTMLButtonElement).click(); });
    expect(container.querySelector('[data-testid="selected-projects"]')?.textContent).toContain("/work/b");
    expect(container.querySelector('[data-testid="kpis"]')?.textContent).toBe("a,b");

    await act(async () => { mocked.dbChanged?.(); });
    await act(async () => {
      resolveLiveData([session("a", "/work/a"), session("b", "/work/b"), session("c", "/work/c")]);
      await liveData;
    });

    expect(container.querySelector('[data-testid="selected-projects"]')?.textContent).not.toContain("/work/c");
    expect(container.querySelector('[data-testid="kpis"]')?.textContent).toBe("a,b");
  });

  it("keeps the previous status date when a LIVE reload fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1)));
    let rejectLiveData!: (error: Error) => void;
    const liveData = new Promise<SessionRecord[]>((_, reject) => { rejectLiveData = reject; });
    vi.mocked(getSettings).mockResolvedValueOnce(settingsResponse({ settings: { ...settings, live: true } }));
    mocked.source!.getData = vi.fn()
      .mockResolvedValueOnce([session("old")])
      .mockReturnValueOnce(liveData);

    const container = await renderApp();
    const previousDate = container.querySelector(".header-updated")?.textContent;
    await act(async () => { await Promise.resolve(); });
    await act(async () => { mocked.dbChanged?.(); });
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 2)));
    await act(async () => {
      rejectLiveData(new Error("live reload failed"));
      await liveData.catch(() => undefined);
    });

    expect(container.querySelector(".header-updated")?.textContent).toBe(previousDate);
    expect(container.textContent).toContain("Impossible de recharger les sessions");
  });

  it("ignores an older concurrent runtime metrics response", async () => {
    let resolveFirstMetrics!: (metrics: RuntimeMetrics) => void;
    let resolveSecondMetrics!: (metrics: RuntimeMetrics) => void;
    const firstMetrics = new Promise<RuntimeMetrics>(resolve => { resolveFirstMetrics = resolve; });
    const secondMetrics = new Promise<RuntimeMetrics>(resolve => { resolveSecondMetrics = resolve; });
    vi.mocked(getSettings).mockResolvedValueOnce(settingsResponse({ settings: { ...settings, live: true } }));
    vi.mocked(getRuntimeMetrics)
      .mockResolvedValueOnce({ databaseSizeBytes: 1024, processMemoryBytes: 2048, measuredAt: 1000 })
      .mockImplementationOnce(() => firstMetrics)
      .mockImplementationOnce(() => secondMetrics);
    let resolveFirstData!: (sessions: SessionRecord[]) => void;
    let resolveSecondData!: (sessions: SessionRecord[]) => void;
    const firstData = new Promise<SessionRecord[]>(resolve => { resolveFirstData = resolve; });
    const secondData = new Promise<SessionRecord[]>(resolve => { resolveSecondData = resolve; });
    mocked.source!.getData = vi.fn()
      .mockResolvedValueOnce([session("old")])
      .mockReturnValueOnce(firstData)
      .mockReturnValueOnce(secondData);

    const container = await renderApp();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { mocked.dbChanged?.(); });
    await act(async () => {
      resolveFirstData([session("live-one")]);
      await firstData;
    });
    await act(async () => { mocked.dbChanged?.(); });
    await act(async () => {
      resolveSecondData([session("live-two")]);
      await secondData;
    });

    await act(async () => {
      resolveSecondMetrics({ databaseSizeBytes: 4096, processMemoryBytes: 8192, measuredAt: 2000 });
      await secondMetrics;
    });
    expect(container.textContent).toContain("4 KiB");
    expect(container.textContent).toContain("8 KiB");

    await act(async () => {
      resolveFirstMetrics({ databaseSizeBytes: 16_384, processMemoryBytes: 32_768, measuredAt: 3000 });
      await firstMetrics;
    });
    expect(container.textContent).not.toContain("16 KiB");
    expect(container.textContent).not.toContain("32 KiB");
  });
});
