// src/components/charts/TopSessions.tsx
import { topSessions } from "../../lib/aggregate";
import type { SessionRecord } from "../../types";
import { InfoTooltip } from "../InfoTooltip";
import { useTranslation } from "react-i18next";
import { formatCurrency } from "../../i18n/format";
import { resolveLanguage } from "../../i18n/locale";

export function TopSessions({ data }: { data: SessionRecord[] }) {
  const { t, i18n } = useTranslation();
  const language = resolveLanguage(i18n.language);
  const rows = topSessions(data, 6);
  return (
    <div className="panel">
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: "flex", alignItems: "center" }}>
        {t("charts.topSessions")}
        <InfoTooltip text={t("charts.topSessionsTooltip")} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 12 }}>
         {rows.length === 0 && <div style={{ color: "var(--muted)", textAlign: "center" }}>{t("common.noData")}</div>}
         {rows.map(s => (
          <div key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
             <b style={{ color: "var(--text)" }}>{formatCurrency(s.cost, language)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
