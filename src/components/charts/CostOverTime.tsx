// Plots usage cost over time for the selected period.
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { SessionRecord } from "../../types";
import { InfoTooltip } from "../InfoTooltip";
import { tooltipStyle, tooltipCursor } from "./chartTheme";
import { useTranslation } from "react-i18next";
import { formatCurrency, formatDate, formatNumber } from "../../i18n/format";
import { resolveLanguage } from "../../i18n/locale";
import { formatLocalDate } from "../../lib/aggregate";

export function CostOverTime({ data }: { data: SessionRecord[] }) {
  const { t, i18n } = useTranslation();
  const language = resolveLanguage(i18n.language);
  const byDay = new Map<string, number>();
  for (const s of data) {
    if (s.messages?.length) {
      for (const message of s.messages) {
        const d = formatLocalDate(message.date ?? s.date);
        byDay.set(d, (byDay.get(d) ?? 0) + message.cost);
      }
    } else {
      const d = formatLocalDate(s.date);
      byDay.set(d, (byDay.get(d) ?? 0) + s.cost);
    }
  }
  const rows = [...byDay.entries()].map(([day, cost]) => ({ day, cost })).sort((a, b) => a.day.localeCompare(b.day));
  return (
    <div className="panel" style={{ gridColumn: "span 2" }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, display: "flex", alignItems: "center" }}>
        {t("charts.costOverTime")}
        <InfoTooltip text={t("charts.costOverTimeTooltip")} />
      </div>
      <ResponsiveContainer width="100%" height={180}>
        {rows.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 12, textAlign: "center", paddingTop: 70 }}>{t("common.noData")}</div> : <AreaChart data={rows}>
          <defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.4} /><stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
          </linearGradient></defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
           <XAxis dataKey="day" tickFormatter={day => formatDate(new Date(`${day}T00:00:00`).getTime(), language)} tick={{ fontSize: 10, fill: "var(--muted)" }} />
           <YAxis tickFormatter={value => formatNumber(Number(value), language)} tick={{ fontSize: 10, fill: "var(--muted)" }} />
           <Tooltip labelFormatter={day => formatDate(new Date(`${day}T00:00:00`).getTime(), language)} formatter={value => [typeof value === "number" ? formatCurrency(value, language) : value, t("charts.cost")]} contentStyle={tooltipStyle} cursor={tooltipCursor} />
          <Area type="monotone" dataKey="cost" stroke="#22d3ee" fill="url(#c)" />
        </AreaChart>}
      </ResponsiveContainer>
    </div>
  );
}
