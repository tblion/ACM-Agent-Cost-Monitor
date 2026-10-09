// Formats dates, numbers, and currency using the selected language.
import type { SupportedLanguage } from "./locale";
import { languageLocale } from "./locale";
import i18n from "./config";

export function formatNumber(value: number, language: SupportedLanguage, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(languageLocale(language), {
    maximumFractionDigits: 2,
    ...options,
  }).format(value);
}

export function formatCurrency(value: number, language: SupportedLanguage): string {
  return new Intl.NumberFormat(languageLocale(language), {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(timestamp: number, language: SupportedLanguage): string {
  return new Intl.DateTimeFormat(languageLocale(language)).format(new Date(timestamp));
}

export function formatDateTime(timestamp: number, language: SupportedLanguage): string {
  return new Intl.DateTimeFormat(languageLocale(language), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function formatCompactTokens(value: number, language: SupportedLanguage): string {
  const absoluteValue = Math.abs(value);
  const units = [
    { key: "none", divisor: 1 },
    { key: "thousand", divisor: 1_000 },
    { key: "million", divisor: 1_000_000 },
    { key: "billion", divisor: 1_000_000_000 },
  ] as const;
  let unitIndex = absoluteValue >= 1_000_000_000 ? 3 : absoluteValue >= 1_000_000 ? 2 : absoluteValue >= 1_000 ? 1 : 0;
  while (unitIndex < units.length - 1 && Math.round((absoluteValue / units[unitIndex].divisor) * 10) / 10 >= 1_000) unitIndex += 1;
  const { key: unitKey, divisor } = units[unitIndex];
  const unit = i18n.getFixedT(language)(`common.tokensUnit.${unitKey}`);
  const formattedValue = new Intl.NumberFormat(languageLocale(language), {
    maximumFractionDigits: 1,
  }).format(value / divisor);
  return unit ? `${formattedValue} ${unit}` : formattedValue;
}
