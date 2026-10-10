// @vitest-environment happy-dom
// Tests dashboard filter controls and their change callbacks.

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n/config";
import { buildProjectFilterOptions } from "../lib/projectFilters";
import { dateRangeForPreset, endOfLocalDay, startOfLocalDay, type Filters } from "../lib/aggregate";
import { FilterBar } from "./FilterBar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Root[] = [];

function FilterBarHarness({ initialFilters, onChange, projectFilterOptions }: { initialFilters: Filters; onChange: (filters: Filters) => void; projectFilterOptions: ReturnType<typeof buildProjectFilterOptions> }) {
  const [filters, setFilters] = useState(initialFilters);
  return createElement(FilterBar, {
    filters,
    projects: ["/work/a", "/work/b"],
    models: ["model"],
    providers: ["provider"],
    projectFilterOptions,
    onChange: next => { setFilters(next); onChange(next); },
    onReset: vi.fn(),
  });
}

async function renderFilterBar(filters: Filters = {}, onChange = vi.fn()): Promise<{ container: HTMLDivElement; onChange: typeof onChange }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const projectFilterOptions = buildProjectFilterOptions(["/work/a", "/work/b"], [
    { name: "Clients", projects: ["/work/a"] },
    { name: "Other", projects: ["/work/c"] },
  ], { groupAriaLabel: name => i18n.t("filters.groupAriaLabel", { name }) });
  await act(async () => root.render(createElement(I18nextProvider, { i18n }, createElement(FilterBarHarness, {
    initialFilters: filters,
    projectFilterOptions,
    onChange,
  }))));
  mounted.push(root);
  return { container, onChange };
}

afterEach(async () => {
  await act(async () => { for (const root of mounted.splice(0)) root.unmount(); });
  document.body.replaceChildren();
});

beforeEach(async () => {
  await act(async () => { await i18n.changeLanguage("fr"); });
});

