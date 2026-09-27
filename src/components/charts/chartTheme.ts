// src/components/charts/chartTheme.ts
// Shared style for Recharts tooltips, adapting to the dark/light theme via CSS vars.
export const tooltipStyle: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  fontSize: 12,
};

export const tooltipCursor = { fill: "rgba(255,255,255,0.05)" };
