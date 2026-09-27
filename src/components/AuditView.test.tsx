// @vitest-environment happy-dom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n/config";
import { DEMO_AUDIT_REPORT } from "../demo/audit-fixture";
import { exportAudit } from "../api";
import type { AuditReport } from "../types";
import { AuditView } from "./AuditView";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../api", () => ({
  exportAudit: vi.fn(),
  translateApiError: (_error: unknown, _translate: (key: string) => string, fallback?: string) => fallback ?? "error",
}));

const mounted: Root[] = [];

async function renderView(options: {
  report?: AuditReport;
  getAuditReport?: () => Promise<AuditReport>;
  stale?: boolean;
} = {}): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(root);
  const getAuditReport = options.getAuditReport ?? vi.fn().mockResolvedValue(options.report ?? DEMO_AUDIT_REPORT);
  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n }, createElement(AuditView, {
      dataSource: { getAuditReport },
      onBack: vi.fn(),
      stale: options.stale ?? false,
      auditGeneration: 0,
    })));
  });
  return container;
}

async function refresh(container: HTMLElement): Promise<void> {
  const button = Array.from(container.querySelectorAll("button")).find(element => /actualiser|refresh/i.test(element.textContent ?? "")) as HTMLButtonElement;
  await act(async () => { button.click(); });
}

beforeEach(async () => {
  await i18n.changeLanguage("fr");
  vi.mocked(exportAudit).mockResolvedValue(null);
});

afterEach(async () => {
  await act(async () => { for (const root of mounted.splice(0)) root.unmount(); });
  document.body.replaceChildren();
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});

