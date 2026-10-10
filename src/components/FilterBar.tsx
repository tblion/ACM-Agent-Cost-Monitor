// Collects date, project, model, and provider filters for the dashboard.
import type { CSSProperties } from "react";
import { dateRangeForPreset, endOfLocalDay, formatLocalDate, startOfLocalDay, type DatePreset, type Filters } from "../lib/aggregate";
import { MultiSelect } from "./MultiSelect";
import { useTranslation } from "react-i18next";
import type { ProjectFilterOptions } from "../lib/projectFilters";
import { InfoTooltip } from "./InfoTooltip";

interface Props {
  filters: Filters;
  projects: string[]; models: string[]; providers: string[];
  projectFilterOptions: ProjectFilterOptions;
  onChange: (f: Filters) => void;
  onReset: () => void;
}

const dateSel: CSSProperties = {
  flex: 1, minWidth: 130, background: "var(--panel)", border: "1px solid var(--border)",
  borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "var(--text)",
};

const datePresets: Exclude<DatePreset, "custom">[] = [
  "today", "yesterday", "last7Days", "thisWeek", "last30Days", "thisMonth", "lastMonth", "thisYear", "allTime",
];

const visuallyHidden: CSSProperties = {
  position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
  overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0,
};

export function FilterBar({ filters, projects, models, providers, projectFilterOptions, onChange, onReset }: Props) {
  const { t } = useTranslation();
  const projectValues = new Set(projectFilterOptions.projects.map(option => option.value));
  const groupValues = new Set(projectFilterOptions.groups.map(option => option.value));
  const projectSections = [
    { title: t("filters.projectGroups"), options: projectFilterOptions.groups, selectableForAll: false },
    { title: t("filters.projects"), options: projectFilterOptions.projects, selectableForAll: true },
  ];
  const handleProjectsChange = (values: string[]) => {
    const hasGroup = values.some(value => groupValues.has(value));
    const selectedProjects = values.filter(value => projectValues.has(value));
    const allProjectsSelected = selectedProjects.length === projects.length && selectedProjects.every(value => projectValues.has(value));
    onChange({ ...filters, projects: !hasGroup && allProjectsSelected ? undefined : values });
  };
  const handleDatePresetChange = (preset: DatePreset) => {
    if (preset === "custom") {
      onChange({ ...filters, datePreset: preset });
      return;
    }
    onChange({ ...filters, ...dateRangeForPreset(preset), datePreset: preset });
  };
  const handleStartDateChange = (value: string) => {
    const from = value ? startOfLocalDay(value) : undefined;
    const to = from !== undefined && filters.to !== undefined && from > filters.to
      ? endOfLocalDay(value)
      : filters.to;
    onChange({ ...filters, datePreset: "custom", from, to });
  };
  const handleEndDateChange = (value: string) => {
    const to = value ? endOfLocalDay(value) : undefined;
    const from = to !== undefined && filters.from !== undefined && to < filters.from
      ? startOfLocalDay(value)
      : filters.from;
    onChange({ ...filters, datePreset: "custom", from, to });
  };
  return (
    <div style={{ display: "flex", gap: 10, padding: "14px 20px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
      <MultiSelect
         label={t("filters.project")} options={[]} sections={projectSections}
         selected={filters.projects ?? [...projects]}
         onChange={handleProjectsChange}
         ariaLabel={t("filters.projectFilter")}
      />
      <MultiSelect
         label={t("filters.model")} options={models}
        selected={filters.models ?? [...models]}
        onChange={v => onChange({ ...filters, models: v.length === models.length ? undefined : v })}
         ariaLabel={t("filters.modelFilter")}
      />
      <MultiSelect
        label={t("filters.provider")} options={providers}
         selected={filters.providers ?? [...providers]}
         onChange={v => onChange({ ...filters, providers: v.length === providers.length ? undefined : v })}
         ariaLabel={t("filters.providerFilter")}
      />
       <label htmlFor="filter-date-preset" style={visuallyHidden}>{t("filters.datePreset")}</label>
        <select
         id="filter-date-preset"
         value={filters.datePreset ?? "custom"}
         onChange={e => handleDatePresetChange(e.target.value as DatePreset)}
         style={dateSel}
       >
         {datePresets.map(preset => <option key={preset} value={preset}>{t(`filters.datePresets.${preset}` as never)}</option>)}
         <option value="custom">{t("filters.datePresets.custom")}</option>
        </select>
        <label className="date-session-scope">
          <input
            type="checkbox"
            checked={filters.includeWholeSessions !== false}
            onChange={event => onChange({ ...filters, includeWholeSessions: event.target.checked })}
          />
          {t("filters.includeWholeSessions")}
        </label>
        <InfoTooltip text={t("filters.includeWholeSessionsTooltip")} />
        <label htmlFor="filter-start-date" style={visuallyHidden}>{t("filters.startDate")}</label>
        <input id="filter-start-date" name="from" type="date" style={dateSel}
            value={filters.from !== undefined ? formatLocalDate(filters.from) : ""}
            onChange={e => handleStartDateChange(e.target.value)} />
       <label htmlFor="filter-end-date" style={visuallyHidden}>{t("filters.endDate")}</label>
        <input id="filter-end-date" name="to" type="date" style={dateSel}
           value={filters.to !== undefined ? formatLocalDate(filters.to) : ""}
           onChange={e => handleEndDateChange(e.target.value)} />
      <button onClick={onReset} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "var(--text)", cursor: "pointer" }}
         aria-label={t("filters.resetLabel")}>
         {t("filters.reset")}
      </button>
    </div>
  );
}
