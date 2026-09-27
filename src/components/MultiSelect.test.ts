// @vitest-environment happy-dom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../i18n/config";
import type { ProjectFilterOption } from "../lib/projectFilters";
import { MultiSelect, getNextOptionIndex, type OptionSection } from "./MultiSelect";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type RenderedMultiSelect = {
  container: HTMLDivElement;
  root: Root;
  button: HTMLButtonElement;
};

const options = ["/projects/alpha", "/projects/beta", "/projects/gamma"];
const groupOption: ProjectFilterOption = {
  value: "\u0000project-group:0:Clients",
  label: "Clients",
  kind: "group",
  ariaLabel: "Groupe Clients",
  members: ["/projects/alpha", "/projects/beta"],
};
const projectOptions: ProjectFilterOption[] = options.map(value => ({
  value,
  label: value.split("/").pop() ?? value,
  kind: "project",
  ariaLabel: value,
}));
const groupedSections: OptionSection[] = [
  { title: "Groupes", options: [groupOption], selectableForAll: false },
  { title: "Projets", options: projectOptions, selectableForAll: true },
];
const mounted: RenderedMultiSelect[] = [];

function TestHarness({ initialSelected = [], availableOptions = options }: { initialSelected?: string[]; availableOptions?: string[] }) {
  const [selected, setSelected] = useState(initialSelected);
  return createElement(
    I18nextProvider,
    { i18n },
    createElement(MultiSelect, {
      label: "Project",
      options: availableOptions,
      selected,
      onChange: setSelected,
      ariaLabel: "Project options",
    }),
  );
}

function GroupedTestHarness({ initialSelected = [] }: { initialSelected?: string[] }) {
  const [selected, setSelected] = useState(initialSelected);
  return createElement(
    I18nextProvider,
    { i18n },
    createElement(MultiSelect, {
      label: "Projet",
      options: projectOptions.map(option => option.value),
      sections: groupedSections,
      selected,
      onChange: setSelected,
      ariaLabel: "Options de projet",
    }),
  );
}

function ChangingOptionsHarness() {
  const [availableOptions, setAvailableOptions] = useState(["/projects/alpha", "/projects/beta"]);
  return createElement("div", {},
    createElement("button", { "data-testid": "replace-options", onClick: () => setAvailableOptions(["/projects/changed-a", "/projects/changed-b"]) }, "replace"),
    createElement(TestHarness, { availableOptions }),
  );
}

async function renderMultiSelect(initialSelected?: string[], availableOptions = options): Promise<RenderedMultiSelect> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(TestHarness, { initialSelected, availableOptions })));
  const button = container.querySelector("button") as HTMLButtonElement;
  const rendered = { container, root, button };
  mounted.push(rendered);
  return rendered;
}

async function renderGroupedMultiSelect(initialSelected: string[] = []): Promise<RenderedMultiSelect> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(GroupedTestHarness, { initialSelected })));
  const button = container.querySelector("button") as HTMLButtonElement;
  const rendered = { container, root, button };
  mounted.push(rendered);
  return rendered;
}

function optionsIn(container: HTMLDivElement): HTMLDivElement[] {
  return [...container.querySelectorAll<HTMLDivElement>('[role="option"]')];
}

async function press(element: Element, key: string): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
  });
}