describe("FilterBar project groups", () => {
  it("associates unique labels and names with the date inputs", async () => {
    const { container } = await renderFilterBar();
    const startDate = container.querySelector("#filter-start-date") as HTMLInputElement;
    const endDate = container.querySelector("#filter-end-date") as HTMLInputElement;

    expect(startDate.name).toBe("from");
    expect(endDate.name).toBe("to");
    expect(container.querySelector('label[for="filter-start-date"]')?.textContent).toBe("Date début");
    expect(container.querySelector('label[for="filter-end-date"]')?.textContent).toBe("Date fin");
  });

  it("affiche et modifie les dates en heure locale avec des bornes inclusives", async () => {
    const date = new Date(2026, 0, 7, 12, 34, 56, 789).getTime();
    const onChange = vi.fn();
    const { container } = await renderFilterBar({ from: date, to: date }, onChange);
    const startDate = container.querySelector("#filter-start-date") as HTMLInputElement;
    const endDate = container.querySelector("#filter-end-date") as HTMLInputElement;

    expect(startDate.value).toBe("2026-01-07");
    expect(endDate.value).toBe("2026-01-07");

    await act(async () => {
      const setValue = (input: HTMLInputElement, value: string) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };
      setValue(startDate, "2026-01-08");
      setValue(endDate, "2026-01-09");
    });

    expect(onChange).toHaveBeenNthCalledWith(1, expect.objectContaining({ from: new Date(2026, 0, 8, 0, 0, 0, 0).getTime() }));
    expect(onChange).toHaveBeenNthCalledWith(2, expect.objectContaining({ to: new Date(2026, 0, 9, 23, 59, 59, 999).getTime() }));
  });

  it("affiche correctement l'epoch au lieu de traiter 0 comme une valeur absente", async () => {
    const { container } = await renderFilterBar({ from: 0, to: 0 });

    expect((container.querySelector("#filter-start-date") as HTMLInputElement).value).not.toBe("");
    expect((container.querySelector("#filter-end-date") as HTMLInputElement).value).not.toBe("");
  });

  it("applique une période calendaire complète depuis le sélecteur", async () => {
    const onChange = vi.fn();
    const { container } = await renderFilterBar({}, onChange);
    const preset = container.querySelector("#filter-date-preset") as HTMLSelectElement;
    const range = dateRangeForPreset("thisWeek");

    await act(async () => {
      preset.value = "thisWeek";
      preset.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ ...range, datePreset: "thisWeek" }));
  });

  it("efface les deux bornes avec le préréglage toutes les dates", async () => {
    const onChange = vi.fn();
    const { container } = await renderFilterBar({ from: 1, to: 2 }, onChange);
    const preset = container.querySelector("#filter-date-preset") as HTMLSelectElement;

    await act(async () => {
      preset.value = "allTime";
      preset.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ from: undefined, to: undefined, datePreset: "allTime" }));
  });

  it("active les sessions entières par défaut et expose la bascule accessible", async () => {
    const onChange = vi.fn();
    const { container } = await renderFilterBar({}, onChange);
    const checkbox = container.querySelector(".date-session-scope input") as HTMLInputElement;

    expect(checkbox.checked).toBe(true);
    expect(checkbox.closest("label")?.textContent).toContain("Inclure les sessions entières");

    await act(async () => checkbox.click());

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ includeWholeSessions: false }));
    expect(checkbox.checked).toBe(false);
  });

  it("ajuste la borne opposée quand une date personnalisée inverse la plage", async () => {
    const onChange = vi.fn();
    const start = startOfLocalDay("2026-01-08")!;
    const end = endOfLocalDay("2026-01-09")!;
    const { container } = await renderFilterBar({ from: start, to: end }, onChange);
    const startInput = container.querySelector("#filter-start-date") as HTMLInputElement;

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(startInput, "2026-01-10");
      startInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      from: startOfLocalDay("2026-01-10"),
      to: endOfLocalDay("2026-01-10"),
      datePreset: "custom",
    }));
  });

  it("renders groups before projects and leaves groups unchecked by default", async () => {
    const { container } = await renderFilterBar();
    const projectTrigger = container.querySelector("button[aria-controls]") as HTMLButtonElement;

    await act(async () => projectTrigger.click());

    expect([...container.querySelectorAll("h3")].map(heading => heading.textContent)).toEqual(["Groupes", "Projets"]);
    expect(container.querySelector('[aria-label="Groupe Clients"]')?.getAttribute("aria-selected")).toBe("false");
  });

  it("uses translated section and accessible group labels in English", async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
    try {
      const { container } = await renderFilterBar();
      const projectTrigger = container.querySelector("button[aria-controls]") as HTMLButtonElement;

      await act(async () => projectTrigger.click());

      expect([...container.querySelectorAll("h3")].map(heading => heading.textContent)).toEqual(["Groups", "Projects"]);
      expect(container.querySelector('[aria-label="Group Clients"]')).not.toBeNull();
    } finally {
      await act(async () => { await i18n.changeLanguage("fr"); });
    }
  });

  it("keeps the selected group in project state and replaces it when another group is chosen", async () => {
    const onChange = vi.fn();
    const { container } = await renderFilterBar({}, onChange);
    const projectTrigger = container.querySelector("button[aria-controls]") as HTMLButtonElement;

    await act(async () => projectTrigger.click());
    const groups = [...container.querySelectorAll('[role="option"]')].slice(0, 2) as HTMLDivElement[];
    await act(async () => groups[0].click());
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ projects: ["/work/b", expect.stringContaining("Clients")] }));

    await act(async () => groups[1].click());
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ projects: ["/work/b", expect.stringContaining("Other")] }));
  });

  it("keeps model and provider filters on the flat API", async () => {
    const onChange = vi.fn();
    const { container } = await renderFilterBar({}, onChange);
    const triggers = [...container.querySelectorAll("button[aria-controls]")];
    const modelTrigger = triggers[1] as HTMLButtonElement;

    await act(async () => modelTrigger.click());
    const modelOption = [...container.querySelectorAll('[role="option"]')].find(option => option.textContent?.includes("model")) as HTMLDivElement;
    await act(async () => modelOption.click());

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ models: [] }));
  });
});
