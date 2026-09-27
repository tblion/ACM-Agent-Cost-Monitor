import { beforeEach, describe, expect, it } from "vitest";
import i18n, { i18nReady } from "./config";
import { resources } from "./resources";
import { detectSystemLanguage, normalizeLanguage, parseLanguage, resolveLanguage } from "./locale";
import { formatCompactTokens, formatCurrency, formatDate, formatDateTime, formatNumber } from "./format";

function leafEntries(value: unknown, prefix = ""): Array<[string, string]> {
  if (typeof value === "string") return [[prefix, value]];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => leafEntries(child, prefix ? `${prefix}.${key}` : key));
}

function interpolationVariables(value: string): string[] {
  return [...value.matchAll(/{{\s*([\w.-]+)\s*}}/g)].map(match => match[1]).sort();
}

describe("i18n foundation", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { language: "fr-FR" },
    });
  });

  it("normalizes standard French language tags and falls back to English", () => {
    expect(normalizeLanguage("fr-CA")).toBe("fr");
    expect(normalizeLanguage("fr-Latn-FR")).toBe("fr");
    expect(normalizeLanguage("FR_fr")).toBe("en");
    expect(normalizeLanguage("france")).toBe("en");
    expect(normalizeLanguage("fr-")).toBe("en");
    expect(normalizeLanguage("de-DE")).toBe("en");
    expect(normalizeLanguage(undefined)).toBe("en");
  });

  it("detects the normalized system language", () => {
    expect(detectSystemLanguage()).toBe("fr");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "ja-JP" } });
    expect(detectSystemLanguage()).toBe("en");
  });

  it("resolves a persisted language or detects the system language", () => {
    expect(resolveLanguage("fr")).toBe("fr");
    expect(resolveLanguage("en")).toBe("en");
    expect(resolveLanguage(null)).toBe("fr");
    expect(resolveLanguage("de")).toBe("fr");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "de-DE" } });
    expect(resolveLanguage("de")).toBe("en");
    expect(resolveLanguage(null)).toBe("en");
  });

  it("validates persisted and select language values", () => {
    expect(parseLanguage("fr")).toBe("fr");
    expect(parseLanguage("en")).toBe("en");
    expect(parseLanguage("system")).toBeNull();
    expect(parseLanguage("de")).toBeNull();
    expect(parseLanguage(null)).toBeNull();
  });

  it("formats values using the selected locale", async () => {
    await i18nReady;
    expect(formatNumber(1234.5, "fr")).toBe("1 234,5");
    expect(formatNumber(1234.5, "en")).toBe("1,234.5");
    expect(formatCurrency(12.5, "fr")).toContain("12,50");
    expect(formatCurrency(12.5, "en")).toContain("12.50");
    expect(formatDate(Date.UTC(2026, 0, 23, 12), "fr")).toBe("23/01/2026");
    expect(formatDate(Date.UTC(2026, 0, 23, 12), "en")).toBe("1/23/2026");
    const timestamp = Date.UTC(2026, 0, 23, 12, 34);
    expect(formatDateTime(timestamp, "fr")).toBe(new Intl.DateTimeFormat("fr-FR", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).format(new Date(timestamp)));
    expect(formatDateTime(timestamp, "en")).toBe(new Intl.DateTimeFormat("en-US", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).format(new Date(timestamp)));
    expect(formatCompactTokens(1_200_000, "fr")).toBe("1,2 M");
    expect(formatCompactTokens(1_200_000, "en")).toBe("1.2 M");
    expect(formatCompactTokens(999_999, "fr")).toBe("1 M");
    expect(formatCompactTokens(999_999, "en")).toBe("1 M");
    expect(formatCompactTokens(999_999_999, "fr")).toBe("1 Md");
    expect(formatCompactTokens(999_999_999, "en")).toBe("1 B");
  });

  it("keeps the same recursive translation keys in French and English", () => {
    const french = leafEntries(resources.fr.translation).sort(([left], [right]) => left.localeCompare(right));
    const english = leafEntries(resources.en.translation).sort(([left], [right]) => left.localeCompare(right));
    expect(english.map(([path]) => path)).toEqual(french.map(([path]) => path));
    for (const [path, frenchText] of french) {
      const englishText = english.find(([englishPath]) => englishPath === path)?.[1];
      expect(interpolationVariables(englishText ?? ""), path).toEqual(interpolationVariables(frenchText));
    }
    expect(resources.fr.translation.common.tokensUnit.million).toBe("M");
    expect(resources.en.translation.common.tokensUnit.million).toBe("M");
  });

  it("translates singular and plural count labels in both languages", async () => {
    await i18nReady;
    expect(i18n.getFixedT("fr")("kpi.subagents", { count: 1, formattedCount: "1" })).toBe("dont 1 sous-agent");
    expect(i18n.getFixedT("fr")("kpi.subagents", { count: 2, formattedCount: "2" })).toBe("dont 2 sous-agents");
    expect(i18n.getFixedT("en")("kpi.subagents", { count: 1, formattedCount: "1" })).toBe("including 1 subagent");
    expect(i18n.getFixedT("en")("kpi.subagents", { count: 2, formattedCount: "2" })).toBe("including 2 subagents");
    expect(i18n.getFixedT("fr")("kpi.subagents", { count: 1234, formattedCount: formatNumber(1234, "fr") })).toBe("dont 1 234 sous-agents");
    expect(i18n.getFixedT("en")("kpi.subagents", { count: 1234, formattedCount: formatNumber(1234, "en") })).toBe("including 1,234 subagents");
    expect(i18n.getFixedT("fr")("sessionTable.showSubsessions", { count: 1, formattedCount: "1" })).toBe("Afficher la sous-session (1)");
    expect(i18n.getFixedT("en")("sessionTable.showSubsessions", { count: 2, formattedCount: "2" })).toBe("Show subsessions (2)");
    expect(i18n.getFixedT("fr")("sessionTable.showSubsessions", { count: 1234, formattedCount: formatNumber(1234, "fr") })).toBe("Afficher les sous-sessions (1 234)");
    expect(i18n.getFixedT("en")("sessionTable.showSubsessions", { count: 1234, formattedCount: formatNumber(1234, "en") })).toBe("Show subsessions (1,234)");
  });

  it("provides translated brand and token series labels", () => {
    expect(resources.fr.translation.header.brand).toBe("Opencode Costs Viewer");
    expect(resources.en.translation.header.brand).toBe("Opencode Costs Viewer");
    expect(resources.fr.translation.charts.tokenValue).toBe("Tokens");
    expect(resources.en.translation.charts.tokenValue).toBe("Tokens");
  });

  it("keeps selected filter counts localized", async () => {
    await i18nReady;
    expect(i18n.getFixedT("fr")("filters.selectedCount", { selected: formatNumber(1234, "fr"), total: formatNumber(2000, "fr") })).toBe("1 234 / 2 000");
    expect(i18n.getFixedT("en")("filters.selectedCount", { selected: formatNumber(1234, "en"), total: formatNumber(2000, "en") })).toBe("1,234 / 2,000");
  });

  it("provides translated project group filter labels in both locales", async () => {
    await i18nReady;
    expect(resources.fr.translation.filters.projectGroups).toBe("Groupes");
    expect(resources.fr.translation.filters.projects).toBe("Projets");
    expect(resources.fr.translation.filters.groupAriaLabel).toBe("Groupe {{name}}");
    expect(resources.fr.translation.filters.groupMarker).toBe("◆");
    expect(resources.en.translation.filters.projectGroups).toBe("Groups");
    expect(resources.en.translation.filters.projects).toBe("Projects");
    expect(resources.en.translation.filters.groupAriaLabel).toBe("Group {{name}}");
    expect(resources.en.translation.filters.groupMarker).toBe("◆");
    expect(i18n.getFixedT("fr")("filters.groupAriaLabel", { name: "Clients" })).toBe("Groupe Clients");
    expect(i18n.getFixedT("en")("filters.groupAriaLabel", { name: "Clients" })).toBe("Group Clients");
  });

  it("translates recalculation safeguards in French and English", async () => {
    await i18nReady;
    expect(i18n.getFixedT("fr")("rates.confirmationDescription", { count: "3" })).toContain("opencode.db ne sera jamais modifiée");
    expect(i18n.getFixedT("en")("rates.confirmationDescription", { count: "3" })).toContain("opencode.db will never be modified");
    expect(i18n.getFixedT("fr")("rates.storedFallbacks")).toContain("fallbacks Stored");
    expect(i18n.getFixedT("en")("rates.storedFallbacks")).toContain("Stored fallbacks");
  });

  it("starts i18next with the translation namespace ready", async () => {
    await i18nReady;
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.t("header.settings")).toBe("⚙ Settings");
  });

});
