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
  getResolvedPaths: vi.fn().mockResolvedValue({ db: "/db", config: "/config" }),
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
    })));
  });
  return container;
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
