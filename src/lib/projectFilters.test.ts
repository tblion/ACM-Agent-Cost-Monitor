// Tests project filter options, group selections, and reconciliation.
import { describe, expect, it } from "vitest";
import type { CustomGroup } from "../types";
import {
  buildProjectFilterOptions,
  resolveProjectSelection,
  selectProjectGroup,
  selectedGroupValue,
  reconcileProjectSelection,
} from "./projectFilters";

describe("project filter options", () => {
  const groups: CustomGroup[] = [
    { name: "Clients", projects: ["/work/a", "/work/b"] },
    { name: "Archive", projects: ["/work/old"] },
  ];
  const labels = { groupAriaLabel: (name: string) => `Group ${name}` };

  it("separates groups from sorted project options and keeps full paths", () => {
    const options = buildProjectFilterOptions(["/work/c", "/work/a"], groups, labels);

    expect(options.groups).toHaveLength(2);
    expect(options.groups[0]).toMatchObject({ kind: "group", label: "Clients" });
    expect(options.groups[0].value).toContain("project-group:0:Clients");
    expect(options.projects.map(option => option.value)).toEqual(["/work/a", "/work/c"]);
    expect(options.projects[0]).toMatchObject({ kind: "project", label: "a", value: "/work/a" });
    expect(options.groups.every(option => option.value !== option.label)).toBe(true);
  });

  it("does not select groups by default", () => {
    const options = buildProjectFilterOptions(["/work/a", "/work/c"], groups, labels);

    expect(options.projects.every(option => option.kind === "project")).toBe(true);
    expect(selectedGroupValue(options.projects.map(option => option.value), options)).toBeUndefined();
    expect(selectedGroupValue([options.groups[0].value], options)).toBe(options.groups[0].value);
  });

  it("resolves a group and its selected member once", () => {
    const options = buildProjectFilterOptions(["/work/a", "/work/c"], groups, labels);
    const selected = [options.groups[0].value, "/work/a"];

    expect(resolveProjectSelection(selected, options)).toEqual(["/work/a", "/work/b"]);
  });

  it("resolves members that are not in the current session projects", () => {
    const options = buildProjectFilterOptions(["/work/c"], groups, labels);

    expect(resolveProjectSelection([options.groups[0].value], options)).toEqual(["/work/a", "/work/b"]);
  });

  it("ignores stale runtime group values", () => {
    const options = buildProjectFilterOptions(["/work/c"], groups, labels);

    expect(resolveProjectSelection(["\u0000project-group:9:Removed", "/work/c"], options)).toEqual(["/work/c"]);
  });

  it("replaces the selected group while preserving project selections", () => {
    const options = buildProjectFilterOptions(["/work/a", "/work/c"], groups, labels);
    const firstSelection = [options.groups[0].value, "/work/c"];

    expect(selectProjectGroup(firstSelection, options.groups[1].value, options)).toEqual([
      "/work/c",
      options.groups[1].value,
    ]);
  });

  it("replaces group members while preserving projects outside the group", () => {
    const options = buildProjectFilterOptions(["/work/a", "/work/b", "/work/c"], [
      { name: "Only A", projects: ["/work/a"] },
    ], labels);

    expect(selectProjectGroup(
      options.projects.map(option => option.value),
      options.groups[0].value,
      options,
    )).toEqual(["/work/b", "/work/c", options.groups[0].value]);
  });

  it("reconciles renamed and reordered groups and removes stale projects", () => {
    const previous = buildProjectFilterOptions(["/work/a", "/work/b", "/work/removed"], [
      { name: "Clients", projects: ["/work/a"] },
      { name: "Other", projects: ["/work/b"] },
    ], labels);
    const next = buildProjectFilterOptions(["/work/a", "/work/b"], [
      { name: "Other", projects: ["/work/b"] },
      { name: "Renamed Clients", projects: ["/work/a"] },
    ], labels);

    expect(reconcileProjectSelection([
      previous.groups[0].value,
      "/work/removed",
      "/work/b",
    ], previous, next)).toEqual([next.groups[1].value, "/work/b"]);
  });

  it("drops a deleted group runtime value", () => {
    const previous = buildProjectFilterOptions(["/work/a"], [{ name: "Clients", projects: ["/work/a"] }], labels);
    const next = buildProjectFilterOptions(["/work/a"], [], labels);

    expect(reconcileProjectSelection([previous.groups[0].value], previous, next)).toEqual([]);
  });
});
