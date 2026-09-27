// src/components/charts/CostByModel.tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { byModel } from "../../lib/aggregate";
import type { SessionRecord } from "../../types";
import { InfoTooltip } from "../InfoTooltip";
import { tooltipStyle, tooltipCursor } from "./chartTheme";
import { useTranslation } from "react-i18next";
import { formatCurrency, formatNumber } from "../../i18n/format";
import { resolveLanguage } from "../../i18n/locale";

export function CostByModel({ data }: { data: SessionRecord[] }) {
  const { t, i18n } = useTranslation();
  const language = resolveLanguage(i18n.language);
  const rows = byModel(data).slice(0, 8).map(r => ({ name: r.key.split("/").pop() ?? r.key, cost: r.value }));
  return (
    <div className="panel">
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, display: "flex", alignItems: "center" }}>
        {t("charts.costByModel")}
        <InfoTooltip text={t("charts.costByModelTooltip")} />
      </div>
      <ResponsiveContainer width="100%" height={180}>
        {rows.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 12, textAlign: "center", paddingTop: 70 }}>{t("common.noData")}</div> : <BarChart data={rows}>
          <XAxis dataKey="name" tick={{ fontSize: 9, fill: "var(--muted)" }} interval={0} angle={-20} textAnchor="end" height={50} />
           <YAxis tickFormatter={value => formatNumber(Number(value), language)} tick={{ fontSize: 10, fill: "var(--muted)" }} />
           <Tooltip formatter={value => [typeof value === "number" ? formatCurrency(value, language) : value, t("charts.cost")]} contentStyle={tooltipStyle} cursor={tooltipCursor} />
          <Bar dataKey="cost" fill="#22d3ee" radius={[4, 4, 0, 0]} />
        </BarChart>}
      </ResponsiveContainer>
    </div>
  );
}
