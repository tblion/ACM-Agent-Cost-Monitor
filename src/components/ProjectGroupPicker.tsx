// Lets users create and edit named groups of projects.
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "./ConfirmDialog";
import { displayName, sortDisplayValues } from "../lib/sorting";

export interface Props {
  availableProjects: string[];
  selectedProjects: string[];
  onChange: (projects: string[]) => void;
  ariaLabel: string;
}

export function ProjectGroupPicker({
  availableProjects,
  selectedProjects,
  onChange,
  ariaLabel,
}: Props) {
  const { t } = useTranslation();
  const [pendingMissingProject, setPendingMissingProject] = useState<string | null>(null);
  const pickerId = useId().replace(/:/gu, "");
  const projects = sortDisplayValues(Array.from(new Set([...availableProjects, ...selectedProjects])));

  const toggleProject = (project: string, checked: boolean) => {
    const isAvailable = availableProjects.includes(project);
    if (!checked && !isAvailable) {
      setPendingMissingProject(project);
      return;
    }

    onChange(checked
      ? [...selectedProjects, project]
      : selectedProjects.filter(selectedProject => selectedProject !== project));
  };

  return (
    <>
      <fieldset aria-label={ariaLabel} style={{ minWidth: 0, border: 0, margin: 0, padding: 0 }}>
        <legend style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>
          {ariaLabel}
        </legend>
        <div style={{ minWidth: 0, display: "grid", gap: 8 }}>
          {projects.map((project, index) => {
            const isSelected = selectedProjects.includes(project);
            const isMissing = isSelected && !availableProjects.includes(project);
            const checkboxId = `${pickerId}-project-${index}`;
            const descriptionId = isMissing ? `${pickerId}-missing-${index}` : undefined;

            return (
              <label
                key={project}
                style={{ display: "flex", alignItems: "center", gap: 8, color: isMissing ? "var(--muted)" : "var(--text)", cursor: "pointer" }}
              >
                <input
                  id={checkboxId}
                  type="checkbox"
                  value={project}
                  checked={isSelected}
                  onChange={event => toggleProject(project, event.target.checked)}
                  onKeyDown={event => {
                    if (event.key === " ") {
                      event.preventDefault();
                      toggleProject(project, !isSelected);
                    }
                  }}
                  aria-describedby={descriptionId}
                />
                <span style={{ minWidth: 0, overflowWrap: "anywhere", textDecoration: isMissing ? "line-through" : undefined }}>{displayName(project)}</span>
                {isMissing && (
                  <span id={descriptionId} style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>
                    {t("settings.missingProject")}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </fieldset>
      {pendingMissingProject !== null && (
        <ConfirmDialog
          title={t("settings.removeMissingProjectTitle")}
          description={t("settings.removeMissingProjectDescription")}
          confirmLabel={t("settings.confirmRemoval")}
          cancelLabel={t("settings.cancelRemoval")}
          onCancel={() => setPendingMissingProject(null)}
          onConfirm={() => {
            onChange(selectedProjects.filter(project => project !== pendingMissingProject));
            setPendingMissingProject(null);
          }}
        />
      )}
    </>
  );
}
