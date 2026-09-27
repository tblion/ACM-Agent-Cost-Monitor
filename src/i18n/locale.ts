export const supportedLanguages = ["fr", "en"] as const;
export type SupportedLanguage = typeof supportedLanguages[number];

export function parseLanguage(value: unknown): SupportedLanguage | null {
  return value === "fr" || value === "en" ? value : null;
}

export function normalizeLanguage(value: string | null | undefined): SupportedLanguage {
  if (!value) return "en";
  try {
    const [canonical] = Intl.getCanonicalLocales(value);
    return canonical.toLowerCase() === "fr" || canonical.toLowerCase().startsWith("fr-") ? "fr" : "en";
  } catch {
    return "en";
  }
}

export function detectSystemLanguage(): SupportedLanguage {
  return normalizeLanguage(typeof navigator === "undefined" ? undefined : navigator.language);
}

export function resolveLanguage(value: unknown): SupportedLanguage {
  return parseLanguage(value) ?? detectSystemLanguage();
}

export function languageLocale(language: SupportedLanguage): string {
  return language === "fr" ? "fr-FR" : "en-US";
}
