import { Pie, PieChart, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { useTranslation } from "react-i18next";
import type { SessionRecord } from "../../types";
import { usageByBillingType } from "../../lib/aggregate";
import { formatCompactTokens, formatNumber } from "../../i18n/format";
import { resolveLanguage } from "../../i18n/locale";
import { InfoTooltip } from "../InfoTooltip";
import { tooltipStyle } from "./chartTheme";

const COLORS = ["#22d3ee", "#6366f1"];

export function UsageByBilling({ data }: { data: SessionRecord[] }) {
  const { t, i18n } = useTranslation();
  const language = resolveLanguage(i18n.language);
  const usage = usageByBillingType(data);
  const totalTokens = usage.freeTokens + usage.paidTokens;
  const rows = [
    { key: "free", name: t("charts.free"), tokens: usage.freeTokens, sessions: usage.freeSessions },
    { key: "paid", name: t("charts.paid"), tokens: usage.paidTokens, sessions: usage.paidSessions },
  ];

  return (
    <div className="panel">
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, display: "flex", alignItems: "center" }}>
        {t("charts.usageByBilling")}
        <InfoTooltip text={t("charts.usageByBillingTooltip")} />
      </div>
      {totalTokens === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: 12, textAlign: "center", padding: "70px 0" }}>{t("common.noData")}</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={rows} dataKey="tokens" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
                {rows.map((row, index) => <Cell key={row.key} fill={COLORS[index]} />)}
              </Pie>
              <Tooltip
                formatter={value => [typeof value === "number" ? formatCompactTokens(value, language) : value, t("charts.tokenValue")]}
                contentStyle={tooltipStyle}
              />
            </PieChart>
          </ResponsiveContainer>
          <ul className="chart-legend" aria-label={t("charts.usageLegend")}>
            {rows.map((row, index) => {
              const percentage = totalTokens === 0 ? 0 : row.tokens / totalTokens * 100;
              return (
                <li key={row.key}>
                  <span className="chart-legend-label">
                    <span className="chart-legend-swatch" style={{ background: COLORS[index] }} aria-hidden="true" />
                    {row.name}
                  </span>
                  <span>{formatCompactTokens(row.tokens, language)} · {formatNumber(row.sessions, language)} {t("charts.sessions")} · {formatNumber(percentage, language, { maximumFractionDigits: 1 })}%</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
