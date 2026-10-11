// @vitest-environment happy-dom
// Tests preview-first recalculation interactions.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n/config";
import type { AppDataSource } from "../data-source";
import type { RecalculationResult, SessionRecord } from "../types";
import { RatesSection } from "./RatesSection";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Root[] = [];
const result: RecalculationResult = {
  sessions: [{ id: "session-1", cost: 4 } as SessionRecord],
  diagnostics: { catalogueValid: true, recalculableMessages: 3, missingDates: 1, missingTokens: 2, missingRates: 1 },
};

function createSource(overrides: Partial<AppDataSource> = {}): AppDataSource {
  return {
    getRates: vi.fn().mockResolvedValue([]),
    getCostSummary: vi.fn().mockResolvedValue([]),
    getCatalogStatus: vi.fn().mockResolvedValue({ valid: true, version: 1, generatedAt: "2026-01-01", sourceVersion: "test", rateCount: 1 }),
    getData: vi.fn().mockResolvedValue([]),
    recalculate: vi.fn().mockResolvedValue(result),
    previewRecalculation: vi.fn().mockResolvedValue(result),
    applyRecalculation: vi.fn().mockResolvedValue(undefined),
    getAuditReport: vi.fn(),
    ...overrides,
  };
}

async function renderSection(dataSource: AppDataSource, currentSessions: SessionRecord[] = [{ id: "session-1", cost: 2 } as SessionRecord], onDataRecalculated = vi.fn()): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(root);
  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n }, createElement(RatesSection, {
      dataSource,
      currentSessions,
      onRecalculationStart: vi.fn(),
      onDataRecalculated,
      onRecalculationError: vi.fn(),
    })));
  });
  await act(async () => { await Promise.resolve(); });
  return container;
}

beforeEach(async () => { await i18n.changeLanguage("fr"); });

afterEach(async () => {
  await act(async () => { for (const root of mounted.splice(0)) root.unmount(); });
  document.body.replaceChildren();
  await i18n.changeLanguage("en");
});

describe("RatesSection recalculation preview", () => {
  it("keeps rate details collapsed until the row is expanded", async () => {
    const source = createSource({ getRates: vi.fn().mockResolvedValue([{
      provider: "OpenAI",
      model: "gpt-6-luna",
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      cacheWrite: 0.13,
      source: "catalog",
      effectiveFrom: "2026-10-11",
    }]) });
    const container = await renderSection(source);

    const detailsButton = container.querySelector<HTMLButtonElement>('button[aria-label="Afficher les détails de gpt-6-luna"]');
    expect(detailsButton).not.toBeNull();
    expect(detailsButton?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Date d’effet");

    await act(async () => { detailsButton?.click(); });

    expect(detailsButton?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Date d’effet");
    expect(container.textContent).toContain("11/10/2026");
    expect(container.textContent).toContain("0,01");
    expect(container.textContent).toContain("0,13");
  });

  it("shows the impact without changing displayed data until the user confirms", async () => {
    const source = createSource();
    const onDataRecalculated = vi.fn();
    const container = await renderSection(source, undefined, onDataRecalculated);
    const previewButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Prévisualiser le recalcul") as HTMLButtonElement;

    await act(async () => { previewButton.click(); });

    expect(source.previewRecalculation).toHaveBeenCalledOnce();
    expect(source.applyRecalculation).not.toHaveBeenCalled();
    expect(onDataRecalculated).not.toHaveBeenCalled();
    expect(container.textContent).toContain("3 messages");
    expect(container.textContent).toContain("Coût affiché actuellement");
    expect(container.textContent).toContain("Coût estimé après recalcul");
    expect(container.textContent).toContain("Écart estimé");
    expect(container.textContent).toContain("Dates manquantes : 1");

    const cancel = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Annuler l’aperçu") as HTMLButtonElement;
    await act(async () => { cancel.click(); });
    expect(source.applyRecalculation).not.toHaveBeenCalled();
    expect(onDataRecalculated).not.toHaveBeenCalled();
  });

  it("applies the exact preview only after explicit confirmation", async () => {
    const source = createSource();
    const onDataRecalculated = vi.fn();
    const container = await renderSection(source, undefined, onDataRecalculated);
    const previewButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Prévisualiser le recalcul") as HTMLButtonElement;
    await act(async () => { previewButton.click(); });
    const confirm = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Confirmer le recalcul") as HTMLButtonElement;
    await act(async () => { confirm.click(); });

    expect(source.applyRecalculation).toHaveBeenCalledOnce();
    expect(source.recalculate).not.toHaveBeenCalled();
    expect(onDataRecalculated).toHaveBeenCalledWith(result.sessions);
    expect(container.textContent).toContain("Tokens manquants : 2");
    expect(container.textContent).toContain("Tarifs manquants : 1");
  });

  it("rejects an invalid catalog without requesting a preview", async () => {
    const source = createSource({ getCatalogStatus: vi.fn().mockResolvedValue({ valid: false, version: 1, generatedAt: "2026-01-01", sourceVersion: "test", rateCount: 0 }) });
    const container = await renderSection(source);
    const previewButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Prévisualiser le recalcul") as HTMLButtonElement;
    await act(async () => { previewButton.click(); });

    expect(source.previewRecalculation).not.toHaveBeenCalled();
    expect(container.textContent).toContain("catalogue de tarifs est invalide");
  });
});
