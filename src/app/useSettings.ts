// Loads, saves, and exposes application settings state.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getSettingsStatus, saveSettings, translateApiError } from "../api";
import type { SessionRecord, Settings } from "../types";
import { applyTheme, detectOS } from "../theme";
import i18n, { i18nReady } from "../i18n/config";
import { resolveLanguage } from "../i18n/locale";
import { defaultFilters } from "./defaultFilters";

interface UseSettingsOptions {
  dataRef: React.RefObject<SessionRecord[]>;
  filtersDirtyRef: React.RefObject<boolean>;
  setFilters: React.Dispatch<React.SetStateAction<import("../lib/aggregate").Filters>>;
  markAuditStale: () => void;
  defaultPeriodDaysRef: React.RefObject<number>;
  onSettingsSaved?: () => void;
}

export function useSettings({ dataRef, filtersDirtyRef, setFilters, markAuditStale, defaultPeriodDaysRef, onSettingsSaved }: UseSettingsOptions) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsError, setSettingsError] = useState<{ key: string; details?: string } | null>(null);
  const [liveActive, setLiveActive] = useState(false);
  const settingsRef = useRef<Settings | null>(null);
  const settingsSaveQueue = useRef(Promise.resolve());
  const mountedRef = useRef(false);
  const markAuditStaleRef = useRef(markAuditStale);
  markAuditStaleRef.current = markAuditStale;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const syncDocumentLanguage = (language: string) => {
      document.documentElement.lang = resolveLanguage(language);
    };
    syncDocumentLanguage(i18n.language);
    i18n.on("languageChanged", syncDocumentLanguage);
    return () => { i18n.off("languageChanged", syncDocumentLanguage); };
  }, []);

  useEffect(() => {
    let disposed = false;
    setSettingsError(null);
    getSettingsStatus().then(async response => {
      if (disposed) return;
      const nextSettings = response.settings;
      setSettingsError(response.diagnostic ? {
        key: response.diagnostic.code === "settings"
          ? "app.settingsInvalid"
          : translateApiError(response.diagnostic, key => t(key as never)),
        details: response.diagnostic.code === "settings" ? response.diagnostic.message : undefined,
      } : null);
      await i18nReady;
      if (disposed) return;
      await i18n.changeLanguage(resolveLanguage(nextSettings.language));
      if (disposed) return;
      settingsRef.current = nextSettings;
      defaultPeriodDaysRef.current = nextSettings.defaultPeriodDays;
      setSettings(nextSettings);
      setLiveActive(response.liveActive ?? false);
      if (!filtersDirtyRef.current) {
        setFilters(current => dataRef.current.length > 0 ? defaultFilters(dataRef.current, nextSettings.defaultPeriodDays) : current);
      }
      applyTheme(detectOS(), nextSettings.theme);
    }).catch(error => {
      if (!disposed) setSettingsError({ key: translateApiError(error, key => t(key as never), t("app.settingsLoadError")) });
    });
    return () => { disposed = true; };
  }, [dataRef, filtersDirtyRef, setFilters]);

  useEffect(() => {
    if (settings) applyTheme(detectOS(), settings.theme);
  }, [settings?.theme]);

  const enqueueSettingsSave = (update: (current: Settings) => Settings) => {
    const operation = settingsSaveQueue.current.catch(() => undefined).then(async () => {
      const current = settingsRef.current;
      if (!current) throw new Error("Settings are not loaded");
      const next = update(current);
      await saveSettings(next);
      setSettingsError(null);
      settingsRef.current = next;
      defaultPeriodDaysRef.current = next.defaultPeriodDays;
      markAuditStaleRef.current();
      if (mountedRef.current) setSettings(next);
      return next;
    });
    settingsSaveQueue.current = operation.then(() => undefined, () => undefined);
    return operation;
  };

  const saveSettingsAndClose = async (nextSettings: Settings, close: () => void) => {
    await enqueueSettingsSave(current => ({ ...nextSettings, live: current.live }));
    onSettingsSaved?.();
    await i18n.changeLanguage(resolveLanguage(nextSettings.language));
    if (mountedRef.current) close();
  };

  return {
    settings,
    settingsRef,
    setLiveActive,
    defaultPeriodDaysRef,
    settingsError,
    liveActive,
    enqueueSettingsSave,
    saveSettingsAndClose,
    translateSettingsError: (key: string, details?: string) => t(key, { defaultValue: key, details: details ?? "" }),
  };
}
