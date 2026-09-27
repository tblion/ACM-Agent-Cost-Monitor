// src/components/KpiCards.tsx
import type { SessionRecord } from "../types";
import { sumCost, costBySource, tokenTotals } from "../lib/aggregate";
import { InfoTooltip } from "./InfoTooltip";
import { useTranslation } from "react-i18next";
import { formatCompactTokens, formatCurrency, formatNumber } from "../i18n/format";
import { resolveLanguage } from "../i18n/locale";

export function KpiCards({ data }: { data: SessionRecord[] }) {
  const { t, i18n } = useTranslation();
  const language = resolveLanguage(i18n.language);
  const cost = sumCost(data);
  const sources = costBySource(data);
  const totals = tokenTotals(data);
  const tokens = totals.input + totals.output + totals.cacheRead + totals.cacheWrite + totals.reasoning;
  const sub = data.filter(s => s.isSubagent).length;
  const projects = new Set(data.map(s => s.project)).size;

  const cards = [
    {
       label: t("kpi.totalCost"), value: formatCurrency(cost, language), color: "#22d3ee",
       sub: `${t("kpi.configured", { value: formatCurrency(sources.configured, language) })} · ${t("kpi.historical", { value: formatCurrency(sources.stored, language) })}`,
       tooltip: t("kpi.totalCostTooltip"),
    },
    {
       label: t("kpi.tokens"), value: formatCompactTokens(tokens, language), color: "#a78bfa",
       sub: t("kpi.tokenBreakdown", { input: formatCompactTokens(totals.input, language), output: formatCompactTokens(totals.output, language), cache: formatCompactTokens(totals.cacheRead + totals.cacheWrite, language) }),
       tooltip: t("kpi.tokensTooltip"),
    },
    {
       label: t("kpi.sessions"), value: formatNumber(data.length, language), color: "#f472b6",
       sub: t("kpi.subagents", { count: sub, formattedCount: formatNumber(sub, language) }),
       tooltip: t("kpi.sessionsTooltip"),
    },
    {
       label: t("kpi.projects"), value: formatNumber(projects, language), color: "#fbbf24",
       sub: t("kpi.distinct"),
       tooltip: t("kpi.projectsTooltip"),
    },
  ];

  return (
    <div className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, padding: "16px 20px" }}>
      {cards.map(c => (
        <div key={c.label} className="panel">
          <div style={{ fontSize: 11, color: "var(--text)", textTransform: "uppercase", letterSpacing: ".04em", display: "flex", alignItems: "center" }}>
            {c.label}
            <InfoTooltip text={c.tooltip} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color: c.color }}>{c.value}</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
