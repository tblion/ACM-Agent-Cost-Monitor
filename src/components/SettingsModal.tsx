// Edits application preferences, data mode, and live monitoring settings.
import { useState, useEffect, useRef } from "react";
import type { Settings, CustomGroup, BackendLogEntry, InternalStoreStatus, InternalStoreSource, ResolvedPaths } from "../types";
import { pickPath, getResolvedPaths, getInternalStoreStatus, getInternalStoreSources, refreshInternalStoreSource, refreshOpenCodeApi, exportInternalStore, mergeInternalStore, getBackendLogs, onBackendLog, translateApiError } from "../api";
import type { DataMode } from "../data-source";
import { getFocusTrapTarget } from "../lib/rates";
import { useTranslation } from "react-i18next";
import { parseLanguage } from "../i18n/locale";
import { ProjectGroupPicker } from "./ProjectGroupPicker";

interface Props {
  settings: Settings;
  projects: string[];
  dataMode: DataMode;
  onDataModeChange: (mode: DataMode) => void | Promise<void>;
  onClose: () => void;
  onSave: (s: Settings) => void | Promise<void>;
  onStoreChanged: () => void | Promise<void>;
}

export function SettingsModal({ settings, projects, dataMode, onDataModeChange, onClose, onSave, onStoreChanged }: Props) {
  const { t } = useTranslation();
  const [s, setS] = useState<Settings>({ ...settings, customGroups: settings.customGroups.map(g => ({ ...g })) });
  const [groups, setGroups] = useState<CustomGroup[]>(s.customGroups);
  const nextGroupId = useRef(0);
  const [groupIds, setGroupIds] = useState(() => settings.customGroups.map(() => `group-${nextGroupId.current++}`));
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
  const [showBackendLogs, setShowBackendLogs] = useState(false);
  const [backendLogs, setBackendLogs] = useState<BackendLogEntry[]>([]);
  const [backendLogsError, setBackendLogsError] = useState<string | null>(null);
  const backendLogOutputRef = useRef<HTMLPreElement>(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const disposedRef = useRef(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

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

  // Focus trap + Escape handling + focus restoration on close.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () => dialogRef.current
      ? Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
          .filter(el => !el.hasAttribute("disabled"))
      : [];
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onCloseRef.current(); return; }
      if (e.key === "Tab") {
        const f = focusables();
        const target = getFocusTrapTarget(f, document.activeElement, e.shiftKey);
        if (target) { e.preventDefault(); target.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus(); };
  }, []);

  const set = (patch: Partial<Settings>) => setS(prev => ({ ...prev, ...patch }));

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
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel" ref={dialogRef} style={{ width: 520, maxWidth: "92vw", maxHeight: "85vh", overflowY: "auto" }} role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 id="settings-title" style={{ margin: 0, fontSize: 16 }}>{t("settings.title")}</h2>
           <button onClick={onClose} aria-label={t("settings.close")} className="modal-close">×</button>
        </div>

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

        <section aria-labelledby="internal-store-title" aria-busy={storeBusy} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 16 }}>
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

        <label htmlFor="config-path" style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{t("settings.configPath")}</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input id="config-path" value={s.configPath ?? ""} onChange={e => set({ configPath: e.target.value || null })}
            placeholder={resolved?.config ?? t("settings.defaultPath")}
            style={{ flex: 1, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "var(--text)" }}
            aria-label={t("settings.configPathLabel")} />
          <button onClick={() => pick("configPath")} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 12, cursor: "pointer" }}>{t("settings.browse")}</button>
        </div>

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

        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{t("settings.customGroups")}</div>
        {groups.map((g, i) => (
          <div key={groupIds[i]} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input value={g.name} placeholder={t("settings.groupName")} onChange={e => { const ng = [...groups]; ng[i] = { ...g, name: e.target.value }; setGroups(ng); }} style={{ flex: 1, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "var(--text)" }} aria-label={t("settings.groupNameLabel", { index: i + 1 })} />
             <ProjectGroupPicker availableProjects={projects} selectedProjects={g.projects} onChange={selectedProjects => { const ng = [...groups]; ng[i] = { ...g, projects: selectedProjects }; setGroups(ng); }} ariaLabel={t("settings.groupProjectsLabel", { index: i + 1 })} />
             <button onClick={() => { setGroups(current => current.filter((_, j) => j !== i)); setGroupIds(current => current.filter((_, j) => j !== i)); }} aria-label={t("settings.deleteGroup", { index: i + 1 })} style={{ background: "none", border: "none", color: "var(--control-text)", cursor: "pointer" }}>×</button>
          </div>
        ))}
        <button onClick={() => { setGroups(current => [...current, { name: "", projects: [] }]); setGroupIds(current => [...current, `group-${nextGroupId.current++}`]); }} style={{ background: "none", border: "1px dashed var(--border)", borderRadius: 8, padding: "6px 12px", fontSize: 12, color: "var(--control-text)", cursor: "pointer", marginBottom: 20 }}>{t("settings.addGroup")}</button>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>{t("settings.cancel")}</button>
           <button onClick={() => void save()} disabled={saving} style={{ background: "var(--accent)", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "var(--accent-text)", cursor: saving ? "wait" : "pointer" }}>{saving ? t("settings.saving") : t("settings.save")}</button>
        </div>
          {saveError && <p role="alert" style={{ color: "var(--error)", fontSize: 12 }}>{t(saveError, { defaultValue: saveError })}</p>}
      </div>
    </div>
  );
}
