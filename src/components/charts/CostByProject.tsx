// src/components/charts/CostByProject.tsx
import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { byProjectSelection, isProjectGroupKey, projectSelectionLabel } from "../../lib/aggregate";
import type { CustomGroup, SessionRecord } from "../../types";
import { InfoTooltip } from "../InfoTooltip";
import { tooltipStyle, tooltipCursor } from "./chartTheme";
import { useTranslation } from "react-i18next";
import { formatCurrency, formatNumber } from "../../i18n/format";
import { resolveLanguage } from "../../i18n/locale";

// Estimate text width in pixels (monospace font ~6.5px per character at 10px).
function estimateWidth(label: string) { return Math.max(60, label.length * 6.5 + 8); }

export function CostByProject({ data, activeGroup }: { data: SessionRecord[]; activeGroup?: CustomGroup }) {
  const { t, i18n } = useTranslation();
  const language = resolveLanguage(i18n.language);
  const rows = useMemo(
    () => {
      const aggregated = byProjectSelection(data, activeGroup);
      const selected = !activeGroup
        ? aggregated.slice(0, 8)
        : (() => {
            const groupRow = aggregated.find(row => isProjectGroupKey(row.key));
            if (!groupRow) return aggregated.slice(0, 8);
            return [
              ...aggregated.filter(row => !isProjectGroupKey(row.key)).slice(0, 7),
              groupRow,
            ].sort((a, b) => b.value - a.value);
          })();
      return selected.map(r => ({
        name: isProjectGroupKey(r.key) ? projectSelectionLabel(r.key) : r.key.split(/[\\/]/).pop() ?? r.key,
        cost: r.value,
      }));
    },
    [activeGroup, data]
  );
  const yWidth = useMemo(() => Math.min(200, Math.max(...rows.map(r => estimateWidth(r.name)))), [rows]);

  const height = Math.max(120, rows.length * 32 + 20);
  return (
    <div className="panel">
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, display: "flex", alignItems: "center" }}>
        {t("charts.costByProject")}
        <InfoTooltip text={t("charts.costByProjectTooltip")} />
      </div>
      <ResponsiveContainer width="100%" height={height}>
        {rows.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 12, textAlign: "center", paddingTop: 70 }}>{t("common.noData")}</div> : <BarChart data={rows} layout="vertical" margin={{ right: 8 }}>
           <XAxis type="number" tickFormatter={value => formatNumber(Number(value), language)} tick={{ fontSize: 10, fill: "var(--muted)" }} />
          <YAxis type="category" dataKey="name" width={yWidth} tick={{ fontSize: 10, fill: "var(--muted)" }} />
           <Tooltip formatter={(v) => [typeof v === "number" ? formatCurrency(v, language) : v, t("charts.cost")]} contentStyle={tooltipStyle} cursor={tooltipCursor} />
          <Bar dataKey="cost" fill="#6366f1" radius={[0, 4, 4, 0]} />
        </BarChart>}
      </ResponsiveContainer>
    </div>
  );
}
