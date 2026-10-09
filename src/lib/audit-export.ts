// Serializes audit reports as portable JSON or CSV exports.
import type { AuditMessage, AuditReport } from "../types";

const CSV_COLUMNS = [
  "messageId", "sessionId", "project", "provider", "model", "messageDate",
  "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens",
  "storedCost", "calculatedCost", "selectedCost", "costSource", "rateSource", "effectiveFrom",
  "rateInput", "rateOutput", "rateCacheRead", "rateCacheWrite", "breakdownInput", "breakdownOutput",
  "breakdownCacheRead", "breakdownCacheWrite", "breakdownReasoning", "breakdownTotal", "anomalies",
] as const;

function csvValue(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function messageRow(message: AuditMessage): Array<string | number | null> {
  return [
    message.messageId,
    message.sessionId,
    message.project,
    message.provider,
    message.model,
    message.messageDate,
    message.tokens?.input ?? null,
    message.tokens?.output ?? null,
    message.tokens?.cacheRead ?? null,
    message.tokens?.cacheWrite ?? null,
    message.tokens?.reasoning ?? null,
    message.storedCost,
    message.calculatedCost,
    message.selectedCost,
    message.costSource,
    message.rateSource,
    message.effectiveFrom,
    message.rate?.input ?? null,
    message.rate?.output ?? null,
    message.rate?.cacheRead ?? null,
    message.rate?.cacheWrite ?? null,
    message.breakdown?.input ?? null,
    message.breakdown?.output ?? null,
    message.breakdown?.cacheRead ?? null,
    message.breakdown?.cacheWrite ?? null,
    message.breakdown?.reasoning ?? null,
    message.breakdown?.total ?? null,
    message.anomalies.join("|"),
  ];
}

export function serializeAuditReportJson(report: AuditReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function serializeAuditReportCsv(report: AuditReport): string {
  const rows = [CSV_COLUMNS.join(","), ...report.messages.map(message => messageRow(message).map(csvValue).join(","))];
  return `${rows.join("\r\n")}\r\n`;
}
