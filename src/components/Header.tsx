// Renders the application header and its primary actions and status indicators.
import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../i18n/format";
import { languageLocale, resolveLanguage } from "../i18n/locale";
import { getInternalStoreSources, refreshInternalStoreSource, refreshOpenCodeApi, translateApiError } from "../api";
import type { InternalStoreSource, RuntimeMetrics } from "../types";
import appLogoUrl from "../../assets/icons/icon.png";

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

function formatBytes(value: number, language: "fr" | "en"): string {
  let unitIndex = 0;
  let scaledValue = value;

  while (scaledValue >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    scaledValue /= 1024;
    unitIndex += 1;
  }

  return `${new Intl.NumberFormat(languageLocale(language), {
    maximumFractionDigits: unitIndex === 0 ? 0 : 1,
  }).format(scaledValue)} ${BYTE_UNITS[unitIndex]}`;
}

function refreshId(source: InternalStoreSource): string {
  return `${source.sourceId}:${source.channelKey}`;
}

interface Props {
  live: boolean;
  liveConfigured: boolean;
  liveActive: boolean;
  liveAvailable: boolean;
  liveSaving: boolean;
  metrics: RuntimeMetrics | null;
  updatedAt: number | null;
  onToggleLive: () => void;
  onDisableLive: () => void;
  onOpenSettings: () => void;
  onOpenRates: () => void;
  onOpenAbout: () => void;
  onOpenAudit: () => void;
  onSourceRefreshed: () => Promise<void>;
  auditButtonRef: RefObject<HTMLButtonElement | null>;
  showAudit: boolean;
}

