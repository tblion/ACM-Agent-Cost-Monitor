// src/components/Header.tsx
import { useTranslation } from "react-i18next";
import type { RefObject } from "react";
import { formatDateTime } from "../i18n/format";
import { languageLocale, resolveLanguage } from "../i18n/locale";
import type { RuntimeMetrics } from "../types";
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
  auditButtonRef: RefObject<HTMLButtonElement | null>;
  showAudit: boolean;
}

export function Header({ live, liveConfigured, liveActive, liveAvailable, liveSaving, metrics, updatedAt, onToggleLive, onDisableLive, onOpenSettings, onOpenRates, onOpenAbout, onOpenAudit, auditButtonRef, showAudit }: Props) {
  const { t, i18n } = useTranslation();
  const language = resolveLanguage(i18n.language);
  const unavailable = t("status.unavailable");
  const databaseSize = metrics?.databaseSizeBytes == null ? unavailable : formatBytes(metrics.databaseSizeBytes, language);
  const memory = metrics?.processMemoryBytes == null ? unavailable : formatBytes(metrics.processMemoryBytes, language);
  const lastUpdated = updatedAt == null ? unavailable : formatDateTime(updatedAt, language);
  const needsReactivation = liveAvailable && liveConfigured && !liveActive;
  const liveLabel = needsReactivation ? t("header.liveReactivate") : t("header.live");

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
