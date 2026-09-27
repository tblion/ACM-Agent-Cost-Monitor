// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

describe("i18n initialization", () => {
  async function loadConfiguredI18n(language?: string) {
    vi.resetModules();
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: language === undefined ? {} : { language },
    });

    return (await import("./config")).default;
  }

  it.each([
    ["a missing browser language", undefined, "en"],
    ["a malformed browser language", "not-a-language", "en"],
    ["an unsupported browser language", "de-DE", "en"],
    ["a French browser language", "fr-FR", "fr"],
  ])("uses %s before settings are loaded", async (_description, browserLanguage, expectedLanguage) => {
    const initializedI18n = await loadConfiguredI18n(browserLanguage);
    expect(initializedI18n.t("header.settings")).toBe(expectedLanguage === "fr" ? "⚙ Réglages" : "⚙ Settings");
  });

  it("falls back to the English translation for an unsupported requested language", async () => {
    const initializedI18n = await loadConfiguredI18n("fr-FR");

    expect(initializedI18n.t("header.settings", { lng: "de-DE" })).toBe("⚙ Settings");
  });
});
