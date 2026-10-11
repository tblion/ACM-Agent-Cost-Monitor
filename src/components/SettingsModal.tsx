// Edits application preferences, data mode, and live monitoring settings.
import { useState, useEffect, useMemo, useRef, type FormEvent, type RefObject } from "react";
import type { Settings, CustomGroup, BackendLogEntry, InternalStoreStatus, InternalStoreSource, ResolvedPaths, SessionRecord, ConfiguredRateVersion } from "../types";
import { getCatalogRates, pickPath, getResolvedPaths, getInternalStoreStatus, getInternalStoreSources, refreshInternalStoreSource, refreshOpenCodeApi, reimportAllSources, exportInternalStore, mergeInternalStore, getBackendLogs, onBackendLog, translateApiError } from "../api";
import type { DataMode } from "../data-source";
import { useTranslation } from "react-i18next";
import { parseLanguage } from "../i18n/locale";
import { ProjectGroupPicker } from "./ProjectGroupPicker";
import { RatesSection } from "./RatesSection";
import type { AppDataSource } from "../data-source";

interface Props {
  settings: Settings;
  projects: string[];
  dataMode: DataMode;
  onDataModeChange: (mode: DataMode) => void | Promise<void>;
  onClose: () => void;
  onSave: (s: Settings) => void | Promise<void>;
  onStoreChanged: () => void | Promise<void>;
  onOpenAudit: () => void;
  dataSource: AppDataSource;
  currentSessions: SessionRecord[];
  onRecalculationStart: () => void;
  onDataRecalculated: (sessions: SessionRecord[]) => void;
  onRecalculationError: () => void;
  auditButtonRef: RefObject<HTMLButtonElement | null>;
  hidden?: boolean;
}

type SettingsSection = "general" | "sources" | "rates" | "projects" | "diagnostics";
type PricingView = "usage" | "subscriptions";
interface RateDraft {
  provider: string;
  model: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
  effectiveFrom: string;
}

