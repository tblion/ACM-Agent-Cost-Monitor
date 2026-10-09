// @vitest-environment happy-dom
// Tests project group creation, editing, and selection workflows.

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n/config";
import { ProjectGroupPicker } from "./ProjectGroupPicker";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Root[] = [];

async function renderPicker(
  props: Partial<React.ComponentProps<typeof ProjectGroupPicker>> = {},
): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(root);
  await act(async () => {
    root.render(createElement(
      I18nextProvider,
      { i18n },
      createElement(ProjectGroupPicker, {
        availableProjects: [],
        selectedProjects: [],
        onChange: vi.fn(),
        ariaLabel: "Projects",
        ...props,
      }),
    ));
  });
  return { container, root };
}

function ControlledPicker({
  availableProjects,
  initialSelectedProjects,
  onChange,
  ariaLabel,
}: {
  availableProjects: string[];
  initialSelectedProjects: string[];
  onChange: (projects: string[]) => void;
  ariaLabel: string;
}) {
  const [selectedProjects, setSelectedProjects] = useState(initialSelectedProjects);
  return createElement(ProjectGroupPicker, {
    availableProjects,
    selectedProjects,
    onChange: projects => {
      setSelectedProjects(projects);
      onChange(projects);
    },
    ariaLabel,
  });
}

beforeEach(async () => { await i18n.changeLanguage("en"); });

afterEach(async () => {
  await act(async () => { for (const root of mounted.splice(0)) root.unmount(); });
  document.body.replaceChildren();
  await i18n.changeLanguage("en");
});

