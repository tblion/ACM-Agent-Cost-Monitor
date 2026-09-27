import type { CustomGroup } from "../types";
import { displayName, sortDisplayValues } from "./sorting";

export type ProjectFilterOption = {
  value: string;
  label: string;
  kind: "project" | "group";
  ariaLabel: string;
  members?: string[];
};

export type ProjectFilterOptions = {
  groups: ProjectFilterOption[];
  projects: ProjectFilterOption[];
};

export type ProjectFilterLabels = {
  groupAriaLabel: (name: string) => string;
};

function groupValue(index: number, name: string): string {
  return `\u0000project-group:${index}:${name}`;
}

export function buildProjectFilterOptions(projects: string[], groups: CustomGroup[], labels: ProjectFilterLabels): ProjectFilterOptions {
  return {
    groups: groups.map((group, index) => {
      const members = [...new Set(group.projects)];
      return {
        value: groupValue(index, group.name),
        label: group.name,
        kind: "group",
        ariaLabel: labels.groupAriaLabel(group.name),
        members,
      };
    }),
    projects: sortDisplayValues([...new Set(projects)]).map(value => ({
      value,
      label: displayName(value),
      kind: "project",
      ariaLabel: displayName(value),
    })),
  };
}

export function resolveProjectSelection(selected: string[], options: ProjectFilterOptions): string[] {
  const groupsByValue = new Map(options.groups.map(option => [option.value, option]));
  const projects = new Set<string>();

  for (const value of selected) {
    const group = groupsByValue.get(value);
    if (group) {
      for (const member of group.members ?? []) projects.add(member);
    } else if (value.startsWith("\u0000project-group:")) {
      continue;
    } else {
      projects.add(value);
    }
  }

  return [...projects];
}

export function selectedGroupValue(selected: string[], options: ProjectFilterOptions): string | undefined {
  const groupValues = new Set(options.groups.map(option => option.value));
  return selected.find(value => groupValues.has(value));
}

export function selectProjectGroup(selected: string[], groupValueToSelect: string, options: ProjectFilterOptions): string[] {
  const groupPrefix = "\u0000project-group:";
  const group = options.groups.find(option => option.value === groupValueToSelect);
  const members = new Set(group?.members ?? []);
  return [
    ...selected.filter(value => !value.startsWith(groupPrefix) && !members.has(value)),
    groupValueToSelect,
  ];
}

function sameMembers(left: ProjectFilterOption, right: ProjectFilterOption): boolean {
  if ((left.members?.length ?? 0) !== (right.members?.length ?? 0)) return false;
  const rightMembers = new Set(right.members ?? []);
  return (left.members ?? []).every(member => rightMembers.has(member));
}

export function reconcileProjectSelection(
  selected: string[],
  previous: ProjectFilterOptions,
  next: ProjectFilterOptions,
): string[] {
  const previousGroups = new Map(previous.groups.map(option => [option.value, option]));
  const nextGroups = next.groups;
  const nextProjectValues = new Set(next.projects.map(option => option.value));
  const result: string[] = [];

  for (const value of selected) {
    const oldGroup = previousGroups.get(value);
    if (oldGroup) {
      const replacement = nextGroups.find(option => sameMembers(oldGroup, option))
        ?? nextGroups.find(option => option.value === value);
      if (replacement && !result.includes(replacement.value)) result.push(replacement.value);
      continue;
    }
    if (value.startsWith("\u0000project-group:")) continue;
    if (nextProjectValues.has(value) && !result.includes(value)) result.push(value);
  }

  return result;
}
