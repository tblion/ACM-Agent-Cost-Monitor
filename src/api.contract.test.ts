import { beforeEach, describe, expect, it, vi } from "vitest";
import contractFixture from "./fixtures/api-contract.json";
import { decodeApiPayload, getLegacySettings, getSettings, getSettingsStatus, invokeCommand } from "./api";
import type { ApiCommandMap } from "./api";
import type { DesktopApi } from "../electron/renderer-api";
import type { ApiError, Settings, SettingsResponse } from "./types";

const desktopApi = {
  getData: vi.fn(),
  getSettings: vi.fn(),
  getSettingsStatus: vi.fn(),
  getRuntimeMetrics: vi.fn(),
  saveSettings: vi.fn(),
  exportAuditReport: vi.fn(),
} as unknown as DesktopApi;

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(window, "desktopApi", { configurable: true, value: desktopApi });
});

const settings: Settings = {
  dbPath: null,
  configPath: null,
  live: false,
  theme: "system",
  language: "fr",
  defaultPeriodDays: 30,
  customGroups: [],
};

describe("SettingsResponse contract", () => {
  it("accepts the complete response shape with no diagnostic", () => {
    const response: SettingsResponse = { settings, diagnostic: null, liveActive: false };

    expect(response).toEqual({ settings, diagnostic: null, liveActive: false });
  });

  it("accepts every structured diagnostic without changing the response shape", () => {
    const diagnostic: ApiError = {
      code: "configuration",
      message: "JSON invalide dans settings.json: unexpected token",
    };
    const response: SettingsResponse = { settings, diagnostic, liveActive: true };

    expect(Object.keys(response).sort()).toEqual(["diagnostic", "liveActive", "settings"]);
    expect(response.diagnostic).toEqual(diagnostic);
  });

  it("uses the status command for the frontend while preserving the legacy command", async () => {
    vi.mocked(desktopApi.getSettingsStatus).mockResolvedValueOnce({ settings, diagnostic: null, liveActive: false } as never);
    vi.mocked(desktopApi.getSettings).mockResolvedValueOnce(settings as never);

    await getSettingsStatus();
    await getLegacySettings();

    expect(desktopApi.getSettingsStatus).toHaveBeenCalledOnce();
    expect(desktopApi.getSettings).toHaveBeenCalledOnce();
  });

  it("keeps getSettings as the legacy Settings-only wrapper", async () => {
    vi.mocked(desktopApi.getSettings).mockResolvedValueOnce(settings as never);

    await expect(getSettings()).resolves.toEqual(settings);
    expect(desktopApi.getSettings).toHaveBeenCalledOnce();
  });
});

describe("public API payload contract", () => {
  it("types command arguments exactly while keeping no-payload commands argument-free", () => {
    const metrics = invokeCommand("get_runtime_metrics", { includeDatabaseSize: true });
    const settingsResult = invokeCommand("save_settings", { s: settings });
    const exported = invokeCommand("export_audit_report", {
      content: "{}",
      suggestedName: "audit.json",
    });
    const data = invokeCommand("get_data");

    void metrics;
    void settingsResult;
    void exported;
    void data;

    if (false) {
      // @ts-expect-error no-payload commands reject an argument object
      invokeCommand("get_data", {});
      // @ts-expect-error required runtime argument cannot be omitted
      invokeCommand("get_runtime_metrics");
      // @ts-expect-error unknown runtime argument fields are rejected
      invokeCommand("get_runtime_metrics", { includeDatabaseSize: true, extra: false });
      // @ts-expect-error save_settings uses the exact {s} payload
      invokeCommand("save_settings", settings);
      // @ts-expect-error export payload requires both exact fields
      invokeCommand("export_audit_report", { content: "{}" });
    }
  });

  it("decodes representative nullable and enum values without changing their shape", () => {
    const session = decodeApiPayload<ApiCommandMap["get_data"]>(JSON.stringify(contractFixture.sessionRecord));
    const report = decodeApiPayload<ApiCommandMap["get_audit_report"]>(JSON.stringify(contractFixture.auditReport));

    expect(session[0]).toMatchObject({
      parentId: null,
      source: "configured",
      models: [{ source: "stored" }],
    });
    expect(report.messages[0]).toMatchObject({
      messageDate: null,
      tokens: null,
      calculatedCost: null,
      rateSource: "catalog",
      effectiveFrom: null,
      rate: null,
      breakdown: null,
      costSource: "stored",
      anomalies: ["missingDate", "storedCostFallback"],
    });
    expect(contractFixture.rateEntry.source).toBe("catalog");
    expect(contractFixture.rateEntry.effectiveFrom).toBeNull();
  });

  it("exposes every nullable command result in the command map", () => {
    const nullableResults: Array<ApiCommandMap[keyof ApiCommandMap]> = [
      null as ApiCommandMap["pick_path"],
      null as ApiCommandMap["export_audit_report"],
    ];

    expect(nullableResults).toEqual([null, null]);
  });
});
