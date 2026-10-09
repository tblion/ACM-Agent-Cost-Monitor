// Collects date, project, model, and provider filters for the dashboard.
import type { CSSProperties } from "react";
import { endOfLocalDay, formatLocalDate, startOfLocalDay, type Filters } from "../lib/aggregate";
import { MultiSelect } from "./MultiSelect";
import { useTranslation } from "react-i18next";
import type { ProjectFilterOptions } from "../lib/projectFilters";

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
       <label htmlFor="filter-start-date" style={visuallyHidden}>{t("filters.startDate")}</label>
       <input id="filter-start-date" name="from" type="date" style={dateSel}
           value={filters.from !== undefined ? formatLocalDate(filters.from) : ""}
          onChange={e => onChange({ ...filters, from: e.target.value ? startOfLocalDay(e.target.value) : undefined })}
          aria-label={t("filters.startDate")} />
       <label htmlFor="filter-end-date" style={visuallyHidden}>{t("filters.endDate")}</label>
       <input id="filter-end-date" name="to" type="date" style={dateSel}
          value={filters.to !== undefined ? formatLocalDate(filters.to) : ""}
         onChange={e => onChange({ ...filters, to: e.target.value ? endOfLocalDay(e.target.value) : undefined })}
         aria-label={t("filters.endDate")} />
      <button onClick={onReset} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "var(--text)", cursor: "pointer" }}
         aria-label={t("filters.resetLabel")}>
         {t("filters.reset")}
      </button>
    </div>
  );
}
