import { useTranslation } from "react-i18next";
import { formatDateTime } from "../i18n/format";
import { languageLocale, resolveLanguage } from "../i18n/locale";
import type { RuntimeMetrics } from "../types";

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

export function StatusBar({ metrics, updatedAt }: { metrics: RuntimeMetrics | null; updatedAt: number | null }) {
  const { t, i18n } = useTranslation();
  const language = resolveLanguage(i18n.language);
  const unavailable = t("status.unavailable");
  const databaseSize = metrics?.databaseSizeBytes == null ? unavailable : formatBytes(metrics.databaseSizeBytes, language);
  const memory = metrics?.processMemoryBytes == null ? unavailable : formatBytes(metrics.processMemoryBytes, language);
  const lastUpdated = updatedAt == null ? unavailable : formatDateTime(updatedAt, language);

  return (
    <footer className="status-bar" aria-label={t("status.label")}>
      <p>{t("status.databaseSize", { value: databaseSize })}</p>
      <p>{t("status.memory", { value: memory })}</p>
      <p>{t("status.lastUpdated", { value: lastUpdated })}</p>
    </footer>
  );
}
