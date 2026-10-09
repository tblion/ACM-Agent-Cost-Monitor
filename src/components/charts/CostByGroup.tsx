// Compares usage cost across project groups.
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { byGroup } from "../../lib/aggregate";
import type { SessionRecord, CustomGroup } from "../../types";
import { InfoTooltip } from "../InfoTooltip";
import { tooltipStyle, tooltipCursor } from "./chartTheme";
import { useTranslation } from "react-i18next";
import { formatCurrency, formatNumber } from "../../i18n/format";
import { resolveLanguage } from "../../i18n/locale";

export function CostByGroup({ data, groups }: { data: SessionRecord[]; groups: CustomGroup[] }) {
  const { t, i18n } = useTranslation();
  const language = resolveLanguage(i18n.language);
  const rows = byGroup(data, groups).slice(0, 8).map(r => ({ name: r.key.split(/[\\/]/).pop() ?? r.key, cost: r.value }));
  return (
    <div className="panel">
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, display: "flex", alignItems: "center" }}>
        {t("charts.costByGroup")}
        <InfoTooltip text={t("charts.costByGroupTooltip")} />
      </div>
      <ResponsiveContainer width="100%" height={180}>
        {rows.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 12, textAlign: "center", paddingTop: 70 }}>{t("common.noData")}</div> : <BarChart data={rows} layout="vertical">
           <XAxis type="number" tickFormatter={value => formatNumber(Number(value), language)} tick={{ fontSize: 10, fill: "var(--muted)" }} />
          <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10, fill: "var(--muted)" }} />
           <Tooltip formatter={value => [typeof value === "number" ? formatCurrency(value, language) : value, t("charts.cost")]} contentStyle={tooltipStyle} cursor={tooltipCursor} />
          <Bar dataKey="cost" fill="#f472b6" radius={[0, 4, 4, 0]} />
        </BarChart>}
      </ResponsiveContainer>
    </div>
  );
}
