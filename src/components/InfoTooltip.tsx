// Provides a reusable information button with a hover- and focus-triggered tooltip.
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function InfoTooltip({ text }: { text: string }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", marginLeft: 5, verticalAlign: "middle" }}>
      <button
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        aria-label={t("common.moreInformation")}
        style={{ background: "none", border: "1px solid var(--muted)", borderRadius: "50%", width: 14, height: 14, fontSize: 9, color: "var(--muted)", cursor: "default", padding: 0, lineHeight: "12px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
      >
        i
      </button>
      {visible && (
        <span role="tooltip" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 11, color: "var(--text)", whiteSpace: "pre-line", zIndex: 200, minWidth: 200, maxWidth: 280, boxShadow: "0 4px 16px rgba(0,0,0,.4)", pointerEvents: "none" }}>
          {text}
        </span>
      )}
    </span>
  );
}
