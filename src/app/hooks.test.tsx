// @vitest-environment happy-dom

import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDataSource } from "../data-source";
import type { RuntimeMetrics, SessionRecord, Settings, SettingsResponse } from "../types";
import { useAppData } from "./useAppData";
import { useAudit } from "./useAudit";
import { useLiveMode } from "./useLiveMode";
import { useSettings } from "./useSettings";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocked = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  getRuntimeMetrics: vi.fn(),
  onDbChanged: vi.fn(),
  dbChanged: null as (() => void) | null,
  unsubscribe: vi.fn(),
  sources: {} as Record<string, AppDataSource>,
  languageChanged: null as ((language: string) => void) | null,
}));

vi.mock("../api", () => ({
  getSettings: mocked.getSettings,
  getSettingsStatus: (...args: unknown[]) => mocked.getSettings(...args),
  saveSettings: mocked.saveSettings,
  getRuntimeMetrics: mocked.getRuntimeMetrics,
  onDbChanged: mocked.onDbChanged,
  translateApiError: (error: unknown, _translate: (key: string) => string, fallback?: string) => {
    if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
      return `translated:${String(error.code)}: ${String(error.message)}`;
    }
    return fallback ?? "error";
  },
}));
vi.mock("../data-source", () => ({
  createDataSource: vi.fn((mode: string) => mocked.sources[mode]),
  isMockBuild: vi.fn(() => false),
  resolveDataMode: vi.fn(() => "real"),
  writeDataMode: vi.fn(),
}));
vi.mock("../theme", () => ({ detectOS: vi.fn(() => "linux"), applyTheme: vi.fn() }));
vi.mock("../i18n/config", () => ({
  default: {
    language: "en",
    changeLanguage: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((_event: string, callback: (language: string) => void) => { mocked.languageChanged = callback; }),
    off: vi.fn(),
  },
  i18nReady: Promise.resolve(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const settings: Settings = { dbPath: null, configPath: null, live: false, theme: "light", language: "en", defaultPeriodDays: 30, customGroups: [] };
const response: SettingsResponse = { settings, diagnostic: null, liveActive: false };
const session = (id: string): SessionRecord => ({
  id, project: "project", title: id, date: 1, cost: 1,
  tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  isSubagent: false, parentId: null, source: "configured", models: [],
});
const metrics: RuntimeMetrics = { databaseSizeBytes: null, processMemoryBytes: 1, measuredAt: 1 };
const mounted: Root[] = [];

function renderHookHarness(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(root);
  act(() => { root.render(element); });
  return container;
}

afterEach(() => {
  act(() => { for (const root of mounted.splice(0)) root.unmount(); });
  document.body.replaceChildren();
  vi.clearAllMocks();
  mocked.languageChanged = null;
  mocked.dbChanged = null;
});

describe("useAppData", () => {
  beforeEach(() => {
    mocked.getRuntimeMetrics.mockResolvedValue(metrics);
  });

  it("changes mode with only the sessions request", async () => {
    const realSource = {
      getData: vi.fn().mockResolvedValue([session("real")]),
      getRates: vi.fn(), getCostSummary: vi.fn(), getCatalogStatus: vi.fn(), recalculate: vi.fn(), getAuditReport: vi.fn(),
    } satisfies AppDataSource;
    const demoSource = {
      getData: vi.fn().mockResolvedValue([session("demo")]),
      getRates: vi.fn(), getCostSummary: vi.fn(), getCatalogStatus: vi.fn(), recalculate: vi.fn(), getAuditReport: vi.fn(),
    } satisfies AppDataSource;
    mocked.sources = { real: realSource, demo: demoSource };
    let changeMode!: (mode: "demo") => Promise<void>;

    function Harness() {
      const [, setFilters] = useState({});
      const data = useAppData({ defaultPeriodDaysRef: { current: 30 }, setFilters, markAuditStale: vi.fn() });
      changeMode = data.changeDataMode;
      return createElement("span", {}, data.data.map(item => item.id).join(","));
    }

    const container = renderHookHarness(createElement(Harness));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await changeMode("demo"); });

    expect(demoSource.getData).toHaveBeenCalledTimes(1);
    expect(demoSource.getRates).not.toHaveBeenCalled();
    expect(demoSource.getCostSummary).not.toHaveBeenCalled();
    expect(container.textContent).toBe("demo");
  });

  it("ignores an older reload response", async () => {
    let resolveFirst!: (value: SessionRecord[]) => void;
    let resolveSecond!: (value: SessionRecord[]) => void;
    const first = new Promise<SessionRecord[]>(resolve => { resolveFirst = resolve; });
    const second = new Promise<SessionRecord[]>(resolve => { resolveSecond = resolve; });
    const source = {
      getData: vi.fn().mockResolvedValueOnce([session("initial")]).mockReturnValueOnce(first).mockReturnValueOnce(second),
      getRates: vi.fn(), getCostSummary: vi.fn(), getCatalogStatus: vi.fn(), recalculate: vi.fn(), getAuditReport: vi.fn(),
    } satisfies AppDataSource;
    mocked.sources = { real: source };
    let reload!: () => Promise<boolean>;

    function Harness() {
      const [, setFilters] = useState({});
      const data = useAppData({ defaultPeriodDaysRef: { current: 30 }, setFilters, markAuditStale: vi.fn() });
      reload = () => data.reloadData(false);
      return createElement("span", {}, data.data.map(item => item.id).join(","));
    }

    const container = renderHookHarness(createElement(Harness));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { void reload(); void reload(); });
    await act(async () => { resolveSecond([session("newest")]); await second; });
    await act(async () => { resolveFirst([session("stale")]); await first; });

    expect(container.textContent).toBe("newest");
  });

  it("ignores a rejected request after the hook is unmounted", async () => {
    let rejectData!: (error: Error) => void;
    const pendingData = new Promise<SessionRecord[]>((_, reject) => { rejectData = reject; });
    const source = {
      getData: vi.fn().mockReturnValue(pendingData),
      getRates: vi.fn(), getCostSummary: vi.fn(), getCatalogStatus: vi.fn(), recalculate: vi.fn(), getAuditReport: vi.fn(),
    } satisfies AppDataSource;
    mocked.sources = { real: source };
    let renders = 0;

    function Harness() {
      renders += 1;
      const [, setFilters] = useState({});
      useAppData({ defaultPeriodDaysRef: { current: 30 }, setFilters, markAuditStale: vi.fn() });
      return null;
    }

    renderHookHarness(createElement(Harness));
    await act(async () => { await Promise.resolve(); });
    const rendersBeforeUnmount = renders;
    const root = mounted[mounted.length - 1];
    act(() => { root.unmount(); });

    await act(async () => {
      rejectData(new Error("late failure"));
      await pendingData.catch(() => undefined);
    });

    expect(renders).toBe(rendersBeforeUnmount);
  });
});

describe("useSettings", () => {
  beforeEach(() => {
    mocked.getSettings.mockResolvedValue(response);
  });

  it("loads settings, preserves liveActive and synchronizes the document language", async () => {
    let latestSettings: Settings | null = null;
    let latestLiveActive = false;
    mocked.getSettings.mockResolvedValueOnce({ ...response, liveActive: true });
    function Harness() {
      const [, setFilters] = useState({});
      const dataRef = useRef([session("one")]);
      const filtersDirtyRef = useRef(false);
      const defaultPeriodDaysRef = useRef(30);
      const state = useSettings({ dataRef, filtersDirtyRef, setFilters, markAuditStale: vi.fn(), defaultPeriodDaysRef });
      latestSettings = state.settings;
      latestLiveActive = state.liveActive;
      return null;
    }

    renderHookHarness(createElement(Harness));
    await act(async () => { await Promise.resolve(); });

    expect(latestSettings).toEqual(settings);
    expect(latestLiveActive).toBe(true);
    expect(document.documentElement.lang).toBe("en");
    mocked.languageChanged?.("fr");
    expect(document.documentElement.lang).toBe("fr");
  });

  it("serializes saves against the latest settings", async () => {
    let resolveFirst!: () => void;
    const firstSave = new Promise<void>(resolve => { resolveFirst = resolve; });
    mocked.saveSettings.mockReturnValueOnce(firstSave).mockResolvedValueOnce(undefined);
    let enqueue!: (update: (current: Settings) => Settings) => Promise<Settings>;

    function Harness() {
      const [, setFilters] = useState({});
      const dataRef = useRef<SessionRecord[]>([]);
      const filtersDirtyRef = useRef(false);
      const defaultPeriodDaysRef = useRef(30);
      const state = useSettings({ dataRef, filtersDirtyRef, setFilters, markAuditStale: vi.fn(), defaultPeriodDaysRef });
      enqueue = state.enqueueSettingsSave;
      return null;
    }

    renderHookHarness(createElement(Harness));
    await act(async () => { await Promise.resolve(); });
    const first = enqueue(current => ({ ...current, live: true }));
    const second = enqueue(current => ({ ...current, theme: "dark" }));
    await act(async () => { await Promise.resolve(); });
    expect(mocked.saveSettings).toHaveBeenCalledTimes(1);

    await act(async () => { resolveFirst(); await first; await second; });
    expect(mocked.saveSettings).toHaveBeenCalledTimes(2);
    expect(mocked.saveSettings.mock.calls[1][0]).toMatchObject({ live: true, theme: "dark" });
  });
});

describe("useLiveMode", () => {
  beforeEach(() => {
    mocked.onDbChanged.mockImplementation((callback: () => void) => {
      mocked.dbChanged = callback;
      return Promise.resolve(mocked.unsubscribe);
    });
  });

  it("does not subscribe in demo mode", async () => {
    function Harness() {
      const state = useLiveMode({
        dataMode: "demo", liveActive: true, settings,
        settingsRef: useRef(settings), enqueueSettingsSave: vi.fn().mockResolvedValue(settings),
        reloadData: vi.fn().mockResolvedValue(true), modeChangeInProgress: useRef(false),
      });
      return createElement("span", {}, String(state.live));
    }

    renderHookHarness(createElement(Harness));
    await act(async () => { await Promise.resolve(); });

    expect(mocked.onDbChanged).not.toHaveBeenCalled();
  });

  it("cleans up the database subscription when the mode changes", async () => {
    function Harness() {
      const [dataMode, setDataMode] = useState<"real" | "demo">("real");
      const state = useLiveMode({
        dataMode, liveActive: true, settings,
        settingsRef: useRef(settings), enqueueSettingsSave: vi.fn().mockResolvedValue(settings),
        reloadData: vi.fn().mockResolvedValue(true), modeChangeInProgress: useRef(false),
      });
      return createElement("button", { onClick: () => setDataMode("demo") }, String(state.live));
    }

    const container = renderHookHarness(createElement(Harness));
    await act(async () => { await Promise.resolve(); });
    expect(mocked.onDbChanged).toHaveBeenCalledTimes(1);

    await act(async () => { (container.querySelector("button") as HTMLButtonElement).click(); });

    expect(mocked.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("reloads data when the database emits a change", async () => {
    const reloadData = vi.fn().mockResolvedValue(true);
    function Harness() {
      const state = useLiveMode({
        dataMode: "real", liveActive: true, settings,
        settingsRef: useRef(settings), enqueueSettingsSave: vi.fn().mockResolvedValue(settings),
        reloadData, modeChangeInProgress: useRef(false),
      });
      return createElement("span", {}, String(state.live));
    }

    renderHookHarness(createElement(Harness));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { mocked.dbChanged?.(); });

    expect(reloadData).toHaveBeenCalledWith(false);
  });

  it("keeps live enabled after a successful retry when the watcher was initially inactive", async () => {
    let saveCurrentSettings!: (settings: Settings) => void;
    const enqueueSettingsSave = vi.fn(async (update: (current: Settings) => Settings) => {
      const next = update({ ...settings, live: true });
      saveCurrentSettings(next);
      return next;
    });
    function Harness() {
      const [currentSettings, setCurrentSettings] = useState({ ...settings, live: true });
      saveCurrentSettings = setCurrentSettings;
      const state = useLiveMode({
        dataMode: "real", liveActive: false, settings: currentSettings,
        settingsRef: useRef(currentSettings), enqueueSettingsSave,
        reloadData: vi.fn().mockResolvedValue(true), modeChangeInProgress: useRef(false),
      });
      return createElement("button", { onClick: () => void state.toggleLive() }, String(state.live));
    }

    const container = renderHookHarness(createElement(Harness));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { (container.querySelector("button") as HTMLButtonElement).click(); await Promise.resolve(); });

    expect(enqueueSettingsSave).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("true");
  });

  it("disables persisted live mode even when the watcher is inactive", async () => {
    const initialSettings = { ...settings, live: true };
    const enqueueSettingsSave = vi.fn(async (update: (current: Settings) => Settings) => update(initialSettings));
    function Harness() {
      const settingsRef = useRef(initialSettings);
      const state = useLiveMode({
        dataMode: "real", liveActive: false, settings: initialSettings,
        settingsRef, enqueueSettingsSave,
        reloadData: vi.fn().mockResolvedValue(true), modeChangeInProgress: useRef(false),
      });
      return createElement("button", { onClick: () => void state.disableLive() }, String(state.live));
    }

    const container = renderHookHarness(createElement(Harness));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { (container.querySelector("button") as HTMLButtonElement).click(); await Promise.resolve(); });

    expect(enqueueSettingsSave).toHaveBeenCalledWith(expect.any(Function));
    expect(enqueueSettingsSave.mock.calls[0][0](initialSettings).live).toBe(false);
    expect(container.textContent).toBe("false");
  });

  it("rolls back live and exposes an error when saving the toggle fails", async () => {
    const initialSettings = { ...settings, live: false };
    const enqueueSettingsSave = vi.fn().mockRejectedValue(new Error("save failed"));
    function Harness() {
      const settingsRef = useRef(initialSettings);
      const state = useLiveMode({
        dataMode: "real", liveActive: false, settings: initialSettings,
        settingsRef, enqueueSettingsSave,
        reloadData: vi.fn().mockResolvedValue(true), modeChangeInProgress: useRef(false),
      });
      return createElement("button", { onClick: () => void state.toggleLive() }, `${state.live}|${settingsRef.current.live}|${state.liveError ?? ""}`);
    }

    const container = renderHookHarness(createElement(Harness));
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      (container.firstChild as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(enqueueSettingsSave).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("false|false|app.liveSaveError");
  });

  it("keeps the structured watcher cause when saving the live toggle fails", async () => {
    const initialSettings = { ...settings, live: false };
    const enqueueSettingsSave = vi.fn().mockRejectedValue({ code: "watcher", message: "database is unavailable" });
    function Harness() {
      const settingsRef = useRef(initialSettings);
      const state = useLiveMode({
        dataMode: "real", liveActive: false, settings: initialSettings,
        settingsRef, enqueueSettingsSave,
        reloadData: vi.fn().mockResolvedValue(true), modeChangeInProgress: useRef(false),
      });
      return createElement("button", { onClick: () => void state.toggleLive() }, state.liveError ?? "");
    }

    const container = renderHookHarness(createElement(Harness));
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      (container.firstChild as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(container.textContent).toBe("translated:watcher: database is unavailable");
  });
});

describe("useAudit", () => {
  it("marks reports stale, increments generation and restores focus on back", async () => {
    let markAuditStale!: () => void;
    function Harness() {
      const state = useAudit();
      markAuditStale = state.markAuditStale;
      return createElement("div", {},
        createElement("button", { ref: state.auditButtonRef, onClick: () => state.setShowAudit(open => !open) }, "audit"),
        createElement("div", { ref: state.auditContentRef, tabIndex: -1, "data-testid": "content" }, `generation:${state.auditGeneration} stale:${state.auditStale}`),
      );
    }

    const container = renderHookHarness(createElement(Harness));
    const auditButton = container.querySelector("button") as HTMLButtonElement;
    const auditContent = container.querySelector('[data-testid="content"]') as HTMLDivElement;
    auditButton.focus();

    await act(async () => { markAuditStale(); });
    expect(auditContent.textContent).toBe("generation:1 stale:true");

    await act(async () => { auditButton.click(); });
    expect(document.activeElement).toBe(auditContent);
    await act(async () => { auditButton.click(); });
    expect(document.activeElement).toBe(auditButton);
  });
});
