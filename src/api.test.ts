import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { exportAudit, getAuditReport, isApiError, saveSettings, translateApiError } from "./api";
import type { Settings } from "./types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

describe("audit API commands", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("calls the exact Tauri command for an audit report", async () => {
    const report = { valid: true };
    mockedInvoke.mockResolvedValue(report as never);

    await expect(getAuditReport()).resolves.toBe(report);

    expect(mockedInvoke.mock.calls).toEqual([["get_audit_report"]]);
  });

  it("calls the exact Tauri export command with content and suggested name", async () => {
    const content = '{"valid":true}\n';
    const suggestedName = "audit-report.json";
    mockedInvoke.mockResolvedValue("/tmp/audit-report.json" as never);

    await expect(exportAudit(content, suggestedName)).resolves.toBe("/tmp/audit-report.json");

    expect(mockedInvoke.mock.calls).toEqual([[
      "export_audit_report",
      { content, suggestedName },
    ]]);
  });
});

describe("settings API commands", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("preserves the documented save_settings argument mapping", async () => {
    const settings: Settings = {
      dbPath: null,
      configPath: null,
      live: false,
      theme: "system",
      language: "fr",
      defaultPeriodDays: 30,
      customGroups: [],
    };
    mockedInvoke.mockResolvedValue(undefined as never);

    await saveSettings(settings);

    expect(mockedInvoke.mock.calls).toEqual([["save_settings", { s: settings }]]);
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
