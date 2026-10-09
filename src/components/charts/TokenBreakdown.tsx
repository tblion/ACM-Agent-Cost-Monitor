// Visualizes token usage by token category for the filtered sessions.
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { tokenTotals } from "../../lib/aggregate";
import type { SessionRecord } from "../../types";
import { InfoTooltip } from "../InfoTooltip";
import { tooltipStyle, tooltipCursor } from "./chartTheme";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../../i18n/format";
import { resolveLanguage } from "../../i18n/locale";

export function TokenBreakdown({ data }: { data: SessionRecord[] }) {
  const { t, i18n } = useTranslation();
  const language = resolveLanguage(i18n.language);
  const totals = tokenTotals(data);
  const rows = [
    { name: t("charts.input"), value: totals.input },
    { name: t("charts.output"), value: totals.output },
    { name: t("charts.cacheRead"), value: totals.cacheRead },
    { name: t("charts.cacheWrite"), value: totals.cacheWrite },
    { name: t("charts.reasoning"), value: totals.reasoning },
  ];
  const tokenSummary = rows.map(row => `${row.name}: ${formatNumber(row.value, language)}`).join(", ");
  return (
    <div className="panel" aria-label={tokenSummary}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, display: "flex", alignItems: "center" }}>
        {t("charts.tokenBreakdown")}
        <InfoTooltip text={t("charts.tokenBreakdownTooltip")} />
      </div>
      <ResponsiveContainer width="100%" height={180}>
        {rows.every(row => row.value === 0) ? <div style={{ color: "var(--muted)", fontSize: 12, textAlign: "center", paddingTop: 70 }}>{t("common.noData")}</div> : <BarChart data={rows} layout="vertical">
           <XAxis type="number" tickFormatter={value => formatNumber(Number(value), language)} tick={{ fontSize: 10, fill: "var(--muted)" }} />
          <YAxis type="category" dataKey="name" width={60} tick={{ fontSize: 10, fill: "var(--muted)" }} />
           <Tooltip formatter={value => [typeof value === "number" ? formatNumber(value, language) : value]} contentStyle={tooltipStyle} cursor={tooltipCursor} />
           <Bar dataKey="value" name={t("charts.tokenValue")} fill="#a78bfa" radius={[0, 4, 4, 0]} />
        </BarChart>}
      </ResponsiveContainer>
    </div>
  );
}
