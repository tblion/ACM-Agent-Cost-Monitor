// Tests the browser mock implementation of the desktop API.
import { describe, expect, it } from "vitest";
import { invoke } from "./desktop-mock";
import { DEMO_AUDIT_REPORT } from "../demo/audit-fixture";
import type { AuditReport, RuntimeMetrics } from "../types";

describe("browser desktop mock", () => {
  it("returns a deterministic demo recalculation result", async () => {
    const result = await invoke<{
      sessions: Array<{ models: Array<{ source: string }> }>;
      diagnostics: { catalogueValid: boolean; recalculableMessages: number; missingRates: number };
    }>("recalculate_data");
    const models = result.sessions.flatMap(session => session.models);

    expect(result.sessions.length).toBeGreaterThan(0);
    expect(result.diagnostics.catalogueValid).toBe(true);
    expect(result.diagnostics.recalculableMessages).toBe(models.filter(model => model.source === "configured").length);
    expect(result.diagnostics.missingRates).toBe(models.filter(model => model.source === "stored").length);
  });

  it("returns deterministic runtime metrics for both database-size modes", async () => {
    const withDatabaseSize = await invoke<RuntimeMetrics>("get_runtime_metrics", { includeDatabaseSize: true });
    const withoutDatabaseSize = await invoke<RuntimeMetrics>("get_runtime_metrics", { includeDatabaseSize: false });

    expect(withDatabaseSize).toEqual({ databaseSizeBytes: 14_000_000_000, processMemoryBytes: 82_000_000, measuredAt: Date.UTC(2026, 8, 23, 14, 30) });
    expect(withoutDatabaseSize).toEqual({ databaseSizeBytes: null, processMemoryBytes: 82_000_000, measuredAt: Date.UTC(2026, 8, 23, 14, 30) });
  });

  it("returns the fixed audit report and export result", async () => {
    const report = await invoke<AuditReport>("get_audit_report");

    expect(report).toBe(DEMO_AUDIT_REPORT);
    expect(await invoke<string>("export_audit_report", { content: "fixed", suggestedName: "audit.json" })).toBe("synthetic://audit-export");
  });
});
