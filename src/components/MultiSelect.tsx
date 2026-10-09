// Provides a controlled multi-select with optional grouped selection behavior.
// selected stores currently checked values; grouped mode uses a group value instead of its members.
// An empty selection means none; the complete selectable set represents all.
// "Select all" toggles the complete set, while "Clear" empties the selection.

import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../i18n/format";
import { resolveLanguage } from "../i18n/locale";
import type { ProjectFilterOption } from "../lib/projectFilters";

export function getNextOptionIndex(currentIndex: number, key: string, optionCount: number): number | null {
  if (optionCount === 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return optionCount - 1;
  if (key === "ArrowDown") return Math.min(Math.max(currentIndex, 0) + 1, optionCount - 1);
  if (key === "ArrowUp") return Math.max(Math.min(currentIndex, optionCount - 1) - 1, 0);
  return null;
}

export type OptionSection = {
  title: string;
  options: ProjectFilterOption[];
  selectableForAll: boolean;
};

interface Props {
  label: string;
  options: string[];
  sections?: OptionSection[];
  selected: string[];
  onChange: (next: string[]) => void;
  ariaLabel: string;
}

export function MultiSelect({ label, options, sections: providedSections, selected, onChange, ariaLabel }: Props) {
  const { t, i18n } = useTranslation();
  const language = resolveLanguage(i18n.language);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [activeOptionIndex, setActiveOptionIndex] = useState(0);
  const listboxId = useId();
  const sections: OptionSection[] = providedSections ?? [{
    title: "",
    options: options.map(value => {
      const shortLabel = value.split(/[\\/]/).pop() ?? value;
      return { value, label: shortLabel, kind: "project", ariaLabel: shortLabel };
    }),
    selectableForAll: true,
  }];
  const groupedOptions = sections.flatMap(section => section.options);
  const allSelectableOptions = sections.flatMap(section => section.selectableForAll ? section.options : []);
  const groupedMode = providedSections !== undefined;
  const optionValuesKey = groupedOptions.map(option => option.value).join("\u0001");
  const previousOptionValuesKey = useRef(optionValuesKey);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    if (previousOptionValuesKey.current !== optionValuesKey) {
      previousOptionValuesKey.current = optionValuesKey;
      setActiveOptionIndex(0);
      return;
    }
    setActiveOptionIndex(current => groupedOptions.length === 0 ? 0 : Math.min(current, groupedOptions.length - 1));
  }, [groupedOptions.length, optionValuesKey]);

  useEffect(() => {
    if (!open || groupedOptions.length === 0) return;
    optionRefs.current[activeOptionIndex]?.focus();
  }, [open, activeOptionIndex, optionValuesKey, groupedOptions.length]);

  const selectableValues = providedSections === undefined
    ? options
    : allSelectableOptions.map(option => option.value);
  const allChecked = selectableValues.every(value => selected.includes(value)) &&
    selected.every(value => selectableValues.includes(value));
  const noneChecked = selected.length === 0;
  const partial = !allChecked && !noneChecked;

  const toggle = (option: ProjectFilterOption) => {
    if (option.kind === "group") {
      if (selected.includes(option.value)) onChange(selected.filter(value => value !== option.value));
      else {
        const members = new Set(option.members ?? []);
        onChange([
          ...selected.filter(value => !sections.some(section => section.options.some(item => item.kind === "group" && item.value === value)) && !members.has(value)),
          option.value,
        ]);
      }
      return;
    }
    if (selected.includes(option.value)) onChange(selected.filter(value => value !== option.value));
    else onChange([...selected, option.value]);
  };

  const toggleAll = () => onChange(allChecked ? [] : allSelectableOptions.map(option => option.value));

  const selectedOption = groupedMode ? groupedOptions.find(option => selected.includes(option.value)) : undefined;

  const triggerLabel = allChecked
    ? `${label} : ${t("filters.all")}`
    : noneChecked
      ? `${label} : ${t("filters.none")}`
    : selectedOption
      ? `${label} : ${selectedOption.label}`
      : selected.length === 1
        ? `${label} : ${selected[0].split(/[\\/]/).pop() ?? selected[0]}`
        : `${label} : ${t("filters.selectedCount", { selected: formatNumber(selected.length, language), total: formatNumber(groupedOptions.length, language) })}`;

  return (
    <div ref={containerRef} style={{ position: "relative", flex: 1, minWidth: 130 }}>
      <button ref={triggerRef} onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open} aria-controls={listboxId}
        style={{ width: "100%", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "var(--text)", cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{triggerLabel}</span>
        <span aria-hidden style={{ marginLeft: 6, fontSize: 10 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 100, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, minWidth: "100%", maxHeight: 260, overflowY: "auto", boxShadow: "0 4px 16px rgba(0,0,0,.4)" }}>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, fontWeight: 500, color: allChecked ? "var(--accent)" : "var(--text)" }}>
               <IndeterminateCheckbox checked={allChecked} indeterminate={partial} onChange={toggleAll} ariaLabel={t("filters.selectAll")} />
               {t("filters.selectAll")}
            </label>
            {!noneChecked && (
               <button onClick={() => onChange([])} aria-label={t("filters.clear")}
                style={{ background: "none", border: "none", fontSize: 11, color: "var(--accent)", cursor: "pointer", padding: "0 2px" }}>
                 {t("filters.clear")}
              </button>
            )}
          </div>

          <div id={listboxId} role="listbox" aria-multiselectable="true" aria-label={ariaLabel}>
             {sections.map((section, sectionIndex) => {
               const headingId = `${listboxId}-section-${sectionIndex}`;
               return (
                 <div key={`${section.title}-${sectionIndex}`} className={section.options[0]?.kind === "group" ? "multi-select-section multi-select-group-section" : "multi-select-section"} role="group" aria-label={section.title || undefined} aria-labelledby={section.title ? headingId : undefined}>
                   {section.title && <h3 id={headingId} className="multi-select-section-heading">{section.title}</h3>}
                   {section.options.map(option => {
                     const index = groupedOptions.indexOf(option);
                     const checked = selected.includes(option.value);
                     return (
                <div key={option.value} ref={element => { optionRefs.current[index] = element; }} title={option.value} role="option" aria-label={option.ariaLabel} aria-selected={checked} tabIndex={index === activeOptionIndex ? 0 : -1}
                  className={`multi-select-option${option.kind === "group" ? " multi-select-option-group" : ""}`}
                  onClick={() => { setActiveOptionIndex(index); toggle(option); }}
                  onKeyDown={e => {
                    const nextIndex = getNextOptionIndex(index, e.key, groupedOptions.length);
                   if (nextIndex !== null) {
                     e.preventDefault();
                     setActiveOptionIndex(nextIndex);
                     optionRefs.current[nextIndex]?.focus();
                     return;
                   }
                   if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    toggle(option);
                   }
                 }}
                 >
                 <span aria-hidden style={{ accentColor: "var(--accent)", width: 14, height: 14, flexShrink: 0, border: "1px solid var(--border)", borderRadius: 3, color: "var(--accent)", lineHeight: "12px", textAlign: "center" }}>
                   {checked ? "✓" : ""}
                 </span>
                  {option.kind === "group" && <span aria-hidden className="multi-select-group-marker">{t("filters.groupMarker")}</span>}
                 <span className="multi-select-option-label">{option.label}</span>
               </div>
                     );
                   })}
                 </div>
               );
             })}
          </div>
        </div>
      )}
    </div>
  );
}

function IndeterminateCheckbox({ checked, indeterminate, onChange, ariaLabel }: {
  checked: boolean; indeterminate: boolean; onChange: () => void; ariaLabel: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange}
    style={{ accentColor: "var(--accent)", width: 14, height: 14 }} aria-label={ariaLabel} />;
}
