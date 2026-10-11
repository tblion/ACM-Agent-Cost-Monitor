// @vitest-environment happy-dom
// Tests settings editing, validation, and save behavior.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n/config";
import type { Settings } from "../types";
import { SettingsModal } from "./SettingsModal";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../api", () => ({
  getCatalogRates: vi.fn().mockResolvedValue([{
    provider: "OpenAI",
    model: "gpt-6-luna",
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.13,
    effectiveFrom: "2026-10-11",
    source: "catalog",
  }]),
  getResolvedPaths: vi.fn().mockResolvedValue({ db: "/db", config: "/config" }),
  getInternalStoreStatus: vi.fn().mockResolvedValue({ databasePath: "/store.sqlite", projects: 1, sessions: 2, messages: 3, sources: 1, lastImportedAt: null }),
  getInternalStoreSources: vi.fn().mockResolvedValue([]),
  refreshInternalStoreSource: vi.fn().mockResolvedValue(undefined),
  refreshOpenCodeApi: vi.fn().mockResolvedValue(undefined),
  getBackendLogs: vi.fn().mockResolvedValue([]),
  onBackendLog: vi.fn(() => vi.fn()),
  exportInternalStore: vi.fn().mockResolvedValue(null),
  mergeInternalStore: vi.fn().mockResolvedValue(null),
  pickPath: vi.fn(),
  translateApiError: (_error: unknown, _translate: (key: string) => string, fallback?: string) => fallback ?? "error",
}));

const mounted: Root[] = [];
const baseSettings: Settings = {
  dbPath: null,
  configPath: null,
  live: false,
  theme: "light",
  language: "fr",
  defaultPeriodDays: 30,
  customGroups: [],
  customRates: [],
  fixedSubscriptions: [],
};

async function renderModal(customGroups: Settings["customGroups"], onSave = vi.fn()): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(root);
  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n }, createElement(SettingsModal, {
      settings: { ...baseSettings, customGroups },
      projects: ["/workspace/active"],
      dataMode: "real",
      onDataModeChange: vi.fn(),
      onClose: vi.fn(),
      onSave,
      onStoreChanged: vi.fn(),
      onOpenAudit: vi.fn(),
      dataSource: { getRates: vi.fn().mockResolvedValue([]), getCostSummary: vi.fn().mockResolvedValue([]), getCatalogStatus: vi.fn().mockResolvedValue({ valid: true, version: 1, generatedAt: "", sourceVersion: "", rateCount: 0 }), getData: vi.fn().mockResolvedValue([]), recalculate: vi.fn(), getAuditReport: vi.fn() },
      currentSessions: [],
      onRecalculationStart: vi.fn(),
      onDataRecalculated: vi.fn(),
      onRecalculationError: vi.fn(),
      auditButtonRef: { current: null },
    })));
  });
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-section="projects"]')?.click();
  });
  return container;
}

async function openRates(container: HTMLElement): Promise<void> {
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-section="rates"]')?.click();
    await Promise.resolve();
  });
}

async function save(container: HTMLElement): Promise<void> {
  const button = Array.from(container.querySelectorAll("button")).find(element => element.textContent === "Enregistrer") as HTMLButtonElement;
  await act(async () => { button.click(); });
}

beforeEach(async () => { await i18n.changeLanguage("fr"); });

afterEach(async () => {
  await act(async () => { for (const root of mounted.splice(0)) root.unmount(); });
  document.body.replaceChildren();
  await i18n.changeLanguage("en");
});

describe("SettingsModal project groups", () => {
  it("keeps a project absent from current data visible and selected", async () => {
    const container = await renderModal([{ name: "Custom", projects: ["/workspace/missing"] }]);

    const missing = container.querySelector<HTMLInputElement>('input[value="/workspace/missing"]');
    expect(missing?.checked).toBe(true);
    expect(container.textContent).toContain("Projet manquant");
  });

  it("removes a missing project from the saved payload after confirmation", async () => {
    const onSave = vi.fn();
    const container = await renderModal([{ name: "Custom", projects: ["/workspace/missing"] }], onSave);
    const missing = container.querySelector<HTMLInputElement>('input[value="/workspace/missing"]') as HTMLInputElement;

    await act(async () => { missing.click(); });
    const confirmation = container.querySelector('[role="dialog"] div[role="dialog"]')?.parentElement ?? container;
    const confirm = Array.from(confirmation.querySelectorAll("button")).find(element => element.textContent === "Supprimer") as HTMLButtonElement;
    await act(async () => { confirm.click(); });
    await save(container);

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ customGroups: [{ name: "Custom", projects: [] }] }));
  });

  it("keeps a missing project when removal is cancelled", async () => {
    const onSave = vi.fn();
    const container = await renderModal([{ name: "Custom", projects: ["/workspace/missing"] }], onSave);
    const missing = container.querySelector<HTMLInputElement>('input[value="/workspace/missing"]') as HTMLInputElement;

    await act(async () => { missing.click(); });
    const dialogs = container.querySelectorAll('[role="dialog"]');
    const cancel = Array.from(dialogs[dialogs.length - 1].querySelectorAll("button")).find(element => element.textContent === "Annuler") as HTMLButtonElement;
    await act(async () => { cancel.click(); });
    await save(container);

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ customGroups: [{ name: "Custom", projects: ["/workspace/missing"] }] }));
  });

  it("preserves the same project in both groups", async () => {
    const onSave = vi.fn();
    const container = await renderModal([
      { name: "First", projects: ["/workspace/missing"] },
      { name: "Second", projects: ["/workspace/missing"] },
    ], onSave);

    await save(container);

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      customGroups: [
        { name: "First", projects: ["/workspace/missing"] },
        { name: "Second", projects: ["/workspace/missing"] },
      ],
    }));
  });

  it("keeps the following group name and selection after deleting the first group", async () => {
    const onSave = vi.fn();
    const container = await renderModal([
      { name: "First", projects: [] },
      { name: "Second", projects: ["/workspace/active"] },
    ], onSave);

    const deleteFirst = container.querySelector<HTMLButtonElement>('button[aria-label="Supprimer groupe 1"]') as HTMLButtonElement;
    await act(async () => { deleteFirst.click(); });
    await save(container);

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      customGroups: [{ name: "Second", projects: ["/workspace/active"] }],
    }));
  });
});

describe("SettingsModal catalog rates", () => {
  it("shows compact catalog rows and expands rate provenance on demand", async () => {
    const container = await renderModal([]);
    await openRates(container);

    expect(container.querySelector(".catalog-rates-table")).not.toBeNull();
    expect(container.textContent).toContain("gpt-6-luna");
    expect(container.textContent).not.toContain("Date d’effet : 11/10/2026");

    const details = container.querySelector<HTMLButtonElement>('button[aria-label="Afficher les détails de OpenAI/gpt-6-luna"]');
    expect(details?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => { details?.click(); });

    expect(details?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Date d’effet: 11/10/2026");
    const customize = container.querySelector<HTMLButtonElement>('button[aria-label="Personnaliser le tarif catalogue de OpenAI/gpt-6-luna"]');
    expect(customize).not.toBeNull();
    await act(async () => { customize?.click(); });
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Identifiant exact du modèle"]')?.value).toBe("gpt-6-luna");
  });
});
