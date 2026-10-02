import * as api from "./api";
import { createDemoAuditReport, createDemoRecalculationResult, generateDemoSnapshot } from "./demo/generator";
import { getE2eDemoSnapshot } from "./mock/desktop-mock";
import type { AuditReport, CatalogStatus, CostSummary, RateEntry, RecalculationResult, SessionRecord } from "./types";

export type DataMode = "real" | "demo";

export interface AppDataSource {
  getData(): Promise<SessionRecord[]>;
  getRates(): Promise<RateEntry[]>;
  getCostSummary(): Promise<CostSummary[]>;
  getCatalogStatus(): Promise<CatalogStatus>;
  recalculate(): Promise<RecalculationResult>;
  getAuditReport(): Promise<AuditReport>;
}

export const DATA_MODE_STORAGE_KEY = "opencode-costs-viewer:data-mode";

function getDefaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function isDataMode(value: string | null | undefined): value is DataMode {
  return value === "real" || value === "demo";
}

export function readDataMode(storage?: Storage): DataMode {
  try {
    const value = (storage ?? getDefaultStorage())?.getItem(DATA_MODE_STORAGE_KEY);
    return isDataMode(value) ? value : "real";
  } catch {
    return "real";
  }
}

export function writeDataMode(mode: DataMode, storage?: Storage): void {
  try {
    (storage ?? getDefaultStorage())?.setItem(DATA_MODE_STORAGE_KEY, mode);
  } catch {
    // Storage is optional and must not block the application.
  }
}

export function isMockBuild(): boolean {
  return import.meta.env.VITE_OPENCODE_MOCK === "true";
}

export function resolveDataMode(storage?: Storage): DataMode {
  if (import.meta.env.VITE_E2E === "true" && ["live", "live-save-error", "db-path"].includes(new URLSearchParams(globalThis.location?.search).get("e2e") ?? "")) return "real";
  return isMockBuild() ? "demo" : readDataMode(storage);
}

export function createDataSource(mode: DataMode, referenceDate?: number): AppDataSource {
  if (mode === "demo") {
    const snapshot = generateDemoSnapshot(referenceDate);
    return {
      getData: async () => (import.meta.env.VITE_E2E === "true" ? getE2eDemoSnapshot().sessions : snapshot.sessions),
      getRates: async () => (import.meta.env.VITE_E2E === "true" ? getE2eDemoSnapshot().rates : snapshot.rates),
      getCostSummary: async () => (import.meta.env.VITE_E2E === "true" ? getE2eDemoSnapshot().costSummary : snapshot.costSummary),
      getCatalogStatus: async () => {
        const current = import.meta.env.VITE_E2E === "true" ? getE2eDemoSnapshot() : snapshot;
        return { valid: true, version: 1, generatedAt: "2026-01-01T00:00:00Z", sourceVersion: "demo", rateCount: current.rates.length };
      },
      recalculate: async () => {
        if (import.meta.env.VITE_E2E === "true") window.__E2E__.markRecalculated();
        return createDemoRecalculationResult(import.meta.env.VITE_E2E === "true" ? getE2eDemoSnapshot() : snapshot);
      },
      getAuditReport: async () => createDemoAuditReport(),
    };
  }

  return {
    getData: api.getData,
    getRates: api.getRates,
    getCostSummary: api.getCostSummary,
    getCatalogStatus: api.getCatalogStatus,
    recalculate: api.recalculateData,
    getAuditReport: api.getAuditReport,
  };
}
