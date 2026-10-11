// Navigation latérale principale, repliable et adaptée aux vues de l’application.
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  showSettings: boolean;
  onDashboard: () => void;
  onSettings: () => void;
}

export function AppSidebar({ showSettings, onDashboard, onSettings }: Props) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => typeof window.matchMedia === "function" && window.matchMedia("(max-width: 760px)").matches);

  const items = [
    { id: "dashboard", label: t("header.dashboard"), ariaLabel: t("header.dashboardLabel"), icon: "▦", active: !showSettings, onClick: onDashboard },
    { id: "settings", label: t("settings.title"), ariaLabel: t("header.settingsLabel"), icon: "⚙", active: showSettings, onClick: onSettings },
  ];

  return (
    <aside className={`app-sidebar${collapsed ? " is-collapsed" : ""}`}>
      <nav aria-label={t("navigation.primary")}>
        <div className="sidebar-heading">
          <span className="sidebar-section-title">{t("navigation.workspace")}</span>
          <button
            type="button"
            className="sidebar-collapse"
            aria-label={t(collapsed ? "navigation.expand" : "navigation.collapse")}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(value => !value)}
          >
            <span aria-hidden="true">{collapsed ? "›" : "‹"}</span>
          </button>
        </div>
        {items.map(item => (
          <button
            key={item.id}
            type="button"
            className={`sidebar-link${item.active ? " is-active" : ""}`}
            aria-current={item.active ? "page" : undefined}
            aria-label={item.ariaLabel}
            title={collapsed ? item.label : undefined}
            onClick={item.onClick}
          >
            <span className="sidebar-icon" aria-hidden="true">{item.icon}</span>
            <span className="sidebar-label">{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
