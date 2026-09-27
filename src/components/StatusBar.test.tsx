// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../i18n/config";
import type { RuntimeMetrics } from "../types";
import { StatusBar } from "./StatusBar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Root[] = [];

async function renderStatusBar(metrics: RuntimeMetrics | null, updatedAt: number | null): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(root);
  await act(async () => {
    root.render(
      createElement(I18nextProvider, { i18n }, createElement(StatusBar, { metrics, updatedAt })),
    );
  });
  return container.querySelector("footer") as HTMLElement;
}

beforeEach(async () => {
  await i18n.changeLanguage("fr");
});

afterEach(async () => {
  await act(async () => {
    for (const root of mounted.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  await i18n.changeLanguage("en");
});

describe("StatusBar", () => {
  it("formats database size, process memory and the data update time", async () => {
    const footer = await renderStatusBar(
      { databaseSizeBytes: 14_000_000_000, processMemoryBytes: 82_000_000, measuredAt: 0 },
      Date.UTC(2026, 8, 23, 14, 30),
    );

    expect(footer.tagName).toBe("FOOTER");
    expect(footer.getAttribute("aria-label")).toBe("Informations d'exécution");
    expect(footer.textContent).toContain("Taille de la base de données");
    expect(footer.textContent).toContain("13 GiB");
    expect(footer.textContent).toContain("Mémoire RSS du processus");
    expect(footer.textContent).toContain("78,2 MiB");
    expect(footer.textContent).toContain("23/09/2026");
    expect(footer.textContent).not.toContain("01/01/1970");
  });

  it("renders unavailable values without hiding available metrics", async () => {
    const footer = await renderStatusBar(
      { databaseSizeBytes: null, processMemoryBytes: 82_000_000, measuredAt: 0 },
      null,
    );

    expect(footer.textContent).toContain("Taille de la base de données : Valeur indisponible");
    expect(footer.textContent).toContain("Mémoire RSS du processus");
    expect(footer.textContent).toContain("78,2 MiB");
    expect(footer.textContent).toContain("Dernière mise à jour des données : Valeur indisponible");
  });
});