export function SettingsModal({ settings, projects, dataMode, onDataModeChange, onClose, onSave, onStoreChanged, onOpenAudit, dataSource, currentSessions, onRecalculationStart, onDataRecalculated, onRecalculationError, auditButtonRef, hidden = false }: Props) {
  const { t } = useTranslation();
  const [s, setS] = useState<Settings>({
    ...settings,
    customGroups: settings.customGroups.map(g => ({ ...g })),
    customRates: settings.customRates.map(rate => ({ ...rate })),
    fixedSubscriptions: settings.fixedSubscriptions.map(subscription => ({ ...subscription, models: [...subscription.models] })),
  });
  const [groups, setGroups] = useState<CustomGroup[]>(s.customGroups);
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [pricingView, setPricingView] = useState<PricingView>("usage");
  const [rateDraft, setRateDraft] = useState<RateDraft | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [catalogRates, setCatalogRates] = useState<Awaited<ReturnType<typeof getCatalogRates>>>([]);
  const nextGroupId = useRef(0);
  const [groupIds, setGroupIds] = useState(() => settings.customGroups.map(() => `group-${nextGroupId.current++}`));
  const nextSubscriptionId = useRef(0);
  const persistedSubscriptionIds = useRef(new Set(settings.fixedSubscriptions.map(subscription => subscription.id)));
  const nextRateId = useRef(0);
  const [subscriptionIds, setSubscriptionIds] = useState(() => settings.fixedSubscriptions.map(() => `subscription-${nextSubscriptionId.current++}`));
  const [resolved, setResolved] = useState<ResolvedPaths | null>(null);
  const [modeChanging, setModeChanging] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [storeStatus, setStoreStatus] = useState<InternalStoreStatus | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [storeMessage, setStoreMessage] = useState<string | null>(null);
  const [storeBusy, setStoreBusy] = useState(false);
  const [integrationChannels, setIntegrationChannels] = useState<InternalStoreSource[]>([]);
  const [channelBusy, setChannelBusy] = useState<string | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [reimportMessage, setReimportMessage] = useState<string | null>(null);
  const [showBackendLogs, setShowBackendLogs] = useState(false);
  const [backendLogs, setBackendLogs] = useState<BackendLogEntry[]>([]);
  const [backendLogsError, setBackendLogsError] = useState<string | null>(null);
  const backendLogOutputRef = useRef<HTMLPreElement>(null);
  const [saving, setSaving] = useState(false);
  const pageTitleRef = useRef<HTMLHeadingElement>(null);
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    return () => { disposedRef.current = true; };
  }, []);

  // Load resolved paths on mount.
  useEffect(() => {
    getResolvedPaths()
      .then(value => { if (!disposedRef.current) setResolved(value); })
      .catch(() => {});
    getInternalStoreStatus()
      .then(value => { if (!disposedRef.current) setStoreStatus(value); })
      .catch(error => {
        if (!disposedRef.current) setStoreError(translateApiError(error, key => t(key as never), t("settings.storeError")));
      });
    getInternalStoreSources()
      .then(value => { if (!disposedRef.current) setIntegrationChannels(value); })
      .catch(error => {
        if (!disposedRef.current) setChannelError(translateApiError(error, key => t(key as never), t("settings.integrationLoadError")));
      });
  }, [t]);

  useEffect(() => {
    if (!showBackendLogs) return;
    let active = true;
    const unsubscribe = onBackendLog(entry => {
      if (active) setBackendLogs(current => [...current, entry].slice(-2000));
    });
    getBackendLogs()
      .then(entries => { if (active) setBackendLogs(entries.slice(-2000)); })
      .catch(error => {
        if (active) setBackendLogsError(translateApiError(error, key => t(key as never), t("settings.logsError")));
      });
    return () => { active = false; unsubscribe(); };
  }, [showBackendLogs, t]);

  useEffect(() => {
    if (showBackendLogs && backendLogOutputRef.current) {
      backendLogOutputRef.current.scrollTop = backendLogOutputRef.current.scrollHeight;
    }
  }, [backendLogs, showBackendLogs]);

  // Place le focus sur le titre lorsque la page de réglages s’ouvre.
  useEffect(() => {
    pageTitleRef.current?.focus();
  }, []);

  const set = (patch: Partial<Settings>) => setS(prev => ({ ...prev, ...patch }));
  const customRateGroups = useMemo(() => {
    const groups = new Map<string, ConfiguredRateVersion[]>();
    for (const rate of s.customRates) {
      const key = `${rate.provider}\u0000${rate.model}`;
      groups.set(key, [...(groups.get(key) ?? []), rate].sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom)));
    }
    return [...groups.values()];
  }, [s.customRates]);

  useEffect(() => {
    if (activeSection !== "rates" || pricingView !== "usage") return;
    let active = true;
    getCatalogRates().then(rates => { if (active) setCatalogRates(rates); }).catch(() => {});
    return () => { active = false; };
  }, [activeSection, pricingView]);

  const editCustomRate = (rate?: Pick<ConfiguredRateVersion, "provider" | "model" | "input" | "output" | "cacheRead" | "cacheWrite">) => {
    const effectiveFrom = new Date().toISOString().slice(0, 10);
    setRateError(null);
    setRateDraft(rate ? {
      provider: rate.provider,
      model: rate.model,
      input: String(rate.input),
      output: String(rate.output),
      cacheRead: String(rate.cacheRead),
      cacheWrite: String(rate.cacheWrite),
      effectiveFrom,
    } : { provider: "", model: "", input: "", output: "", cacheRead: "", cacheWrite: "", effectiveFrom });
  };

  const saveCustomRateVersion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!rateDraft) return;
    const values = [rateDraft.input, rateDraft.output, rateDraft.cacheRead, rateDraft.cacheWrite].map(Number);
    if (!rateDraft.provider.trim() || !rateDraft.model.trim() || values.some(value => !Number.isFinite(value) || value < 0)
      || !/^\d{4}-\d{2}-\d{2}$/.test(rateDraft.effectiveFrom)
      || !Number.isFinite(Date.parse(`${rateDraft.effectiveFrom}T00:00:00Z`))) {
      setRateError(t("settings.invalidCustomRate"));
      return;
    }
    const effectiveFrom = `${rateDraft.effectiveFrom}T00:00:00Z`;
    const duplicate = s.customRates.some(rate => rate.provider === rateDraft.provider.trim()
      && rate.model === rateDraft.model.trim() && rate.effectiveFrom === effectiveFrom);
    if (duplicate) {
      setRateError(t("settings.duplicateCustomRateDate"));
      return;
    }
    const customRate: ConfiguredRateVersion = {
      id: `manual-rate-${Date.now()}-${nextRateId.current++}`,
      provider: rateDraft.provider.trim(),
      model: rateDraft.model.trim(),
      input: values[0],
      output: values[1],
      cacheRead: values[2],
      cacheWrite: values[3],
      effectiveFrom,
      source: "manual",
    };
    set({ customRates: [...s.customRates, customRate] });
    setRateDraft(null);
    setRateError(null);
  };

  const createSubscriptionVersion = (index: number) => {
    const previous = s.fixedSubscriptions[index];
    if (!previous) return;
    const today = new Date().toISOString().slice(0, 10);
    const previousStart = Date.parse(`${previous.effectiveFrom}T00:00:00Z`);
    let startsOn = today;
    if (Date.parse(`${startsOn}T00:00:00Z`) <= previousStart) {
      startsOn = new Date(previousStart + 86_400_000).toISOString().slice(0, 10);
    }
    const end = new Date(Date.parse(`${startsOn}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const next = {
      ...previous,
      id: `subscription-${Date.now()}-${nextSubscriptionId.current}`,
      effectiveFrom: startsOn,
      effectiveTo: null,
    };
    const fixedSubscriptions = [...s.fixedSubscriptions];
    persistedSubscriptionIds.current.add(previous.id);
    fixedSubscriptions[index] = {
      ...previous,
      effectiveTo: previous.effectiveTo && previous.effectiveTo < end ? previous.effectiveTo : end,
    };
    set({ fixedSubscriptions: [...fixedSubscriptions, next] });
    setSubscriptionIds(current => [...current, `subscription-${nextSubscriptionId.current++}`]);
  };

  const refreshChannel = async (channel: InternalStoreSource) => {
    const key = channel.channelKey;
    setChannelBusy(key);
    setChannelError(null);
    try {
      if (key === "api") await refreshOpenCodeApi();
      else await refreshInternalStoreSource(channel.sourceId);
      await onStoreChanged();
    } catch (error) {
      if (!disposedRef.current) setChannelError(translateApiError(error, value => t(value as never), t("settings.integrationRefreshError")));
    } finally {
      if (!disposedRef.current) {
        setIntegrationChannels(await getInternalStoreSources().catch(() => integrationChannels));
        setChannelBusy(null);
      }
    }
  };

  const reimportAll = async () => {
    setChannelBusy("all");
    setChannelError(null);
    setReimportMessage(null);
    try {
      await reimportAllSources();
      await onStoreChanged();
      if (!disposedRef.current) setReimportMessage(t("settings.reimportComplete"));
    } catch (error) {
      if (!disposedRef.current) await Promise.resolve().then(onStoreChanged).catch(() => {});
      if (!disposedRef.current) setChannelError(translateApiError(error, key => t(key as never), t("settings.reimportError")));
    } finally {
      if (!disposedRef.current) {
        setIntegrationChannels(await getInternalStoreSources().catch(() => integrationChannels));
        setChannelBusy(null);
      }
    }
  };

  const pick = async (field: "dbPath" | "configPath") => {
    if (disposedRef.current) return;
    setPathError(null);
    try {
      const p = await pickPath();
      if (!disposedRef.current && p) set({ [field]: p });
    } catch (error) {
       if (!disposedRef.current) setPathError(translateApiError(error, key => t(key as never), t("settings.pathError")));
    }
  };

  const save = async () => {
    if (disposedRef.current) return;
    if (s.fixedSubscriptions.some(subscription => !subscription.provider.trim()
      || !Number.isFinite(subscription.amount) || subscription.amount <= 0
      || !subscription.effectiveFrom
      || (subscription.effectiveTo !== null && subscription.effectiveTo < subscription.effectiveFrom))) {
      setSaveError(t("settings.subscriptionInvalid"));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ ...s, customGroups: groups });
    } catch (error) {
       if (!disposedRef.current) setSaveError(translateApiError(error, key => t(key as never), t("settings.saveError")));
    } finally {
      if (!disposedRef.current) setSaving(false);
    }
  };

  const changeMode = async (mode: DataMode) => {
    if (disposedRef.current) return;
    setModeChanging(true);
    setModeError(null);
    try {
      await onDataModeChange(mode);
    } catch (error) {
       if (!disposedRef.current) setModeError(translateApiError(error, key => t(key as never), t("settings.modeError")));
    } finally {
      if (!disposedRef.current) setModeChanging(false);
    }
  };

  const exportStore = async () => {
    if (disposedRef.current) return;
    setStoreBusy(true);
    setStoreError(null);
    setStoreMessage(null);
    try {
      const path = await exportInternalStore();
      if (disposedRef.current || !path) return;
      setStoreMessage(t("settings.storeExportSuccess", { path }));
      setStoreStatus(await getInternalStoreStatus());
    } catch (error) {
      if (!disposedRef.current) setStoreError(translateApiError(error, key => t(key as never), t("settings.storeError")));
    } finally {
      if (!disposedRef.current) setStoreBusy(false);
    }
  };

  const mergeStore = async () => {
    if (disposedRef.current) return;
    setStoreBusy(true);
    setStoreError(null);
    setStoreMessage(null);
    try {
      const result = await mergeInternalStore();
      if (disposedRef.current || !result) return;
      setStoreStatus(await getInternalStoreStatus());
      await onStoreChanged();
      if (!disposedRef.current) setStoreMessage(t("settings.storeMergeSuccess", { ...result }));
    } catch (error) {
      if (!disposedRef.current) setStoreError(translateApiError(error, key => t(key as never), t("settings.storeError")));
    } finally {
      if (!disposedRef.current) setStoreBusy(false);
    }
  };

  return (
    <main className="settings-page" aria-labelledby="settings-title" hidden={hidden}>
      <header className="settings-page-header">
        <div>
          <h1 id="settings-title" ref={pageTitleRef} tabIndex={-1}>{t("settings.title")}</h1>
          <p>{t("settings.pageDescription")}</p>
        </div>
        <button type="button" onClick={onClose} className="settings-back">{t("settings.backToDashboard")}</button>
      </header>
      <div className="settings-page-layout">
        <nav className="settings-section-nav" aria-label={t("settings.navigationLabel")}>
          {([
            ["general", "settings.sectionGeneral"],
            ["sources", "settings.sectionSources"],
            ["rates", "settings.sectionRates"],
            ["projects", "settings.sectionProjects"],
            ["diagnostics", "settings.sectionDiagnostics"],
          ] as const).map(([section, label]) => (
            <button key={section} type="button" data-section={section} aria-current={activeSection === section ? "page" : undefined} onClick={() => setActiveSection(section)}>
              {t(label)}
            </button>
          ))}
          <button type="button" className="settings-tool-link" ref={auditButtonRef} onClick={() => { onClose(); onOpenAudit(); }}>
            {t("header.auditLabel")}
          </button>
        </nav>
        <div className="settings-body">

        {(activeSection === "sources" || activeSection === "diagnostics") && <section className="settings-section" aria-labelledby="settings-sources-title">
        {activeSection === "sources" && <>
        <h2 id="settings-sources-title">{t("settings.sectionSources")}</h2>
        <label htmlFor="db-path" style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{t("settings.databasePath")}</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input id="db-path" value={s.dbPath ?? ""} onChange={e => set({ dbPath: e.target.value || null })}
            placeholder={resolved?.db ?? t("settings.defaultPath")}
            style={{ flex: 1, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "var(--text)" }}
            aria-label={t("settings.databasePathLabel")} />
          <button onClick={() => pick("dbPath")} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 12, cursor: "pointer" }}>{t("settings.browse")}</button>
        </div>
         {pathError && <p role="alert" style={{ color: "var(--error)", fontSize: 12 }}>{t(pathError, { defaultValue: pathError })}</p>}

         <section aria-labelledby="integrations-title" style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 16 }}>
           <h3 id="integrations-title" style={{ margin: "0 0 8px", fontSize: 13 }}>{t("settings.integrations")}</h3>
            <button type="button" onClick={() => void reimportAll()} disabled={channelBusy !== null} aria-busy={channelBusy === "all"}>
              {channelBusy === "all" ? t("settings.reimportWorking") : t("settings.reimportAll")}
            </button>
            {reimportMessage && <p role="status" style={{ color: "var(--accent)", fontSize: 11 }}>{reimportMessage}</p>}
            <article aria-labelledby="opencode-integration-title">
             <h4 id="opencode-integration-title" style={{ margin: "0 0 8px", fontSize: 12 }}>OpenCode</h4>
             <p style={{ margin: "0 0 8px", color: "var(--muted)", fontSize: 10 }}>{t("settings.integrationLiveInfo")}</p>
             {integrationChannels.map(channel => <div key={channel.channelKey} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--border)" }}>
               <div style={{ minWidth: 0 }}>
                 <strong style={{ display: "block", fontSize: 11 }}>{channel.channelKey === "api" ? t("header.opencodeApi") : t("header.databaseChannel")}</strong>
                 <span title={channel.sourcePath} style={{ display: "block", color: "var(--muted)", fontSize: 10, overflowWrap: "anywhere" }}>{channel.sourcePath}</span>
                 <span style={{ display: "block", color: channel.lastSyncError ? "var(--error)" : "var(--muted)", fontSize: 10 }}>
                   {channel.lastSyncError
                     ? t("settings.integrationChannelError", { details: channel.lastSyncError })
                     : t("settings.integrationChannelUpdated", { value: channel.lastImportedAt ? new Date(channel.lastImportedAt).toLocaleString() : t("header.sourceNeverUpdated") })}
                 </span>
               </div>
                <button type="button" onClick={() => void refreshChannel(channel)} disabled={channelBusy !== null} aria-busy={channelBusy === channel.channelKey}>
                 {channelBusy === channel.channelKey ? t("header.sourceRefreshing") : t("header.sourceRefresh")}
               </button>
             </div>)}
             {integrationChannels.length === 0 && <p style={{ color: "var(--muted)", fontSize: 11 }}>{t("settings.integrationLoading")}</p>}
             {channelError && <p role="alert" style={{ color: "var(--error)", fontSize: 11 }}>{channelError}</p>}
           </article>
         </section>

        </>}
        {activeSection === "diagnostics" && <>
          <h2 id="settings-sources-title">{t("settings.sectionDiagnostics")}</h2>
         <section id="settings-diagnostics" aria-labelledby="internal-store-title" aria-busy={storeBusy} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 16 }}>
          <h3 id="internal-store-title" style={{ margin: "0 0 6px", fontSize: 13 }}>{t("settings.internalStore")}</h3>
          <p style={{ margin: "0 0 6px", fontSize: 11, color: "var(--muted)", overflowWrap: "anywhere" }}>
            {storeStatus?.databasePath ?? t("settings.storeLoading")}
          </p>
          {storeStatus && <p style={{ margin: "0 0 8px", fontSize: 11, color: "var(--muted)" }}>
            {t("settings.storeCounts", {
              projects: storeStatus.projects,
              sessions: storeStatus.sessions,
              messages: storeStatus.messages,
              sources: storeStatus.sources,
            })}
          </p>}
          {storeStatus?.lastSyncError && <p role="status" style={{ margin: "0 0 8px", fontSize: 11, color: "var(--error)" }}>
            {t("settings.storeSyncWarning", { details: storeStatus.lastSyncError })}
          </p>}
          <p style={{ margin: "0 0 10px", fontSize: 11, color: "var(--muted)" }}>{t("settings.storeMergeExplanation")}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => void exportStore()} disabled={storeBusy} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 11, cursor: storeBusy ? "wait" : "pointer" }}>
              {storeBusy ? t("settings.storeWorking") : t("settings.storeExport")}
            </button>
            <button onClick={() => void mergeStore()} disabled={storeBusy} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 11, cursor: storeBusy ? "wait" : "pointer" }}>
              {storeBusy ? t("settings.storeWorking") : t("settings.storeMerge")}
            </button>
          </div>
          <button
            type="button"
            aria-expanded={showBackendLogs}
            aria-controls="backend-log-output"
            onClick={() => { setBackendLogsError(null); setShowBackendLogs(value => !value); }}
            style={{ marginTop: 10, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 11, cursor: "pointer" }}
          >
            {showBackendLogs ? t("settings.hideLogs") : t("settings.showLogs")}
          </button>
          {showBackendLogs && <>
            {backendLogsError && <p role="alert" style={{ color: "var(--error)", fontSize: 12 }}>{backendLogsError}</p>}
            <pre
              id="backend-log-output"
              ref={backendLogOutputRef}
              role="log"
              aria-label={t("settings.logsTitle")}
              aria-live="off"
              tabIndex={0}
              style={{ maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, margin: "10px 0 0", font: "11px/1.5 ui-monospace, SFMono-Regular, monospace", color: "var(--text)" }}
            >
              {backendLogs.length > 0
                ? backendLogs.map(entry => `${entry.timestamp} [${entry.level}] ${entry.message}${entry.exception ? `\n${entry.exception}` : ""}`).join("\n")
                : t("settings.logsEmpty")}
            </pre>
          </>}
          {storeError && <p role="alert" style={{ color: "var(--error)", fontSize: 12 }}>{storeError}</p>}
          <p role="status" style={{ color: "var(--live)", fontSize: 12, margin: storeMessage ? "8px 0 0" : 0 }}>
            {storeMessage ?? ""}
         </p>
        </section>
        </>}

        {activeSection === "sources" && <>
         <label htmlFor="config-path" style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{t("settings.configPath")}</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input id="config-path" value={s.configPath ?? ""} onChange={e => set({ configPath: e.target.value || null })}
            placeholder={resolved?.config ?? t("settings.defaultPath")}
            style={{ flex: 1, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "var(--text)" }}
            aria-label={t("settings.configPathLabel")} />
          <button onClick={() => pick("configPath")} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 12, cursor: "pointer" }}>{t("settings.browse")}</button>
         </div>
        </>}
        </section>}

         {activeSection === "rates" && <section id="settings-rates" className="settings-section" aria-labelledby="settings-rates-title">
           <h2 id="settings-rates-title">{t("settings.sectionRates")}</h2>
           <div className="settings-pricing-tabs" role="group" aria-label={t("settings.pricingViews")}>
             <button type="button" aria-pressed={pricingView === "usage"} onClick={() => setPricingView("usage")}>{t("settings.usageRates")}</button>
             <button type="button" aria-pressed={pricingView === "subscriptions"} onClick={() => setPricingView("subscriptions")}>{t("settings.subscriptions")}</button>
           </div>
           {pricingView === "usage" && <>
             <h3>{t("settings.usageRates")}</h3>
             <p>{t("settings.customRateHistoryHelp")}</p>
             {customRateGroups.map(versions => {
               const latest = versions[versions.length - 1];
               const catalogueReference = catalogRates.find(rate => rate.provider === latest.provider && rate.model === latest.model && rate.source === "catalog");
               return <article key={`${latest.provider}:${latest.model}`} aria-label={`${latest.provider}/${latest.model}`} className="custom-rate-entry" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
                 <strong>{latest.provider}/{latest.model}</strong>
                 <p>{t("settings.rateVersionCount", { count: versions.length })}</p>
                 <ul>{versions.map(version => <li key={version.id}>
                   {version.effectiveFrom} · {t(version.source === "catalog-reference" ? "settings.catalogReference" : "settings.manualRateSource")} · input {version.input} · output {version.output} · cache read {version.cacheRead} · cache write {version.cacheWrite}
                 </li>)}</ul>
                 <button type="button" aria-label={t("settings.newRateVersion", { provider: latest.provider, model: latest.model })} onClick={() => editCustomRate(latest)}>{t("settings.newRateVersionAction")}</button>
                 {catalogueReference && <button type="button" onClick={() => {
                   const effectiveFrom = `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;
                   if (s.customRates.some(rate => rate.provider === latest.provider && rate.model === latest.model && rate.effectiveFrom === effectiveFrom)) {
                     setRateError(t("settings.duplicateCustomRateDate"));
                     return;
                   }
                   set({ customRates: [...s.customRates, {
                     id: `catalog-rate-${Date.now()}-${nextRateId.current++}`,
                     provider: latest.provider,
                     model: latest.model,
                     input: catalogueReference.input,
                     output: catalogueReference.output,
                     cacheRead: catalogueReference.cacheRead,
                     cacheWrite: catalogueReference.cacheWrite,
                     effectiveFrom,
                     source: "catalog-reference",
                   }] });
                 }}>{t("settings.restoreCatalogRate")}</button>}
               </article>;
             })}
             {catalogRates.filter(rate => rate.source === "catalog").map(rate => <article key={`catalog:${rate.provider}:${rate.model}`} className="catalog-rate-entry" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
               <strong>{rate.provider}/{rate.model}</strong>
               <p>{t("settings.catalogReference")}: input {rate.input} · output {rate.output} · cache read {rate.cacheRead} · cache write {rate.cacheWrite} · {rate.effectiveFrom ?? t("rates.currentRate")}</p>
               <button type="button" aria-label={t("settings.customizeCatalogRate", { provider: rate.provider, model: rate.model })} onClick={() => editCustomRate(rate)}>{t("settings.customizeCatalogRateAction")}</button>
             </article>)}
             <button type="button" onClick={() => editCustomRate()}>{t("settings.addCustomRate")}</button>
             {rateDraft && <form onSubmit={saveCustomRateVersion} aria-label={t("settings.customRateForm")}>
               <fieldset style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 12, padding: 10 }}>
                 <legend>{t("settings.customRateForm")}</legend>
                 <label style={{ display: "grid", gap: 4 }}>{t("settings.rateProvider")}
                   <input required value={rateDraft.provider} onChange={event => setRateDraft({ ...rateDraft, provider: event.target.value })} />
                 </label>
                 <label style={{ display: "grid", gap: 4 }}>{t("settings.rateModel")}
                   <input required value={rateDraft.model} aria-label={t("settings.rateModelExact")} onChange={event => setRateDraft({ ...rateDraft, model: event.target.value })} />
                 </label>
                 {(["input", "output", "cacheRead", "cacheWrite"] as const).map(field => <label key={field} style={{ display: "grid", gap: 4 }}>
                   {t(`settings.rate${field[0].toUpperCase()}${field.slice(1)}` as never)}
                   <input type="number" min="0" step="any" required value={rateDraft[field]} onChange={event => setRateDraft({ ...rateDraft, [field]: event.target.value })} />
                 </label>)}
                 <label style={{ display: "grid", gap: 4 }}>{t("settings.rateEffectiveFrom")}
                   <input type="date" required value={rateDraft.effectiveFrom} onChange={event => setRateDraft({ ...rateDraft, effectiveFrom: event.target.value })} />
                 </label>
                 <p style={{ gridColumn: "1 / -1" }}>{t("settings.zeroRateHelp")}</p>
                 {rateError && <p role="alert" style={{ gridColumn: "1 / -1", color: "var(--error)" }}>{rateError}</p>}
                 <button type="submit">{t("settings.saveRateVersion")}</button>
                 <button type="button" onClick={() => { setRateDraft(null); setRateError(null); }}>{t("settings.cancel")}</button>
               </fieldset>
             </form>}
             <RatesSection dataSource={dataSource} currentSessions={currentSessions} onRecalculationStart={onRecalculationStart} onDataRecalculated={onDataRecalculated} onRecalculationError={onRecalculationError} />
           </>}
           {pricingView === "subscriptions" && <>
           <h3>{t("settings.subscriptions")}</h3>
           <section aria-labelledby="fixed-subscriptions-title" style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 16 }}>
            <h3 id="fixed-subscriptions-title" style={{ margin: "0 0 6px", fontSize: 13 }}>{t("settings.fixedSubscriptions")}</h3>
            <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 11, lineHeight: 1.5 }}>{t("settings.fixedSubscriptionsHelp")}</p>
            <p>{t("settings.subscriptionHistoryHelp")}</p>
            <p>{t("settings.subscriptionPublicPriceNote")}</p>
            {s.fixedSubscriptions.map((subscription, index) => {
              const id = subscriptionIds[index];
              const isPersistedVersion = persistedSubscriptionIds.current.has(subscription.id);
              const updateSubscription = (patch: Partial<typeof subscription>) => {
                if (persistedSubscriptionIds.current.has(subscription.id)) return;
                const fixedSubscriptions = [...s.fixedSubscriptions];
               fixedSubscriptions[index] = { ...subscription, ...patch };
               set({ fixedSubscriptions });
             };
             return (
                <fieldset key={id} style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, margin: "0 0 12px", padding: 10, border: "1px solid var(--border)", borderRadius: 8 }}>
                 <legend style={{ padding: "0 4px", color: "var(--muted)", fontSize: 11 }}>{t("settings.subscriptionLegend", { index: index + 1 })}</legend>
                 <label htmlFor={`${id}-provider`} style={{ display: "grid", gap: 4, color: "var(--muted)", fontSize: 11 }}>
                   {t("settings.subscriptionProvider")}
                    <input id={`${id}-provider`} value={subscription.provider} disabled={isPersistedVersion} onChange={event => updateSubscription({ provider: event.target.value })} style={{ minWidth: 0, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 8px", color: "var(--text)" }} />
                 </label>
                 <label htmlFor={`${id}-amount`} style={{ display: "grid", gap: 4, color: "var(--muted)", fontSize: 11 }}>
                   {t("settings.subscriptionAmount")}
                    <input id={`${id}-amount`} type="number" min="0.01" step="0.01" value={subscription.amount || ""} disabled={isPersistedVersion} onChange={event => updateSubscription({ amount: Number(event.target.value) })} style={{ minWidth: 0, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 8px", color: "var(--text)" }} />
                 </label>
                 <label htmlFor={`${id}-period`} style={{ display: "grid", gap: 4, color: "var(--muted)", fontSize: 11 }}>
                   {t("settings.subscriptionPeriod")}
                    <select id={`${id}-period`} value={subscription.period} disabled={isPersistedVersion} onChange={event => updateSubscription({ period: event.target.value as typeof subscription.period })} style={{ minWidth: 0, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 8px", color: "var(--text)" }}>
                     <option value="monthly">{t("settings.subscriptionMonthly")}</option>
                     <option value="annual">{t("settings.subscriptionAnnual")}</option>
                   </select>
                 </label>
                 <label htmlFor={`${id}-from`} style={{ display: "grid", gap: 4, color: "var(--muted)", fontSize: 11 }}>
                   {t("settings.subscriptionStart")}
                    <input id={`${id}-from`} type="date" value={subscription.effectiveFrom} disabled={isPersistedVersion} onChange={event => updateSubscription({ effectiveFrom: event.target.value })} style={{ minWidth: 0, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 8px", color: "var(--text)" }} />
                 </label>
                 <label htmlFor={`${id}-to`} style={{ display: "grid", gap: 4, color: "var(--muted)", fontSize: 11 }}>
                   {t("settings.subscriptionEnd")}
                    <input id={`${id}-to`} type="date" value={subscription.effectiveTo ?? ""} min={subscription.effectiveFrom} disabled={isPersistedVersion} onChange={event => updateSubscription({ effectiveTo: event.target.value || null })} style={{ minWidth: 0, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 8px", color: "var(--text)" }} />
                 </label>
                 <label htmlFor={`${id}-models`} style={{ gridColumn: "1 / -1", display: "grid", gap: 4, color: "var(--muted)", fontSize: 11 }}>
                   {t("settings.subscriptionModels")}
                    <textarea id={`${id}-models`} rows={2} value={subscription.models.join("\n")} disabled={isPersistedVersion} onChange={event => updateSubscription({ models: event.target.value.split(/\r?\n/).map(model => model.trim()).filter(Boolean) })} aria-describedby={`${id}-models-help`} style={{ resize: "vertical", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 8px", color: "var(--text)", font: "inherit", fontSize: 12 }} />
                   <span id={`${id}-models-help`}>{t("settings.subscriptionModelsHelp")}</span>
                 </label>
                  <button type="button" disabled={isPersistedVersion} onClick={() => { set({ fixedSubscriptions: s.fixedSubscriptions.filter((_, itemIndex) => itemIndex !== index) }); setSubscriptionIds(current => current.filter((_, itemIndex) => itemIndex !== index)); }} aria-label={t("settings.deleteSubscription", { index: index + 1 })} style={{ gridColumn: "1 / -1", justifySelf: "start", border: 0, background: "none", color: "var(--error)", cursor: "pointer" }}>{t("settings.deleteSubscriptionButton")}</button>
                  <button type="button" aria-label={t("settings.newSubscriptionVersion", { provider: subscription.provider || t("settings.subscriptionProvider") })} onClick={() => createSubscriptionVersion(index)} style={{ gridColumn: "1 / -1", justifySelf: "start" }}>{t("settings.newSubscriptionVersionAction")}</button>
               </fieldset>
             );
           })}
           <button type="button" onClick={() => {
             const now = new Date();
             const effectiveFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
              set({ fixedSubscriptions: [...s.fixedSubscriptions, { id: `subscription-${nextSubscriptionId.current}`, provider: "", amount: 0, period: "monthly", models: [], effectiveFrom, effectiveTo: null }] });
             setSubscriptionIds(current => [...current, `subscription-${nextSubscriptionId.current++}`]);
           }} style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: "6px 12px", background: "none", color: "var(--control-text)", cursor: "pointer" }}>{t("settings.addSubscription")}</button>
             </section></>}
          </section>}

          {activeSection === "general" && <section id="settings-general" className="settings-section">
         <h2>{t("settings.sectionGeneral")}</h2>
         <label htmlFor="theme-select" style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{t("settings.theme")}</label>
        <select id="theme-select" value={s.theme} onChange={e => set({ theme: e.target.value as Settings["theme"] })} style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "var(--text)", marginBottom: 14 }} aria-label={t("settings.theme")}>
          <option value="system">{t("settings.system")}</option><option value="light">{t("settings.light")}</option><option value="dark">{t("settings.dark")}</option>
        </select>

        <label htmlFor="language-select" style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{t("settings.language.label")}</label>
        <select id="language-select" value={parseLanguage(s.language) ?? "system"} onChange={e => set({ language: parseLanguage(e.target.value) })} style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "var(--text)", marginBottom: 14 }} aria-label={t("settings.language.label")}>
          <option value="system">{t("settings.language.system")}</option>
          <option value="fr">{t("settings.language.french")}</option>
          <option value="en">{t("settings.language.english")}</option>
        </select>

        <fieldset className="data-mode-control" disabled={modeChanging} aria-busy={modeChanging} aria-describedby={modeError ? "data-mode-error" : undefined}>
          <legend>{t("settings.dataMode")}</legend>
          <label>
            <input type="radio" name="data-mode" value="real" checked={dataMode === "real"} onChange={() => void changeMode("real")} />
            {t("settings.realMode")}
          </label>
          <label>
            <input type="radio" name="data-mode" value="demo" checked={dataMode === "demo"} onChange={() => void changeMode("demo")} />
            {t("settings.demoMode")}
          </label>
           {modeError && <p id="data-mode-error" role="alert" style={{ color: "var(--error)" }}>{t(modeError, { defaultValue: modeError })}</p>}
        </fieldset>

         <label htmlFor="period-days" style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{t("settings.defaultPeriod")}</label>
         <input id="period-days" type="number" min={1} value={s.defaultPeriodDays} onChange={e => set({ defaultPeriodDays: Number(e.target.value) })} style={{ width: 120, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "var(--text)", marginBottom: 18 }} aria-label={t("settings.defaultPeriodLabel")} />
          </section>}

          {activeSection === "projects" && <section id="settings-projects" className="settings-section">
         <h2>{t("settings.sectionProjects")}</h2>
         <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{t("settings.customGroups")}</div>
        {groups.map((g, i) => (
          <div key={groupIds[i]} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input value={g.name} placeholder={t("settings.groupName")} onChange={e => { const ng = [...groups]; ng[i] = { ...g, name: e.target.value }; setGroups(ng); }} style={{ flex: 1, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "var(--text)" }} aria-label={t("settings.groupNameLabel", { index: i + 1 })} />
             <ProjectGroupPicker availableProjects={projects} selectedProjects={g.projects} onChange={selectedProjects => { const ng = [...groups]; ng[i] = { ...g, projects: selectedProjects }; setGroups(ng); }} ariaLabel={t("settings.groupProjectsLabel", { index: i + 1 })} />
             <button onClick={() => { setGroups(current => current.filter((_, j) => j !== i)); setGroupIds(current => current.filter((_, j) => j !== i)); }} aria-label={t("settings.deleteGroup", { index: i + 1 })} style={{ background: "none", border: "none", color: "var(--control-text)", cursor: "pointer" }}>×</button>
          </div>
         ))}
         <button onClick={() => { setGroups(current => [...current, { name: "", projects: [] }]); setGroupIds(current => [...current, `group-${nextGroupId.current++}`]); }} style={{ background: "none", border: "1px dashed var(--border)", borderRadius: 8, padding: "6px 12px", fontSize: 12, color: "var(--control-text)", cursor: "pointer", marginBottom: 20 }}>{t("settings.addGroup")}</button>
          </section>}

         <div className="settings-actions">
           {saveError && <p role="alert">{t(saveError, { defaultValue: saveError })}</p>}
           <button onClick={onClose} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>{t("settings.cancel")}</button>
            <button onClick={() => void save()} disabled={saving} style={{ background: "var(--accent)", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "var(--accent-text)", cursor: saving ? "wait" : "pointer" }}>{saving ? t("settings.saving") : t("settings.save")}</button>
         </div>
        </div>
      </div>
    </main>
  );
}
