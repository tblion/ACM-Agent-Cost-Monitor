import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAuditReport, getCostSummary, getData, getRates, getCatalogStatus, recalculateData } from "./api";
import {
  DATA_MODE_STORAGE_KEY,
  createDataSource,
  isMockBuild,
  readDataMode,
  resolveDataMode,
  writeDataMode,
} from "./data-source";
import { DEMO_AUDIT_REPORT } from "./demo/audit-fixture";
import { generateDemoSnapshot } from "./demo/generator";
import { invoke as mockInvoke } from "./mock/desktop-mock";
import type { AuditReport } from "./types";

vi.mock("./api", () => ({
  getCostSummary: vi.fn(),
  getData: vi.fn(),
  getRates: vi.fn(),
  getCatalogStatus: vi.fn(),
  recalculateData: vi.fn(),
  getAuditReport: vi.fn(),
}));

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    get length() { return values.size; },
    removeItem: key => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function withThrowingLocalStorage(run: () => void): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => { throw new Error("storage getter failed"); },
  });
  try {
    run();
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }
}

describe("data source selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("defaults missing and invalid storage values to real mode", () => {
    const storage = createStorage();

    expect(readDataMode(storage)).toBe("real");
    storage.setItem(DATA_MODE_STORAGE_KEY, "invalid");
    expect(readDataMode(storage)).toBe("real");
  });

  it("returns real when injected storage getItem throws", () => {
    const storage = createStorage();
    storage.getItem = () => { throw new Error("getItem failed"); };

    expect(readDataMode(storage)).toBe("real");
  });

  it("returns real when the global storage getter throws", () => {
    withThrowingLocalStorage(() => {
      expect(readDataMode()).toBe("real");
    });
  });

  it("reads the global storage getter only once", () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    let accesses = 0;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        accesses += 1;
        return createStorage();
      },
    });
    try {
      expect(readDataMode()).toBe("real");
      expect(accesses).toBe(1);
    } finally {
      if (previous) Object.defineProperty(globalThis, "localStorage", previous);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });

  it("round trips the persisted data mode", () => {
    const storage = createStorage();

    writeDataMode("demo", storage);

    expect(storage.getItem(DATA_MODE_STORAGE_KEY)).toBe("demo");
    expect(readDataMode(storage)).toBe("demo");
  });

  it("ignores injected storage setItem errors", () => {
    const storage = createStorage();
    storage.setItem = () => { throw new Error("setItem failed"); };

    expect(() => writeDataMode("demo", storage)).not.toThrow();
  });

  it("ignores errors from the global storage getter", () => {
    withThrowingLocalStorage(() => {
      expect(() => writeDataMode("demo")).not.toThrow();
    });
  });

  it("forces demo mode for mock builds before reading persistence", () => {
    const storage = createStorage();
    writeDataMode("real", storage);
    vi.stubEnv("VITE_OPENCODE_MOCK", "true");

    expect(isMockBuild()).toBe(true);
    expect(resolveDataMode(storage)).toBe("demo");
  });

  it("delegates every real operation to the desktop API", async () => {
    const sessions = [{ id: "session" }];
    const rates = [{ provider: "provider" }];
    const summary = [{ model: "model" }];
    const audit = { valid: true };
    vi.mocked(getData).mockResolvedValue(sessions as never);
    vi.mocked(getRates).mockResolvedValue(rates as never);
    vi.mocked(getCostSummary).mockResolvedValue(summary as never);
    vi.mocked(getAuditReport).mockResolvedValue(audit as never);
    const source = createDataSource("real");

    await expect(source.getData()).resolves.toBe(sessions);
    await expect(source.getRates()).resolves.toBe(rates);
    await expect(source.getCostSummary()).resolves.toBe(summary);
    await expect(source.getAuditReport()).resolves.toBe(audit);
    expect(getData).toHaveBeenCalledOnce();
    expect(getRates).toHaveBeenCalledOnce();
    expect(getCostSummary).toHaveBeenCalledOnce();
    expect(getAuditReport).toHaveBeenCalledOnce();
  });

  it("delegates recalculation and catalog status to the desktop API", async () => {
    const result = { sessions: [], diagnostics: { catalogueValid: true, recalculableMessages: 1, missingDates: 0, missingTokens: 0, missingRates: 0 } };
    const status = { valid: true, version: 1, generatedAt: "2026-01-01T00:00:00Z", sourceVersion: "test", rateCount: 1 };
    vi.mocked(recalculateData).mockResolvedValue(result);
    vi.mocked(getCatalogStatus).mockResolvedValue(status);
    const source = createDataSource("real");

    await expect(source.getCatalogStatus()).resolves.toBe(status);
    await expect(source.recalculate()).resolves.toBe(result);
    expect(getCatalogStatus).toHaveBeenCalledOnce();
    expect(recalculateData).toHaveBeenCalledOnce();
  });

  it("serves an injected deterministic demo snapshot without calling the API", async () => {
    const referenceDate = Date.UTC(2026, 8, 22, 23, 30);
    const source = createDataSource("demo", referenceDate);
    const sessions = await source.getData();
    const rates = await source.getRates();
    const summary = await source.getCostSummary();
    const secondSource = createDataSource("demo", referenceDate);

    expect(sessions).toEqual(await secondSource.getData());
    expect(sessions.length).toBeGreaterThan(100);
    expect(rates.length).toBeGreaterThan(0);
    expect(summary.length).toBeGreaterThan(0);
    expect(getData).not.toHaveBeenCalled();
    expect(getRates).not.toHaveBeenCalled();
    expect(getCostSummary).not.toHaveBeenCalled();
    const firstResult = await secondSource.recalculate();
    const secondResult = await createDataSource("demo", referenceDate).recalculate();
    expect(firstResult).toEqual(secondResult);
    expect(firstResult.diagnostics.catalogueValid).toBe(true);
    const configuredModels = sessions.flatMap(session => session.models).filter(model => model.source === "configured").length;
    const storedModels = sessions.flatMap(session => session.models).filter(model => model.source === "stored").length;
    expect(firstResult.sessions).toEqual(sessions);
    expect(firstResult.diagnostics.recalculableMessages).toBe(configuredModels);
    expect(firstResult.diagnostics.missingRates).toBe(storedModels);
    expect(firstResult.diagnostics.recalculableMessages).toBeLessThan(sessions.flatMap(session => session.models).length);
    expect(firstResult.diagnostics.missingDates).toBe(0);
    expect(firstResult.diagnostics.missingTokens).toBe(0);
    expect(recalculateData).not.toHaveBeenCalled();
  });

  it("keeps demo recalculation diagnostics stable for the same reference date", async () => {
    const referenceDate = Date.UTC(2026, 8, 22, 23, 30);
    const expected = generateDemoSnapshot(referenceDate);
    const result = await createDataSource("demo", referenceDate).recalculate();

    expect(result.sessions).toEqual(expected.sessions);
    expect(result.diagnostics).toEqual({
      catalogueValid: true,
      recalculableMessages: expected.sessions.flatMap(session => session.models).filter(model => model.source === "configured").length,
      missingDates: 0,
      missingTokens: 0,
      missingRates: expected.sessions.flatMap(session => session.models).filter(model => model.source === "stored").length,
    });
  });

  it("returns the fixed audit report through the common demo and browser mock paths", async () => {
    const demoReport = await createDataSource("demo").getAuditReport();
    const mockReport = await mockInvoke<AuditReport>("get_audit_report");

    expect(demoReport).toBe(DEMO_AUDIT_REPORT);
    expect(mockReport).toBe(DEMO_AUDIT_REPORT);
    expect(recalculateData).not.toHaveBeenCalled();
  });

  it("propagates a catalog error from the real source", async () => {
    vi.mocked(recalculateData).mockRejectedValue(new Error("invalid pricing catalog"));

    await expect(createDataSource("real").recalculate()).rejects.toThrow("invalid pricing catalog");
  });
});
