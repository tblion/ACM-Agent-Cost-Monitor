// Configures i18next with the application's supported translations.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { detectSystemLanguage, supportedLanguages } from "./locale";
import { resources } from "./resources";

export const i18nReady = i18n.use(initReactI18next).init({
  resources,
  lng: detectSystemLanguage(),
  fallbackLng: "en",
  supportedLngs: supportedLanguages,
  defaultNS: "translation",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
