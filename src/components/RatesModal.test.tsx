// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n/config";
import type { AppDataSource } from "../data-source";
import type { RecalculationResult } from "../types";
import { RatesModal } from "./RatesModal";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Root[] = [];

function createSource(overrides: Partial<AppDataSource> = {}): AppDataSource {
  return {
    getRates: vi.fn().mockResolvedValue([]),
    getCostSummary: vi.fn().mockResolvedValue([{ provider: "p", model: "m", messages: 99, storedCost: 1, configured: true }]),
    getCatalogStatus: vi.fn().mockResolvedValue({ valid: true, version: 1, generatedAt: "2026-01-01", sourceVersion: "test", rateCount: 1 }),
    getData: vi.fn().mockResolvedValue([]),
    recalculate: vi.fn().mockResolvedValue({ sessions: [], diagnostics: { catalogueValid: true, recalculableMessages: 3, missingDates: 1, missingTokens: 2, missingRates: 1 } }),
    ...overrides,
    getAuditReport: overrides.getAuditReport ?? vi.fn(),
  };
}

async function renderModal(dataSource: AppDataSource, onDataRecalculated = vi.fn(), recalculableMessages = 3, onClose = vi.fn()): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(root);
  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n }, createElement(RatesModal, {
      dataSource,
      recalculableMessages,
      onClose,
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

describe("RatesModal recalculation", () => {
  it("moves focus to confirmation and restores it to the trigger on cancellation", async () => {
    const source = createSource();
    const container = await renderModal(source);
    const trigger = Array.from(container.querySelectorAll("button")).find(element => element.textContent === "Recalculer les coûts") as HTMLButtonElement;
    trigger.focus();

    await act(async () => { trigger.click(); });

    const confirm = Array.from(container.querySelectorAll("button")).find(element => element.textContent === "Confirmer le recalcul") as HTMLButtonElement;
    expect(document.activeElement).toBe(confirm);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Confirmer le recalcul");

    const cancel = Array.from(container.querySelectorAll("button")).find(element => element.textContent === "Annuler") as HTMLButtonElement;
    await act(async () => { cancel.click(); });

    const restoredTrigger = Array.from(container.querySelectorAll("button")).find(element => element.textContent === "Recalculer les coûts");
    expect(document.activeElement).toBe(restoredTrigger);
  });

  it("blocks Escape, backdrop and close while recalculation is pending, then restores focus on success", async () => {
    let resolve: ((result: RecalculationResult) => void) | undefined;
    const source = createSource({ recalculate: vi.fn().mockImplementation(() => new Promise<RecalculationResult>(r => { resolve = r; })) });
    const onClose = vi.fn();
    const container = await renderModal(source, vi.fn(), 3, onClose);
    const trigger = Array.from(container.querySelectorAll("button")).find(element => element.textContent === "Recalculer les coûts") as HTMLButtonElement;

    await act(async () => { trigger.click(); });
    const confirm = Array.from(container.querySelectorAll("button")).find(element => element.textContent === "Confirmer le recalcul") as HTMLButtonElement;
    await act(async () => { confirm.click(); });

    expect(confirm.disabled).toBe(true);
    expect(Array.from(container.querySelectorAll("button")).find(element => element.textContent === "Annuler")?.hasAttribute("disabled")).toBe(true);
    const close = container.querySelector('button[aria-label^="Fermer"]') as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    const bottomClose = Array.from(container.querySelectorAll("button")).find(element => element.textContent === "Fermer") as HTMLButtonElement;
    expect(bottomClose.disabled).toBe(true);
    await act(async () => { bottomClose.click(); });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await act(async () => { (container.firstElementChild as HTMLElement).click(); });
    expect(onClose).not.toHaveBeenCalled();
    expect(Array.from(container.querySelectorAll('[role="status"]')).some(element => element.textContent?.includes("Recalcul en cours"))).toBe(true);

    resolve?.({ sessions: [], diagnostics: { catalogueValid: true, recalculableMessages: 3, missingDates: 0, missingTokens: 0, missingRates: 0 } });
    await act(async () => { await Promise.resolve(); });

    expect(document.activeElement).toBe(Array.from(container.querySelectorAll("button")).find(element => element.textContent === "Recalculer les coûts"));
  });

  it("opens an inline descriptive confirmation before recalculating", async () => {
    const source = createSource();
    const container = await renderModal(source);
    const button = Array.from(container.querySelectorAll("button")).find(element => element.textContent?.includes("Recalculer")) as HTMLButtonElement;

    await act(async () => { button.click(); });

    expect(container.textContent).toContain("Les coûts historiques peuvent changer");
    expect(container.textContent).toContain("opencode.db ne sera jamais modifiée");
    expect(container.textContent).toContain("3 messages");
    expect(source.recalculate).not.toHaveBeenCalled();
  });

  it("cancels without calling the data source", async () => {
    const source = createSource();
    const container = await renderModal(source);
    const button = Array.from(container.querySelectorAll("button")).find(element => element.textContent?.includes("Recalculer")) as HTMLButtonElement;

    await act(async () => { button.click(); });
    const cancel = Array.from(container.querySelectorAll("button")).find(element => element.textContent === "Annuler") as HTMLButtonElement;
    await act(async () => { cancel.click(); });

    expect(source.recalculate).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Les coûts historiques peuvent changer");
  });

  it("rejects an invalid catalog without opening confirmation or recalculating", async () => {
    const source = createSource({ getCatalogStatus: vi.fn().mockResolvedValue({ valid: false, version: 1, generatedAt: "2026-01-01", sourceVersion: "test", rateCount: 0 }) });
    const container = await renderModal(source);
    const button = Array.from(container.querySelectorAll("button")).find(element => element.textContent?.includes("Recalculer")) as HTMLButtonElement;

    await act(async () => { button.click(); });

    expect(source.recalculate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("catalogue de tarifs est invalide");
    expect(container.textContent).not.toContain("Les coûts historiques peuvent changer");
  });

  it("calls recalculation once, disables the button and reports diagnostics", async () => {
    let resolve: ((result: RecalculationResult) => void) | undefined;
    const result: RecalculationResult = { sessions: [{ id: "new" } as never], diagnostics: { catalogueValid: true, recalculableMessages: 3, missingDates: 1, missingTokens: 2, missingRates: 4 } };
    const source = createSource({ recalculate: vi.fn().mockImplementation(() => new Promise<RecalculationResult>(r => { resolve = r; })) });
    const onDataRecalculated = vi.fn();
    const container = await renderModal(source, onDataRecalculated);
    const button = Array.from(container.querySelectorAll("button")).find(element => element.textContent?.includes("Recalculer")) as HTMLButtonElement;

    await act(async () => { button.click(); });
    const confirm = Array.from(container.querySelectorAll("button")).find(element => element.textContent?.includes("Confirmer")) as HTMLButtonElement;
    await act(async () => { confirm.click(); });

    expect(source.recalculate).toHaveBeenCalledOnce();
    expect(confirm.disabled).toBe(true);
    resolve?.(result);
    await act(async () => { await Promise.resolve(); });

    expect(onDataRecalculated).toHaveBeenCalledWith(result.sessions);
    expect(container.textContent).toContain("Dates manquantes : 1");
    expect(container.textContent).toContain("Tokens manquants : 2");
    expect(container.textContent).toContain("Tarifs manquants : 4");
    expect(container.textContent).toContain("fallbacks Stored");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Recalcul");
  });
});
