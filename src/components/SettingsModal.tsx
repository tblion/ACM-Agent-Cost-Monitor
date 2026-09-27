// src/components/SettingsModal.tsx
import { useState, useEffect, useRef } from "react";
import type { Settings, CustomGroup, ResolvedPaths } from "../types";
import { pickPath, getResolvedPaths, translateApiError } from "../api";
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
}

export function SettingsModal({ settings, projects, dataMode, onDataModeChange, onClose, onSave }: Props) {
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
  }, []);

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