describe("ProjectGroupPicker", () => {
  it("renders the deduplicated union sorted by display name while keeping full path values", async () => {
    const { container } = await renderPicker({
      availableProjects: ["/workspace/Zeta", "/workspace/Alpha", "/workspace/Alpha"],
      selectedProjects: ["/workspace/Zeta", "C:\\workspace\\Project"],
    });

    expect(Array.from(container.querySelectorAll("label"), label => label.querySelector("span")?.textContent)).toEqual([
      "Alpha",
      "Project",
      "Zeta",
    ]);
    expect(Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'), input => input.value)).toEqual([
      "/workspace/Alpha",
      "C:\\workspace\\Project",
      "/workspace/Zeta",
    ]);
  });

  it("marks an unavailable selected project as missing and keeps it checked", async () => {
    const { container } = await renderPicker({
      availableProjects: ["/workspace/active"],
      selectedProjects: ["/workspace/missing"],
    });

    const missingInput = container.querySelector<HTMLInputElement>('input[value="/workspace/missing"]');
    const missingLabel = missingInput?.closest("label");
    expect(missingInput?.checked).toBe(true);
    expect(missingLabel?.textContent).toContain("Missing project");
    expect(missingLabel?.querySelector("span")?.style.textDecoration).toContain("line-through");
    expect(missingInput?.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(missingInput?.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Missing project");
  });

  it("checks active projects according to their complete path values", async () => {
    const { container } = await renderPicker({
      availableProjects: ["/workspace/active", "/workspace/other"],
      selectedProjects: ["/workspace/active"],
    });

    expect(container.querySelector<HTMLInputElement>('input[value="/workspace/active"]')?.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[value="/workspace/other"]')?.checked).toBe(false);
  });

  it("does not mutate frozen input arrays", async () => {
    const availableProjects = Object.freeze(["/workspace/active", "/workspace/other"]) as unknown as string[];
    const selectedProjects = Object.freeze(["/workspace/active"]) as unknown as string[];
    const onChange = vi.fn();
    const { container } = await renderPicker({ availableProjects, selectedProjects, onChange });
    const other = container.querySelector<HTMLInputElement>('input[value="/workspace/other"]') as HTMLInputElement;

    await act(async () => { other.click(); });

    expect(availableProjects).toEqual(["/workspace/active", "/workspace/other"]);
    expect(selectedProjects).toEqual(["/workspace/active"]);
    expect(onChange).toHaveBeenCalledWith(["/workspace/active", "/workspace/other"]);
  });

  it("protects long project names from horizontal overflow", async () => {
    const longProject = `/workspace/${"project-".repeat(80)}`;
    const { container } = await renderPicker({
      availableProjects: [longProject],
      selectedProjects: [longProject],
    });
    const fieldset = container.querySelector("fieldset") as HTMLFieldSetElement;
    const projectName = container.querySelector("label span") as HTMLSpanElement;

    expect(["0", "0px"]).toContain(fieldset.style.minWidth);
    expect(["0", "0px"]).toContain(fieldset.querySelector("div")?.style.minWidth);
    expect(["0", "0px"]).toContain(projectName.style.minWidth);
    expect(projectName.style.overflowWrap).toBe("anywhere");
  });

  it("gives every checkbox a valid label, id, and described-by reference", async () => {
    const { container } = await renderPicker({
      availableProjects: ["/workspace/active"],
      selectedProjects: ["/workspace/missing"],
    });

    for (const input of Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
      expect(input.id).toMatch(/^[A-Za-z_][A-Za-z0-9_-]*$/);
      expect(input.labels).toHaveLength(1);
      expect(input.labels?.[0]?.textContent).toContain(input.value.endsWith("active") ? "active" : "missing");
    }

    const missingInput = container.querySelector<HTMLInputElement>('input[value="/workspace/missing"]') as HTMLInputElement;
    const describedBy = missingInput.getAttribute("aria-describedby");
    expect(describedBy).toMatch(/^[A-Za-z_][A-Za-z0-9_-]*-missing-\d+$/);
    expect(describedBy && document.getElementById(describedBy)?.id).toBe(describedBy);
  });

  it("changes active projects immediately", async () => {
    const onChange = vi.fn();
    const { container } = await renderPicker({
      availableProjects: ["/workspace/active", "/workspace/other"],
      selectedProjects: ["/workspace/active"],
      onChange,
    });
    const other = container.querySelector<HTMLInputElement>('input[value="/workspace/other"]') as HTMLInputElement;
    const active = container.querySelector<HTMLInputElement>('input[value="/workspace/active"]') as HTMLInputElement;

    await act(async () => { other.click(); });
    await act(async () => { active.click(); });

    expect(onChange).toHaveBeenNthCalledWith(1, ["/workspace/active", "/workspace/other"]);
    expect(onChange).toHaveBeenNthCalledWith(2, []);
  });

  it("deselects an active project immediately with Space", async () => {
    const onChange = vi.fn();
    const { container } = await renderPicker({
      availableProjects: ["/workspace/active"],
      selectedProjects: ["/workspace/active"],
      onChange,
    });
    const active = container.querySelector<HTMLInputElement>('input[value="/workspace/active"]') as HTMLInputElement;
    active.focus();

    await act(async () => {
      active.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: " " }));
    });

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("confirms before removing an unavailable project and leaves selection unchanged on cancel", async () => {
    const onChange = vi.fn();
    const { container } = await renderPicker({
      selectedProjects: ["/workspace/missing"],
      onChange,
    });
    const missing = container.querySelector<HTMLInputElement>('input[value="/workspace/missing"]') as HTMLInputElement;

    missing.focus();
    await act(async () => { missing.click(); });

    expect(onChange).not.toHaveBeenCalled();
    expect(missing.checked).toBe(true);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("This project is no longer present in the current data.");
    const cancel = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Cancel");
    await act(async () => { (cancel as HTMLButtonElement).click(); });

    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(missing.checked).toBe(true);
    expect(document.activeElement).toBe(missing);
  });

  it("opens confirmation when Space deselects an unavailable project", async () => {
    const onChange = vi.fn();
    const { container } = await renderPicker({
      selectedProjects: ["/workspace/missing"],
      onChange,
    });
    const missing = container.querySelector<HTMLInputElement>('input[value="/workspace/missing"]') as HTMLInputElement;
    missing.focus();

    await act(async () => {
      missing.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: " " }));
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(missing.checked).toBe(true);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("removes an unavailable project after confirmation", async () => {
    const onChange = vi.fn();
    const { container } = await renderPicker({
      selectedProjects: ["/workspace/missing", "/workspace/active"],
      onChange,
    });
    const missing = container.querySelector<HTMLInputElement>('input[value="/workspace/missing"]') as HTMLInputElement;

    missing.focus();
    await act(async () => { missing.click(); });
    const confirm = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Remove");
    await act(async () => { (confirm as HTMLButtonElement).click(); });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(["/workspace/active"]);
    expect(document.activeElement).toBe(missing);
  });

  it("keeps same projects independent across picker instances", async () => {
    const firstChange = vi.fn();
    const secondChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push(root);
    await act(async () => {
      root.render(createElement(
        I18nextProvider,
        { i18n },
        createElement("div", null,
          createElement(ControlledPicker, {
            availableProjects: ["/workspace/shared"],
            initialSelectedProjects: [],
            onChange: firstChange,
            ariaLabel: "First projects",
          }),
          createElement(ControlledPicker, {
            availableProjects: ["/workspace/shared"],
            initialSelectedProjects: ["/workspace/shared"],
            onChange: secondChange,
            ariaLabel: "Second projects",
          }),
        ),
      ));
    });
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');

    await act(async () => { inputs[0].click(); });

    expect(firstChange).toHaveBeenCalledWith(["/workspace/shared"]);
    expect(secondChange).not.toHaveBeenCalled();
    expect(inputs[0].checked).toBe(true);
    expect(inputs[1].checked).toBe(true);
  });

  it("keeps checkbox IDs unique across picker instances", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push(root);
    await act(async () => {
      root.render(createElement(
        I18nextProvider,
        { i18n },
        createElement("div", null,
          createElement(ProjectGroupPicker, {
            availableProjects: ["/workspace/one"],
            selectedProjects: [],
            onChange: vi.fn(),
            ariaLabel: "First projects",
          }),
          createElement(ProjectGroupPicker, {
            availableProjects: ["/workspace/two"],
            selectedProjects: [],
            onChange: vi.fn(),
            ariaLabel: "Second projects",
          }),
        ),
      ));
    });
    const ids = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'), input => input.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