export function Header({ live, liveConfigured, liveActive, liveAvailable, liveSaving, metrics, updatedAt, onToggleLive, onDisableLive, onOpenSettings, onOpenRates, onOpenAbout, onOpenAudit, onSourceRefreshed, auditButtonRef, showAudit }: Props) {
  const { t, i18n } = useTranslation();
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [sources, setSources] = useState<InternalStoreSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [refreshingSourceId, setRefreshingSourceId] = useState<string | null>(null);
  const sourcesControlRef = useRef<HTMLDivElement>(null);
  const sourceButtonRef = useRef<HTMLButtonElement>(null);
  const language = resolveLanguage(i18n.language);
  const unavailable = t("status.unavailable");
  const databaseSize = metrics?.databaseSizeBytes == null ? unavailable : formatBytes(metrics.databaseSizeBytes, language);
  const memory = metrics?.processMemoryBytes == null ? unavailable : formatBytes(metrics.processMemoryBytes, language);
  const lastUpdated = updatedAt == null ? unavailable : formatDateTime(updatedAt, language);
  const needsReactivation = liveAvailable && liveConfigured && !liveActive;
  const liveLabel = needsReactivation ? t("header.liveReactivate") : t("header.live");

  const loadSources = async () => {
    setSourcesLoading(true);
    setSourcesError(null);
    try {
      setSources(await getInternalStoreSources());
    } catch (error) {
      setSourcesError(translateApiError(error, key => t(key as never), t("header.sourceLoadError")));
    } finally {
      setSourcesLoading(false);
    }
  };

  useEffect(() => {
    if (!sourcesOpen) return;
    void loadSources();
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !sourcesControlRef.current?.contains(event.target)) setSourcesOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSourcesOpen(false);
        sourceButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [sourcesOpen]);

  const refreshSource = async (source: InternalStoreSource) => {
    const refreshId = `${source.sourceId}:${source.channelKey}`;
    setRefreshingSourceId(refreshId);
    setSourcesError(null);
    try {
      if (source.channelKey === "api") await refreshOpenCodeApi();
      else await refreshInternalStoreSource(source.sourceId);
      await onSourceRefreshed();
    } catch (error) {
      setSourcesError(translateApiError(error, key => t(key as never), t("header.sourceRefreshFailed", { source: source.channelKey === "api" ? t("header.opencodeApi") : t("header.databaseChannel") })));
    } finally {
      await loadSources();
      setRefreshingSourceId(null);
    }
  };

  const formatSourceTimestamp = (value: string | null) => {
    if (!value) return t("header.sourceNeverUpdated");
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? formatDateTime(timestamp, language) : value;
  };

  return (
    <header className="app-header">
      <div className="header-identity">
        <img className="header-logo" src={appLogoUrl} alt="" width={32} height={32} />
        <span style={{ fontWeight: 600, fontSize: 15 }}>{t("header.brand")}</span>
      </div>
      <div className="header-runtime" aria-label={t("status.label")}>
        <span className="header-runtime-item"><span>{t("status.databaseSizeLabel")}</span><strong>{databaseSize}</strong></span>
        <span className="header-runtime-item"><span>{t("status.memoryLabel")}</span><strong>{memory}</strong></span>
      </div>
      <div className="header-actions">
        <button
          className={`live-btn${live ? " on" : ""}`}
          onClick={onToggleLive}
          disabled={!liveAvailable || liveSaving}
          aria-pressed={live}
          aria-busy={liveSaving}
          aria-label={!liveAvailable ? t("header.liveUnavailable") : needsReactivation ? t("header.liveReactivate") : t("header.liveMode")}
          style={{ color: !liveAvailable || liveSaving ? "var(--disabled-text)" : live ? "var(--live)" : "var(--text)" }}
        >
          <span className="dot" aria-hidden /> {liveLabel}
        </button>
        <div className="header-source-control" ref={sourcesControlRef}>
          <button
            ref={sourceButtonRef}
            type="button"
            className="header-source-button"
            aria-label={t("header.sourceRefreshMenu")}
            aria-expanded={sourcesOpen}
            aria-controls="header-source-popover"
            title={t("header.sourceRefreshMenu")}
            onClick={() => setSourcesOpen(open => !open)}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 7v5h-5M4 17v-5h5" />
              <path d="M5.6 9A7 7 0 0 1 18.5 7L20 12M4 12l1.5 5A7 7 0 0 0 18.4 15" />
            </svg>
          </button>
          {sourcesOpen && <div id="header-source-popover" className="header-source-popover" role="region" aria-label={t("header.sourceMenuTitle")}>
            <h2>{t("header.sourceMenuTitle")}</h2>
            {sourcesLoading && <p role="status">{t("header.sourceLoading")}</p>}
            {sourcesError && <p role="alert">{sourcesError}</p>}
            {!sourcesLoading && sources.length === 0 && !sourcesError && <p>{t("header.sourceEmpty")}</p>}
            {sources.map(source => <div className="header-source-row" key={refreshId(source)}>
              <div className="header-source-details">
                <strong>{source.agentName} — {source.channelKey === "api" ? t("header.opencodeApi") : t("header.databaseChannel")}</strong>
                <span className="header-source-path" title={source.sourcePath}>{source.sourcePath}</span>
                <span>{t("header.sourceLastUpdated", { value: formatSourceTimestamp(source.lastImportedAt) })}</span>
              </div>
              {source.lastSyncError && <span
                className="header-source-error"
                role="img"
                aria-label={t("header.sourceSyncError", { details: source.lastSyncError })}
                title={t("header.sourceSyncError", { details: source.lastSyncError })}
                tabIndex={0}
              >▲</span>}
              <button
                type="button"
                className="header-source-refresh"
                aria-label={t("header.sourceRefreshLabel", { source: source.channelKey === "api" ? t("header.opencodeApi") : t("header.databaseChannel") })}
                disabled={refreshingSourceId !== null}
                aria-busy={refreshingSourceId === refreshId(source)}
                onClick={() => void refreshSource(source)}
              >
                {refreshingSourceId === refreshId(source) ? t("header.sourceRefreshing") : t("header.sourceRefresh")}
              </button>
            </div>)}
          </div>}
        </div>
        {liveAvailable && liveConfigured && !liveActive && (
          <button
            className="live-disable"
            onClick={onDisableLive}
            disabled={liveSaving}
            aria-busy={liveSaving}
            aria-label={t("header.liveDisable")}
          >
            {t("header.liveDisable")}
          </button>
        )}
        <span className="header-updated" title={t("status.lastUpdated", { value: lastUpdated })}>
          {t("status.lastUpdated", { value: lastUpdated })}
        </span>
        <button onClick={onOpenRates} style={{ background: "none", border: "none", color: "var(--text)", cursor: "pointer", fontSize: 12 }} aria-label={t("header.ratesLabel")}>
          {t("header.rates")}
        </button>
        <button onClick={onOpenAbout} style={{ background: "none", border: "none", color: "var(--text)", cursor: "pointer", fontSize: 12 }} aria-label={t("header.aboutLabel")}>
          {t("header.about")}
        </button>
        <button ref={auditButtonRef} className="header-audit" onClick={onOpenAudit} style={{ background: "none", border: "none", color: "var(--text)", cursor: "pointer", fontSize: 12 }} aria-label={t(showAudit ? "header.dashboardLabel" : "header.auditLabel")}>
          {t(showAudit ? "header.dashboard" : "header.audit")}
        </button>
        <button onClick={onOpenSettings} style={{ background: "none", border: "none", color: "var(--text)", cursor: "pointer", fontSize: 12 }} aria-label={t("header.settingsLabel")}>
          {t("header.settings")}
        </button>
      </div>
    </header>
  );
}
