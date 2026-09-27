import { describe, expect, it } from "vitest";
import { serializeAuditReportCsv, serializeAuditReportJson } from "./audit-export";
import type { AuditReport } from "../types";

const report: AuditReport = {
  generatedAt: "2026-09-25T00:00:00Z",
  valid: true,
  provenance: {
    databasePath: "/fixture/audit.db",
    configPath: "/fixture/audit.jsonc",
    catalogPath: "embedded://pricing.json",
    catalogVersion: 1,
    catalogSourceVersion: "audit-fixture-1",
    catalogGeneratedAt: "2026-09-25T00:00:00Z",
    catalogRateCount: 2,
  },
  summary: {
    allSessions: 1,
    totalMessages: 1,
    sessionsWithAssistant: 1,
    assistantMessages: 1,
    ignoredMessages: 0,
    recalculableMessages: 1,
    customRateMessages: 1,
    catalogRateMessages: 0,
    storedFallbackMessages: 0,
    missingTokenMessages: 0,
    missingDateMessages: 0,
    missingRateMessages: 0,
    storedCostTotal: 17.25,
    calculatedCostTotal: 12.5,
    selectedCostTotal: 12.5,
    tokens: { input: 100, output: 200, cacheRead: 300, cacheWrite: 400, reasoning: 500 },
    anomalyCounts: { missingTokens: 0, missingDate: 0, missingRate: 0, invalidRate: 0, storedCostFallback: 0 },
  },
  messages: [{
    messageId: 'message,"quoted"\nline',
    sessionId: "session-1",
    project: "project,with,commas",
    provider: "provider",
    model: "model\nwith newline",
    messageDate: 1_758_758_400_000,
    tokens: { input: 100, output: 200, cacheRead: 300, cacheWrite: 400, reasoning: 500 },
    storedCost: 17.25,
    calculatedCost: 12.5,
    selectedCost: 12.5,
    costSource: "configured",
    rateSource: "configured",
    effectiveFrom: "2026-01-01T00:00:00Z",
    rate: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
    breakdown: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, reasoning: 2.5, total: 12.5 },
    anomalies: ["invalidRate", "storedCostFallback"],
  }],
  ignored: [],
  sessions: [{
    sessionId: "session-1",
    project: "project,with,commas",
    title: "Audit test",
    parentId: null,
    assistantMessages: 1,
    cost: 12.5,
    tokens: { input: 100, output: 200, cacheRead: 300, cacheWrite: 400, reasoning: 500 },
    messageIds: ['message,"quoted"\nline'],
  }],
  invariants: { valid: true, failed: [] },
};

describe("audit export", () => {
  it("preserves the complete report as deterministic readable JSON", () => {
    const serialized = serializeAuditReportJson(report);

    expect(serialized).toBe(`${JSON.stringify(report, null, 2)}\n`);
    expect(JSON.parse(serialized)).toEqual(report);
  });

  it("exports one deterministic escaped CSV row per message without recalculating costs", () => {
    const serialized = serializeAuditReportCsv(report);
    const [header, row] = serialized.split("\r\n");

    expect(header).toBe([
      "messageId", "sessionId", "project", "provider", "model", "messageDate",
      "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens",
      "storedCost", "calculatedCost", "selectedCost", "costSource", "rateSource", "effectiveFrom",
      "rateInput", "rateOutput", "rateCacheRead", "rateCacheWrite", "breakdownInput", "breakdownOutput",
      "breakdownCacheRead", "breakdownCacheWrite", "breakdownReasoning", "breakdownTotal", "anomalies",
    ].join(","));
    expect(serialized.endsWith("\r\n")).toBe(true);
    expect(row).toContain('"message,""quoted""\nline"');
    expect(row).toContain('"project,with,commas"');
    expect(row).toContain('"model\nwith newline"');
    expect(row).toContain(",17.25,12.5,12.5,configured,configured,2026-01-01T00:00:00Z,");
    expect(row).toContain(",invalidRate|storedCostFallback");
    expect(row).not.toContain(",12.5,12.5,12.5,13.5");
  });
});
