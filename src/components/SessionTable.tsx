// Displays sessions and their model usage in hierarchical table order.
import { useState, useMemo } from "react";
import type { SessionRecord } from "../types";
import { InfoTooltip } from "./InfoTooltip";
import { useTranslation } from "react-i18next";
import { formatCurrency, formatDate, formatNumber } from "../i18n/format";
import { resolveLanguage } from "../i18n/locale";
const visuallyHidden = { position: "absolute" as const, width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap" as const, border: 0 };

function sourceBadge(session: SessionRecord, configuredLabel: string, historicalLabel: string, mixedLabel: string, noValue: string, language: ReturnType<typeof resolveLanguage>): { label: string; detail: string; configured: boolean } {
  const sources = new Set(session.models.map(model => model.source));
  if (sources.size === 0) sources.add(session.source);
  const configured = sources.has("configured");
  const stored = sources.has("stored");
  const label = configured && stored ? mixedLabel : configured ? configuredLabel : historicalLabel;
  const detail = session.models.length > 0
    ? session.models.map(model => `${model.model} : ${formatCurrency(model.cost, language)} (${model.source === "configured" ? configuredLabel : historicalLabel})`).join(" ; ")
    : `${label} : ${session.cost === 0 ? noValue : formatCurrency(session.cost, language)}`;
  return { label, detail: `${label}. ${detail}`, configured };
}

// Build the hierarchical display order: parent followed by its sorted direct children.
function buildRows(
  data: SessionRecord[],
  sortKey: "date" | "cost",
  sortDir: 1 | -1,
  showSub: boolean,
): SessionRecord[] {
  const parents = data.filter(s => !s.isSubagent).sort((a, b) => (a[sortKey] - b[sortKey]) * sortDir);
  if (!showSub) return parents;

  const childrenOf = new Map<string, SessionRecord[]>();
  for (const s of data) {
    if (s.isSubagent && s.parentId) {
      const arr = childrenOf.get(s.parentId) ?? [];
      arr.push(s);
      childrenOf.set(s.parentId, arr);
    }
  }

  const result: SessionRecord[] = [];
  for (const parent of parents) {
    result.push(parent);
    const children = childrenOf.get(parent.id) ?? [];
    // Sort children by ascending date.
    children.sort((a, b) => a.date - b.date);
    result.push(...children);
  }
  // Append orphaned subsessions (parent absent from filtered data) at the end.
  const parentIds = new Set(parents.map(s => s.id));
  for (const s of data) {
    if (s.isSubagent && s.parentId && !parentIds.has(s.parentId)) result.push(s);
  }
  return result;
}

export function SessionTable({ data }: { data: SessionRecord[] }) {
  const { t, i18n } = useTranslation();
  const language = resolveLanguage(i18n.language);
  const [sort, setSort] = useState<{ k: "date" | "cost"; d: 1 | -1 }>({ k: "date", d: -1 });
  const [showSub, setShowSub] = useState(true);

  // Cumulative child cost by parentId.
  const childrenCost = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of data) {
      if (s.isSubagent && s.parentId) map.set(s.parentId, (map.get(s.parentId) ?? 0) + s.cost);
    }
    return map;
  }, [data]);

  const rows = useMemo(() => buildRows(data, sort.k, sort.d, showSub), [data, sort, showSub]);

  const th = (k: "date" | "cost", label: string) => (
    <th aria-sort={sort.k === k ? (sort.d === -1 ? "descending" : "ascending") : "none"} style={{ textAlign: "left" }}>
      <button type="button" onClick={() => setSort(s => ({ k, d: s.k === k ? (s.d === 1 ? -1 : 1) : -1 }))}
        style={{ cursor: "pointer", background: "none", border: "none", padding: "8px 10px", fontSize: 11, color: "var(--text)", textTransform: "uppercase", font: "inherit" }}>
        {label}{sort.k === k ? (sort.d === -1 ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  const subCount = data.filter(s => s.isSubagent).length;

  return (
    <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center" }}>
          {t("sessionTable.title")}
          <InfoTooltip text={t("sessionTable.tooltip")} />
        </span>
        {subCount > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text)", cursor: "pointer", userSelect: "none" }}>
            <input type="checkbox" checked={showSub} onChange={e => setShowSub(e.target.checked)}
              style={{ accentColor: "var(--accent)", width: 14, height: 14 }}
               aria-label={t("sessionTable.showSubsessions", { count: subCount, formattedCount: formatNumber(subCount, language) })} />
             {t("sessionTable.showSubsessions", { count: subCount, formattedCount: formatNumber(subCount, language) })}
          </label>
        )}
      </div>

      <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto", contain: "layout" }}>
        <table className="session-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead style={{ position: "sticky", top: 0, background: "var(--panel)", zIndex: 1 }}>
            <tr>
              <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>{t("sessionTable.session")}</th>
              <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>{t("sessionTable.project")}</th>
              {th("date", t("sessionTable.date"))}
              {th("cost", t("sessionTable.cost"))}
              <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>{t("sessionTable.tokens")}</th>
              <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>{t("sessionTable.rate")}</th>
            </tr>
          </thead>
           <tbody>
             {rows.length === 0 && <tr><td colSpan={6} style={{ padding: "20px 10px", color: "var(--muted)", textAlign: "center" }}>{t("common.noData")}</td></tr>}
             {rows.map(s => {
              const tok = s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.cacheWrite + s.tokens.reasoning;
               const badge = sourceBadge(s, t("sessionTable.configured"), t("sessionTable.historical"), t("sessionTable.mixed"), t("common.noValue"), language);
              return (
                <tr key={s.id} style={{ borderTop: "1px solid var(--border)", opacity: s.isSubagent ? 0.75 : 1 }}>
                  <td style={{ padding: "7px 10px", paddingLeft: s.isSubagent ? 28 : 10 }}>
                    {s.isSubagent && <span aria-hidden style={{ color: "var(--muted)", marginRight: 4 }}>↳</span>}
                    {s.title}
                  </td>
                  <td style={{ padding: "7px 10px", color: "var(--muted)" }}>{s.project.split(/[\\/]/).pop()}</td>
                  <td style={{ padding: "7px 10px", color: "var(--muted)" }}>{formatDate(s.date, language)}</td>
                  <td style={{ padding: "7px 10px" }}>
                    {s.isSubagent ? (
                      <span style={{ fontWeight: 400 }}>
                        {s.cost > 0 ? formatCurrency(s.cost, language) : <span style={{ color: "var(--muted)" }}>{t("common.noValue")}</span>}
                      </span>
                    ) : (() => {
                      const sub = childrenCost.get(s.id) ?? 0;
                      const total = s.cost + sub;
                      return (
                        <div>
                          <span style={{ fontWeight: 600 }}>{total > 0 ? formatCurrency(total, language) : <span style={{ color: "var(--muted)" }}>{t("common.noValue")}</span>}</span>
                          {sub > 0 && (
                            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>
                               {t("sessionTable.subsessionCost", { value: formatCurrency(sub, language) })}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td style={{ padding: "7px 10px", color: "var(--muted)" }}>{formatNumber(tok / 1000, language, { maximumFractionDigits: 1 })} {t("common.tokensUnit.thousand")}</td>
                  <td style={{ padding: "7px 10px" }}>
                    <span
                      title={badge.detail}
                      style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: badge.configured ? "rgba(34,211,238,.15)" : "rgba(107,114,128,.15)", color: badge.configured ? "#22d3ee" : "var(--muted)" }}
                    >
                      {badge.label}
                    </span>
                    <span style={visuallyHidden}>{badge.detail}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
