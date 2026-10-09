// Manages live database watching and its persisted settings state.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { onDbChanged, translateApiError } from "../api";
import type { Settings } from "../types";
import type { DataMode } from "../data-source";
import { isLiveAvailable } from "../lib/app-state";

interface UseLiveModeOptions {
  dataMode: DataMode;
  liveActive: boolean;
  settings: Settings | null;
  settingsRef: React.RefObject<Settings | null>;
  onLiveActiveChange?: (active: boolean) => void;
  enqueueSettingsSave: (update: (current: Settings) => Settings) => Promise<Settings>;
  reloadData: (resetFilters: boolean) => Promise<boolean>;
  modeChangeInProgress: React.RefObject<boolean>;
}

export function useLiveMode({ dataMode, liveActive, settings, settingsRef, onLiveActiveChange, enqueueSettingsSave, reloadData, modeChangeInProgress }: UseLiveModeOptions) {
  const { t } = useTranslation();
  const [live, setLive] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveSaving, setLiveSaving] = useState(false);
  const liveSaveInProgress = useRef(false);
  const mountedRef = useRef(false);
  const settingsInitializedRef = useRef(false);
  const reloadDataRef = useRef(reloadData);
  reloadDataRef.current = reloadData;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (settings && !settingsInitializedRef.current) {
      settingsInitializedRef.current = true;
      setLive(liveActive);
    }
  }, [settings, liveActive]);

  useEffect(() => {
    if (!live || dataMode !== "real") return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const listener = onDbChanged(() => {
      if (disposed || modeChangeInProgress.current) return;
      void reloadDataRef.current(false);
    });
    listener.then(un => {
      if (disposed) un();
      else unsubscribe = un;
    }).catch(error => {
      if (!disposed) setLiveError(translateApiError(error, key => t(key as never), t("app.databaseListenerError")));
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [dataMode, live, modeChangeInProgress]);

  const saveLiveSetting = async (next: boolean) => {
    if (!isLiveAvailable(dataMode) || liveSaveInProgress.current) return;
    const currentSettings = settingsRef.current;
    const previous = live;
    liveSaveInProgress.current = true;
    setLiveSaving(true);
    setLiveError(null);
    setLive(next);
    if (currentSettings) settingsRef.current = { ...currentSettings, live: next };
    try {
      const savedSettings = await enqueueSettingsSave(current => ({ ...current, live: next }));
      if (mountedRef.current) {
        setLive(savedSettings.live);
        onLiveActiveChange?.(savedSettings.live);
      }
    } catch (error) {
      if (mountedRef.current) {
        setLive(previous);
        setLiveError(translateApiError(error, key => t(key as never), t("app.liveSaveError")));
      }
      if (settingsRef.current?.live === next) {
        settingsRef.current = currentSettings ? { ...settingsRef.current, live: currentSettings.live } : settingsRef.current;
      }
    } finally {
      liveSaveInProgress.current = false;
      if (mountedRef.current) setLiveSaving(false);
    }
  };

  const toggleLive = () => saveLiveSetting(!live);
  const disableLive = () => saveLiveSetting(false);

  return { live, setLive, liveError, liveSaving, toggleLive, disableLive };
}