describe("AuditView", () => {
  it("explains the audit purpose and exposes accessible contextual help", async () => {
    const container = await renderView();
    await refresh(container);

    expect(container.querySelector("#audit-guide-title")?.textContent).toContain("À quoi sert cet audit ?");
    expect(container.textContent).toContain("Cet écran vérifie que les coûts affichés correspondent bien aux messages présents dans la base OpenCode.");

    const helpButton = container.querySelector('button[aria-label="À propos du coût retenu"]') as HTMLButtonElement;
    expect(helpButton).toBeTruthy();
    expect(helpButton.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="tooltip"]')).toBeNull();

    await act(async () => { helpButton.click(); });

    expect(helpButton.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[role="tooltip"]')?.textContent).toContain("Montant utilisé par l’application");
  });

  it("starts empty and only loads after the explicit refresh action", async () => {
    const getAuditReport = vi.fn().mockResolvedValue(DEMO_AUDIT_REPORT);
    const container = await renderView({ getAuditReport });

    expect(container.textContent).toContain("Aucun audit généré");
    expect(getAuditReport).not.toHaveBeenCalled();
    expect(container.querySelector('button[disabled]')?.textContent).toContain("JSON");

    await refresh(container);

    expect(getAuditReport).toHaveBeenCalledOnce();
  });

  it("shows counters, total costs and the last successful update date", async () => {
    const container = await renderView();

    await refresh(container);

    expect(container.textContent).toContain("Sessions dans la base");
    expect(container.textContent).toContain("Messages assistant");
    expect(container.textContent).toContain("Sessions avec assistant");
    expect(container.textContent).toContain("Tarifs configurés");
    expect(container.textContent).toContain("Tarifs du catalogue");
    expect(container.textContent).toContain("Fallbacks coût stocké");
    expect(container.textContent).toContain("Tarifs manquants");
    expect(container.textContent).toContain("Tokens manquants");
    expect(container.textContent).toContain("Dates manquantes");
    expect(container.textContent).toContain("Anomalies tokens manquants");
    expect(container.textContent).toContain("Anomalies dates manquantes");
    expect(container.textContent).toContain("Anomalies tarifs manquants");
    expect(container.textContent).toContain("Anomalies tarifs invalides");
    expect(container.textContent).toContain("Anomalies fallback coût stocké");
    expect(container.textContent).toContain("7");
    expect(container.textContent).toContain("10");
    expect(container.textContent).toContain("6");
    expect(container.textContent).toContain("9");
    expect(container.textContent).toContain("4");
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain("1");
    expect(container.textContent).toContain("3");
    expect(container.textContent).toContain("58,50");
    expect(container.textContent).toContain("25/09/2026");
    expect(container.textContent).toContain("513,50");
    expect(container.textContent).toContain("40,00");
    expect(container.textContent).toContain("Catalogue généré le");
    expect(container.textContent).toContain("Nombre de tarifs du catalogue");
  });

  it("announces a stale report without refreshing automatically", async () => {
    const getAuditReport = vi.fn().mockResolvedValue(DEMO_AUDIT_REPORT);
    const container = await renderView({ getAuditReport, stale: true });

    await refresh(container);

    expect(container.textContent).toContain("Audit obsolète");
    expect(getAuditReport).toHaveBeenCalledOnce();
  });

  it("ignores an audit response that resolves after the data generation changed", async () => {
    let resolveReport!: (report: AuditReport) => void;
    let changeGeneration!: () => void;
    const onSuccessfulReport = vi.fn();
    const getAuditReport = vi.fn(() => new Promise<AuditReport>(resolve => { resolveReport = resolve; }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push(root);

    function Harness() {
      const [generation, setGeneration] = useState(0);
      changeGeneration = () => setGeneration(current => current + 1);
      return createElement(I18nextProvider, { i18n }, createElement(AuditView, {
        dataSource: { getAuditReport },
        onBack: vi.fn(),
        stale: true,
        auditGeneration: generation,
        onSuccessfulReport,
      }));
    }

    await act(async () => { root.render(createElement(Harness)); });
    await refresh(container);
    await act(async () => { changeGeneration(); });
    await act(async () => { resolveReport(DEMO_AUDIT_REPORT); await Promise.resolve(); });

    expect(container.textContent).not.toContain("Sessions dans la base");
    expect(onSuccessfulReport).not.toHaveBeenCalled();
  });

  it("filters messages by anomaly", async () => {
    const container = await renderView();
    await refresh(container);

    const filter = container.querySelector('select[aria-label="Filtrer par anomalie"]') as HTMLSelectElement;
    await act(async () => {
      filter.value = "missingTokens";
      filter.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).toContain("m-no-tokens");
    expect(container.textContent).not.toContain("m-custom");
  });

  it("makes the message table scroll region keyboard-focusable and describes horizontal scrolling", async () => {
    const container = await renderView();
    await refresh(container);

    const scrollRegion = container.querySelector(".audit-table-scroll") as HTMLElement;
    const descriptionId = scrollRegion.getAttribute("aria-describedby");

    expect(scrollRegion.tabIndex).toBe(0);
    expect(scrollRegion.getAttribute("aria-label")).toBe("Table des messages, défilement horizontal");
    expect(descriptionId).toBeTruthy();
    expect(container.querySelector(`#${descriptionId}`)?.textContent).toContain("Faites défiler horizontalement");
    expect(scrollRegion.getAttribute("role")).toBeNull();
  });

  it("filters messages by session, provider, model, source and anomaly together", async () => {
    const container = await renderView();
    await refresh(container);

    const select = (label: string) => container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
    const setFilter = async (label: string, value: string) => {
      await act(async () => {
        const control = select(label);
        control.value = value;
        control.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };

    expect(Array.from(select("Filtrer par session").options).map(option => option.value)).toEqual(["all", "s-child", "s-custom", "s-fallback", "s-history", "s-invalid", "s-parent"]);
    expect(Array.from(select("Filtrer par provider").options).map(option => option.value)).toEqual(["all", "fixture-custom", "fixture-history", "fixture-unknown"]);
    expect(Array.from(select("Filtrer par modèle").options).map(option => option.value)).toEqual(["all", "fixture-model"]);
    expect(Array.from(select("Filtrer par source du coût").options).map(option => option.value)).toEqual(["all", "configured", "catalog", "stored"]);

    await setFilter("Filtrer par session", "s-invalid");
    await setFilter("Filtrer par provider", "fixture-custom");
    await setFilter("Filtrer par modèle", "fixture-model");
    await setFilter("Filtrer par source du coût", "stored");
    await setFilter("Filtrer par anomalie", "missingTokens");

    expect(container.textContent).toContain("m-no-tokens");
    expect(container.textContent).not.toContain("m-no-date");
    expect(container.textContent).not.toContain("m-custom");
  });

  it("expands a message and exposes its breakdown and rate provenance", async () => {
    const container = await renderView();
    await refresh(container);

    const row = Array.from(container.querySelectorAll("button")).find(element => element.textContent?.includes("m-custom")) as HTMLButtonElement;
    await act(async () => { row.click(); });

    expect(container.textContent).toContain("Décomposition du coût");
    expect(container.textContent).toContain("Input");
    expect(container.textContent).toContain("Tarif configuré");
    expect(container.textContent).toContain("2,00");
  });

  it("announces the invariant failure associated with an expanded message", async () => {
    const invalidReport: AuditReport = {
      ...DEMO_AUDIT_REPORT,
      valid: false,
      invariants: { valid: false, failed: ["breakdownCost:m-custom"] },
    };
    const container = await renderView({ report: invalidReport });
    await refresh(container);

    const row = Array.from(container.querySelectorAll("button")).find(element => element.textContent?.includes("m-custom")) as HTMLButtonElement;
    await act(async () => { row.click(); });

    const detail = container.querySelector(".audit-details-row") as HTMLElement;
    expect(detail.querySelector('[role="alert"]')?.textContent).toContain("Invariant(s) en échec pour ce message");
    expect(detail.textContent).toContain("breakdownCost:m-custom");
  });

  it("announces when an expanded message has no failed invariant", async () => {
    const container = await renderView();
    await refresh(container);

    const row = Array.from(container.querySelectorAll("button")).find(element => element.textContent?.includes("m-custom")) as HTMLButtonElement;
    await act(async () => { row.click(); });

    const detail = container.querySelector(".audit-details-row") as HTMLElement;
    expect(detail.querySelector('[role="status"]')?.textContent).toContain("Aucun invariant en échec pour ce message");
  });

  it("shows an invariant failure as an alert state", async () => {
    const invalidReport: AuditReport = {
      ...DEMO_AUDIT_REPORT,
      valid: false,
      invariants: { valid: false, failed: ["breakdownCost:m-custom"] },
    };
    const container = await renderView({ report: invalidReport });
    await refresh(container);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("invalide");
    expect(container.textContent).toContain("breakdownCost:m-custom");
    expect(Array.from(container.querySelectorAll("button")).find(element => element.textContent?.includes("JSON"))).toHaveProperty("disabled", true);
  });

  it("exports only the in-memory successful report and keeps it after a refresh error", async () => {
    const getAuditReport = vi.fn()
      .mockResolvedValueOnce(DEMO_AUDIT_REPORT)
      .mockRejectedValueOnce(new Error("refresh failed"));
    const container = await renderView({ getAuditReport });

    const jsonBefore = Array.from(container.querySelectorAll("button")).find(element => element.textContent?.includes("JSON")) as HTMLButtonElement;
    expect(jsonBefore.disabled).toBe(true);

    await refresh(container);

    const json = Array.from(container.querySelectorAll("button")).find(element => element.textContent?.includes("JSON")) as HTMLButtonElement;
    const csv = Array.from(container.querySelectorAll("button")).find(element => element.textContent?.includes("CSV")) as HTMLButtonElement;
    expect(json.disabled).toBe(false);
    expect(csv.disabled).toBe(false);

    await act(async () => { json.click(); });
    expect(exportAudit).toHaveBeenCalledOnce();
    expect(getAuditReport).toHaveBeenCalledOnce();

    await refresh(container);

    expect(container.textContent).toContain("m-custom");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Impossible");
    expect(getAuditReport).toHaveBeenCalledTimes(2);
  });
});
