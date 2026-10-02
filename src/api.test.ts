import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportAudit, getAuditReport, isApiError, saveSettings, translateApiError } from "./api";
import type { DesktopApi } from "../electron/renderer-api";
import type { Settings } from "./types";

const desktopApi = {
  getAuditReport: vi.fn(),
  exportAuditReport: vi.fn(),
  saveSettings: vi.fn(),
} as unknown as DesktopApi;

describe("audit API commands", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(window, "desktopApi", { configurable: true, value: desktopApi });
  });

  it("calls the desktop bridge for an audit report", async () => {
    const report = { valid: true };
    vi.mocked(desktopApi.getAuditReport).mockResolvedValue(report as never);

    await expect(getAuditReport()).resolves.toBe(report);

    expect(desktopApi.getAuditReport).toHaveBeenCalledOnce();
  });

  it("calls the desktop bridge export with content and suggested name", async () => {
    const content = '{"valid":true}\n';
    const suggestedName = "audit-report.json";
    vi.mocked(desktopApi.exportAuditReport).mockResolvedValue("/tmp/audit-report.json" as never);

    await expect(exportAudit(content, suggestedName)).resolves.toBe("/tmp/audit-report.json");

    expect(desktopApi.exportAuditReport).toHaveBeenCalledWith(content, suggestedName);
  });
});

describe("settings API commands", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(window, "desktopApi", { configurable: true, value: desktopApi });
  });

  it("preserves the settings payload through the desktop bridge", async () => {
    const settings: Settings = {
      dbPath: null,
      configPath: null,
      live: false,
      theme: "system",
      language: "fr",
      defaultPeriodDays: 30,
      customGroups: [],
    };
    vi.mocked(desktopApi.saveSettings).mockResolvedValue(undefined as never);

    await saveSettings(settings);

    expect(desktopApi.saveSettings).toHaveBeenCalledWith(settings);
  });
});

describe("structured API errors", () => {
  it("guards and translates a known structured error", () => {
    const error = { code: "database", message: "query failed" };

    expect(isApiError(error)).toBe(true);
    expect(translateApiError(error, (key: string) => `translated:${key}`))
      .toBe("translated:errors.database: query failed");
  });

  it("uses a readable fallback for an unknown rejection shape", () => {
    expect(isApiError({ code: "unknown" })).toBe(false);
    expect(translateApiError({ code: "new_code", message: "technical detail" }, (key: string) => key))
      .toBe("technical detail");
    expect(translateApiError("plain failure", (key: string) => key)).toBe("plain failure");
  });
});
