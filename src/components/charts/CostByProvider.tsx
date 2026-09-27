// src/components/charts/CostByProvider.tsx
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { byProvider } from "../../lib/aggregate";
import type { SessionRecord } from "../../types";
import { InfoTooltip } from "../InfoTooltip";
import { tooltipStyle } from "./chartTheme";
import { useTranslation } from "react-i18next";
import { formatCurrency } from "../../i18n/format";
import { resolveLanguage } from "../../i18n/locale";

const COLORS = ["#6366f1", "#22d3ee", "#f472b6", "#fbbf24", "#a78bfa", "#6b7280"];

export function CostByProvider({ data }: { data: SessionRecord[] }) {
  const { t, i18n } = useTranslation();
  const language = resolveLanguage(i18n.language);
  const rows = byProvider(data).map(r => ({ name: r.key, value: r.value }));
  return (
    <div className="panel">
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, display: "flex", alignItems: "center" }}>
        {t("charts.costByProvider")}
        <InfoTooltip text={t("charts.costByProviderTooltip")} />
      </div>
      <ResponsiveContainer width="100%" height={180}>
        {rows.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 12, textAlign: "center", paddingTop: 70 }}>{t("common.noData")}</div> : <PieChart>
          <Pie data={rows} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
            {rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
           <Tooltip formatter={value => [typeof value === "number" ? formatCurrency(value, language) : value, t("charts.cost")]} contentStyle={tooltipStyle} />
        </PieChart>}
      </ResponsiveContainer>
      {rows.length > 0 && <ul className="chart-legend" aria-label={t("charts.providerLegend")}>
        {rows.map((row, i) => <li key={row.name}>
          <span className="chart-legend-label">
            <span className="chart-legend-swatch" style={{ background: COLORS[i % COLORS.length] }} aria-hidden="true" />
            {row.name}
          </span>
          <span>{formatCurrency(row.value, language)}</span>
        </li>)}
      </ul>}
    </div>
  );
}