afterEach(async () => {
  await act(async () => {
    for (const { root } of mounted.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

describe("getNextOptionIndex", () => {
  it("navigates with arrows without leaving the list", () => {
    expect(getNextOptionIndex(0, "ArrowDown", 3)).toBe(1);
    expect(getNextOptionIndex(2, "ArrowDown", 3)).toBe(2);
    expect(getNextOptionIndex(0, "ArrowUp", 3)).toBe(0);
    expect(getNextOptionIndex(-1, "ArrowUp", 3)).toBe(0);
  });

  it("jumps to the first and last option", () => {
    expect(getNextOptionIndex(1, "Home", 3)).toBe(0);
    expect(getNextOptionIndex(1, "End", 3)).toBe(2);
    expect(getNextOptionIndex(1, "PageDown", 3)).toBeNull();
  });
});

describe("MultiSelect rendered behavior", () => {
  it("renders options in the order supplied by its caller", async () => {
    const suppliedOptions = ["/workspace/Zeta", "C:\\workspace\\alpha", "/workspace/beta"];
    const { container, button } = await renderMultiSelect([], suppliedOptions);

    await act(async () => button.click());

    expect(optionsIn(container).map(option => option.textContent?.trim())).toEqual(["Zeta", "alpha", "beta"]);
    expect(optionsIn(container).map(option => option.getAttribute("title"))).toEqual(suppliedOptions);
    expect(optionsIn(container).map(option => option.getAttribute("aria-label"))).toEqual(["Zeta", "alpha", "beta"]);
  });

  it("opens from the trigger and exposes the listbox structure", async () => {
    const { container, button } = await renderMultiSelect();

    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="listbox"]')).toBeNull();

    await act(async () => button.click());

    const listbox = container.querySelector('[role="listbox"]');
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-haspopup")).toBe("listbox");
    expect(button.getAttribute("aria-controls")).toBe(listbox?.id);
    expect(listbox?.id).not.toBe("");
    expect(listbox?.getAttribute("aria-multiselectable")).toBe("true");
    expect(listbox?.getAttribute("aria-label")).toBe("Project options");
    expect(optionsIn(container).map(option => option.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "false",
    ]);
    expect(optionsIn(container).map(option => option.tabIndex)).toEqual([0, -1, -1]);
    expect(document.activeElement).toBe(optionsIn(container)[0]);
  });

  it("selects options with click, Enter, and Space", async () => {
    const { container, button } = await renderMultiSelect();
    await act(async () => button.click());
    const [first, second] = optionsIn(container);

    await act(async () => first.click());
    expect(first.getAttribute("aria-selected")).toBe("true");

    second.focus();
    await press(second, "Enter");
    expect(second.getAttribute("aria-selected")).toBe("true");

    first.focus();
    await press(first, " ");
    expect(first.getAttribute("aria-selected")).toBe("false");
  });

  it("closes when clicking outside the component", async () => {
    const { container, button } = await renderMultiSelect();
    await act(async () => button.click());
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes with Escape and restores focus to the trigger", async () => {
    const { container, button } = await renderMultiSelect();
    await act(async () => button.click());
    const [first] = optionsIn(container);
    first.focus();

    await press(first, "Escape");

    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it("moves focus with arrows and Home/End while maintaining roving tabindex", async () => {
    const { container, button } = await renderMultiSelect();
    await act(async () => button.click());
    const [first, second, third] = optionsIn(container);

    await press(first, "ArrowDown");
    expect(document.activeElement).toBe(second);
    expect(optionsIn(container).map(option => option.tabIndex)).toEqual([-1, 0, -1]);

    await press(second, "End");
    expect(document.activeElement).toBe(third);
    expect(optionsIn(container).map(option => option.tabIndex)).toEqual([-1, -1, 0]);

    await press(third, "Home");
    expect(document.activeElement).toBe(first);
    expect(optionsIn(container).map(option => option.tabIndex)).toEqual([0, -1, -1]);

    await press(first, "ArrowUp");
    expect(document.activeElement).toBe(first);
  });

  it("selects all and clears the current selection through exposed actions", async () => {
    const { container, button } = await renderMultiSelect([options[0]]);
    await act(async () => button.click());
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const clearButton = [...container.querySelectorAll("button")].find(candidate => candidate !== button) as HTMLButtonElement;

    await act(async () => checkbox.click());
    expect(optionsIn(container).every(option => option.getAttribute("aria-selected") === "true")).toBe(true);

    await act(async () => clearButton.click());
    expect(optionsIn(container).every(option => option.getAttribute("aria-selected") === "false")).toBe(true);
    expect(container.querySelector('button[aria-label="Clear"]')).toBeNull();
  });

  it("does not mark all options checked when a controlled value is stale", async () => {
    const { container, button } = await renderMultiSelect([options[0], options[1], "/projects/stale"]);
    await act(async () => button.click());

    expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
  });

  it("renders group sections before projects with accessible headings and labels", async () => {
    const { container, button } = await renderGroupedMultiSelect([options[0]]);
    await act(async () => button.click());

    expect([...container.querySelectorAll("h3")].map(heading => heading.textContent)).toEqual(["Groupes", "Projets"]);
    expect(container.querySelector('[role="group"][aria-label="Groupes"]')).not.toBeNull();
    expect(container.querySelector('[role="group"][aria-label="Projets"]')).not.toBeNull();
    expect(optionsIn(container).map(option => option.textContent?.trim())).toEqual([
      "◆Clients",
      "✓alpha",
      "beta",
      "gamma",
    ]);
    expect(optionsIn(container)[0].getAttribute("aria-label")).toBe("Groupe Clients");
    expect(optionsIn(container)[0].className).toContain("multi-select-option-group");
    expect(optionsIn(container)[0].getAttribute("aria-selected")).toBe("false");
  });

  it("selects only projects with Tout sélectionner and clears groups and projects", async () => {
    const { container, button } = await renderGroupedMultiSelect([groupOption.value, options[0]]);
    await act(async () => button.click());
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const clearButton = [...container.querySelectorAll("button")].find(candidate => candidate !== button) as HTMLButtonElement;

    await act(async () => checkbox.click());
    expect(optionsIn(container).map(option => option.getAttribute("aria-selected"))).toEqual(["false", "true", "true", "true"]);

    await act(async () => clearButton.click());
    expect(optionsIn(container).every(option => option.getAttribute("aria-selected") === "false")).toBe(true);
  });

  it("keeps one group active and applies the same behavior to keyboard activation", async () => {
    const otherGroup: ProjectFilterOption = { ...groupOption, value: "\u0000project-group:1:Other", label: "Other", ariaLabel: "Groupe Other" };
    const sections = [
      { title: "Groupes", options: [groupOption, otherGroup], selectableForAll: false },
      { title: "Projets", options: projectOptions, selectableForAll: true },
    ];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(I18nextProvider, { i18n }, createElement(MultiSelect, {
      label: "Projet", options, sections, selected: [options[2]], onChange: next => {
        container.dataset.selected = next.join(",");
      }, ariaLabel: "Options de projet",
    }))));
    mounted.push({ container, root, button: container.querySelector("button") as HTMLButtonElement });
    const button = mounted[mounted.length - 1].button;
    await act(async () => button.click());
    const [firstGroup, secondGroupOption] = optionsIn(container);

    await press(firstGroup, "Enter");
    expect(container.dataset.selected).toBe(`${options[2]},${groupOption.value}`);
    await press(secondGroupOption, " ");
    expect(container.dataset.selected).toBe(`${options[2]},${otherGroup.value}`);
  });

  it("removes group members when selecting a group from all projects", async () => {
    const { container, button } = await renderGroupedMultiSelect(options);
    await act(async () => button.click());

    await act(async () => { (optionsIn(container)[0]).click(); });

    expect(optionsIn(container).map(option => option.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "true"]);
  });

  it("resets the active option when option values change at the same length", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(I18nextProvider, { i18n }, createElement(ChangingOptionsHarness))));
    mounted.push({ container, root, button: container.querySelector("button[aria-controls]") as HTMLButtonElement });
    const selectButton = mounted[mounted.length - 1].button;

    await act(async () => selectButton.click());
    await press(optionsIn(container)[0], "ArrowDown");
    expect(optionsIn(container).map(option => option.tabIndex)).toEqual([-1, 0]);

    await act(async () => { (container.querySelector('[data-testid="replace-options"]') as HTMLButtonElement).click(); });
    expect(optionsIn(container).map(option => option.tabIndex)).toEqual([0, -1]);
  });
});
