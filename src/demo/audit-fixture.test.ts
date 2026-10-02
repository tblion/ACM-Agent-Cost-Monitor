// @ts-expect-error type error without @types/node package
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_AUDIT_REPORT } from "./audit-fixture";
import type { AuditReport } from "../types";

const referenceExpectedUrl = new URL("../fixtures/audit/reference-expected.json", import.meta.url);

function stableProjection(report: AuditReport) {
  // Paths and generation timestamp are execution-specific metadata.
  return {
    valid: report.valid,
    provenance: {
      catalogVersion: report.provenance.catalogVersion,
      catalogSourceVersion: report.provenance.catalogSourceVersion,
      catalogGeneratedAt: report.provenance.catalogGeneratedAt,
      catalogRateCount: report.provenance.catalogRateCount,
    },
    summary: report.summary,
    messages: report.messages.map(message => ({
      messageId: message.messageId,
      sessionId: message.sessionId,
      project: message.project,
      provider: message.provider,
      model: message.model,
      messageDate: message.messageDate,
      tokens: message.tokens,
      storedCost: message.storedCost,
      calculatedCost: message.calculatedCost,
      selectedCost: message.selectedCost,
      costSource: message.costSource,
      rateSource: message.rateSource,
      effectiveFrom: message.effectiveFrom,
      rate: message.rate,
      breakdown: message.breakdown,
      anomalies: message.anomalies,
    })),
    ignored: report.ignored,
    sessions: report.sessions,
    invariants: report.invariants,
  };
}

describe("demo audit fixture", () => {
  it("stays in parity with the checked-in reference oracle for stable fields", () => {
    const expected = JSON.parse(readFileSync(referenceExpectedUrl, "utf8")) as AuditReport;

    expect(stableProjection(DEMO_AUDIT_REPORT)).toEqual(stableProjection(expected));
  });

  it("reflects every detailed invalidRate anomaly in the summary count", () => {
    const detailedInvalidRates = DEMO_AUDIT_REPORT.messages.filter(message => message.anomalies.includes("invalidRate"));

    expect(DEMO_AUDIT_REPORT.summary.anomalyCounts.invalidRate).toBe(detailedInvalidRates.length);
  });
});
