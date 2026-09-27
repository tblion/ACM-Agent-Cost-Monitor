# Project Groups As Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose saved custom groups as distinct, visually marked Project-filter options that aggregate member projects without double-counting sessions.

**Architecture:** Keep `CustomGroup` persistence unchanged. Add a small runtime project-filter model with typed options for individual projects and virtual groups, extend `MultiSelect` to render a top group section and a lower project section, and normalize virtual selections to a deduplicated set of real project paths before filtering. Pass the active group to the project chart so member sessions are displayed under the group name while unrelated selected projects remain individual rows.

**Tech Stack:** React 19, TypeScript strict, Vitest, Recharts, existing i18next resources and CSS custom properties.

---

### Task 1: Add the runtime project-filter model and selection resolution

**Files:**
- Create: `src/lib/projectFilters.ts`
- Test: `src/lib/projectFilters.test.ts`
- Modify: `src/lib/aggregate.ts`
- Test: `src/lib/aggregate.test.ts`

- [ ] **Step 1: Write failing tests for virtual options and resolution**

Add tests covering the public helpers below:

```ts
const groups = [{ name: "Clients", projects: ["/work/a", "/work/b"] }];
const options = buildProjectFilterOptions(["/work/a", "/work/c"], groups);

expect(options.groups[0]).toMatchObject({ kind: "group", label: "Clients" });
expect(options.projects.map(option => option.value)).toEqual(["/work/a", "/work/c"]);

expect(resolveProjectSelection(
  [options.groups[0].value, "/work/a"],
  options,
)).toEqual(["/work/a", "/work/b"]);
```

Also test that:

- group options are returned separately from project options;
- groups are not selected by default while all individual projects are selected by the caller;
- a group plus one of its members resolves to each real project once;
- a group with no current session projects still resolves its configured members;
- selecting a second group replaces the first group selection through `selectProjectGroup`;
- a project path remains the filter value, while a group receives a reserved runtime value;
- display labels use the existing short-name sorting convention without changing stored paths.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --run src/lib/projectFilters.test.ts`

Expected: FAIL because `src/lib/projectFilters.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal project-filter helpers**

Define types and helpers in `src/lib/projectFilters.ts`:

```ts
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

export function buildProjectFilterOptions(projects: string[], groups: CustomGroup[]): ProjectFilterOptions;
export function resolveProjectSelection(selected: string[], options: ProjectFilterOptions): string[];
export function selectedGroupValue(selected: string[], options: ProjectFilterOptions): string | undefined;
export function selectProjectGroup(selected: string[], groupValue: string): string[];
```

Use a reserved, non-persisted group value containing the group index and name. Keep the complete project path in project option values and use `sortDisplayValues` for individual projects. Deduplicate all returned member paths with `Set`. `selectProjectGroup` must remove every other group value while preserving selected individual project values.

In `aggregate.ts`, add a helper that accepts resolved project paths and use it from `filterSessions` without changing the existing semantics for `undefined` and `[]`:

```ts
export function filterSessions(data: SessionRecord[], f: Filters): SessionRecord[] {
  // `f.projects` contains real project paths after App resolves virtual options.
}
```

Keep the persisted `CustomGroup` and public `Filters` shape compatible; virtual group values exist only in React state and are resolved before `filterSessions` is called.

- [ ] **Step 4: Add aggregate regression tests**

Extend `src/lib/aggregate.test.ts` with a session set containing projects A, B, and C. Assert that the resolved selection for group `A+B` plus individual `A` filters sessions A and B once, and that the sum is `cost(A) + cost(B)`, not `cost(A) * 2 + cost(B)`.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- --run src/lib/projectFilters.test.ts src/lib/aggregate.test.ts`

Expected: all focused tests pass.

---

### Task 2: Extend MultiSelect with grouped options and accessible visual distinction

**Files:**
- Modify: `src/components/MultiSelect.tsx`
- Modify: `src/index.css`
- Modify: `src/i18n/resources.ts`
- Test: `src/components/MultiSelect.test.ts`

- [ ] **Step 1: Write failing component tests**

Add tests for a Project-filter configuration using `groups`, `projects`, and `selected` values. Assert:

- group section is rendered before the project section;
- section headings are exposed to assistive technology;
- group rows render `◆`, group styling, and an accessible label containing `Groupe`/`Group`;
- groups start unchecked when only project values are selected;
- `Tout sélectionner` selects only project values and never group values;
- `Effacer` clears project and group selections;
- selecting one group calls `onChange` with that group plus existing project selections;
- selecting a second group removes the first group value;
- keyboard Enter/Space follows the same rules;
- existing model/provider string-only usage behaves exactly as before.

- [ ] **Step 2: Run the focused tests and verify the new tests fail**

Run: `npm test -- --run src/components/MultiSelect.test.ts`

Expected: the new grouped-option assertions fail because the component currently renders one flat string list.

- [ ] **Step 3: Implement grouped option rendering**

Add an optional grouped configuration to `MultiSelect` while preserving the existing simple `options: string[]` API for model/provider filters. The grouped configuration must provide:

```ts
type OptionSection = {
  title: string;
  options: ProjectFilterOption[];
  selectableForAll: boolean;
};
```

Render the group section first, followed by the project section. Keep one listbox and one keyboard index sequence so ArrowUp/ArrowDown/Home/End work across both sections. Use `option.ariaLabel` for each option’s accessible name, `option.label` for normal text, and `option.kind` to apply the group class and `◆` marker.

Implement `toggleAll` against only options where `selectableForAll` is true. Keep `onChange([])` for `Effacer`, so it clears groups as well as projects. When a group option is toggled on, remove every other group option from the selected values before invoking `onChange`; toggling a project remains additive/removable and does not alter the active group.

Ensure the visible group color is supplied by CSS variables with separate light/dark values and is supplemented by the icon and accessible label. Do not use color as the only distinction.

- [ ] **Step 4: Add responsive and accessibility styles**

Add classes for the group section, project section, group option, section heading, and marker in `src/index.css`. Use theme variables, sufficient contrast, `min-width: 0`, wrapping/ellipsis behavior for long names, and existing menu overflow constraints. Keep the group heading and separator visible on narrow windows.

- [ ] **Step 5: Run component tests**

Run: `npm test -- --run src/components/MultiSelect.test.ts`

Expected: all existing and new MultiSelect tests pass.

---

### Task 3: Integrate groups into App, FilterBar, and filter state

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/FilterBar.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/FilterBar.test.tsx` if present, otherwise create it

- [ ] **Step 1: Add failing integration tests**

Cover the complete data flow:

```ts
const settings = {
  ...baseSettings,
  customGroups: [{ name: "Clients", projects: ["/work/a", "/work/b"] }],
};
```

Assert that:

- `FilterBar` receives both current project paths and saved groups;
- the group appears before individual projects;
- group selection resolves to A and B in the filtered session data;
- group plus A still yields only A and B once;
- a second group selection replaces the first;
- no custom groups preserves the current filter behavior;
- group selection remains unchecked on initial render while project options are selected.

- [ ] **Step 2: Run the integration tests and verify failure**

Run: `npm test -- --run src/App.test.tsx src/components/FilterBar.test.tsx`

Expected: FAIL because App currently passes only a flat `string[]` project list and calls `filterSessions` with virtual values unsupported by the current flow.

- [ ] **Step 3: Build project options in App**

Derive the current project paths with the existing sorted project logic, build `ProjectFilterOptions` from those paths and `settings.customGroups`, and keep the complete options in a `useMemo` keyed by projects and groups. Track project filter values separately from model/provider filters so the initial project selection contains all real projects and no group values.

Before calling `filterSessions`, resolve the selected project options with `resolveProjectSelection`. Preserve `undefined` when all individual projects are selected and no group is selected only if that maintains the existing “all projects” behavior; otherwise pass the complete resolved path set. Never pass a group runtime value to `filterSessions`.

Pass the active group option to the project chart for display aggregation.

- [ ] **Step 4: Update FilterBar’s Project filter only**

Add project-group options and project options to the Project `MultiSelect` instance. Leave Model and Provider instances on the existing flat path. Update the Project `onChange` callback so the selected runtime values are retained, `Tout sélectionner` does not add groups, and `Effacer` produces an empty project selection.

- [ ] **Step 5: Run integration tests and typecheck**

Run: `npm test -- --run src/App.test.tsx src/components/FilterBar.test.tsx && npx tsc --noEmit`

Expected: all integration tests pass and TypeScript reports no errors.

---

### Task 4: Aggregate the selected group in CostByProject

**Files:**
- Modify: `src/lib/aggregate.ts`
- Test: `src/lib/aggregate.test.ts`
- Modify: `src/components/charts/CostByProject.tsx`
- Test: `src/components/charts/CostByProject.test.tsx` if present, otherwise create it
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing aggregation tests**

Add a helper test with sessions from A, B, and C:

```ts
expect(byProjectSelection(data, { name: "Clients", projects: ["A", "B"] })).toEqual([
  { key: "Clients", value: costA + costB },
  { key: "C", value: costC },
]);
```

Also assert that A and B are counted once even when the filtered input was selected using both the group and individual A, and that no active group returns the same result as `byProject`.

- [ ] **Step 2: Run the focused aggregation test and verify failure**

Run: `npm test -- --run src/lib/aggregate.test.ts src/components/charts/CostByProject.test.tsx`

Expected: FAIL because `byProjectSelection` and the chart group prop do not exist.

- [ ] **Step 3: Implement grouped project aggregation**

Add a pure aggregation helper that maps each session to the selected group name when its project is a member, otherwise to its real project key, then sums each session exactly once. Preserve the existing sorting and empty-data behavior. Update `CostByProject` to accept an optional active `CustomGroup` and use the helper only when one is active.

- [ ] **Step 4: Connect the active group from App**

Resolve the selected group from the project filter runtime values and pass it to `CostByProject` while keeping all other chart props and lazy-loading behavior unchanged.

- [ ] **Step 5: Run focused chart tests**

Run: `npm test -- --run src/lib/aggregate.test.ts src/components/charts/CostByProject.test.tsx`

Expected: all aggregation and chart tests pass.

---

### Task 5: Add translations, regression coverage, and final validation

**Files:**
- Modify: `src/i18n/resources.ts`
- Test: `src/i18n/resources.test.ts`
- Modify: relevant existing tests only if assertions need the new translated labels

- [ ] **Step 1: Add French and English filter translations**

Add translations for the group section heading, project section heading, accessible group label, and any explicit group marker text. Keep existing `filters.project`, `filters.selectAll`, and `filters.clear` translations unchanged.

- [ ] **Step 2: Test translation completeness**

Assert that both locales expose every new key and that the rendered accessible group name contains the locale-appropriate translated word for “Group”.

- [ ] **Step 3: Run the complete frontend test suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 4: Run the production build and static checks**

Run: `npm run build`

Expected: TypeScript and Vite build succeed with the existing code-splitting chunks and no new Vite warnings.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 5: Manually verify the acceptance scenarios**

Using the frontend mock or the Tauri UI, verify:

- saved groups are shown above projects;
- groups are unchecked initially;
- `Tout sélectionner` checks projects only;
- `Effacer` clears an active group and all projects;
- only one group can be active;
- selecting a group plus one member does not increase the total twice;
- the project chart shows the group name for member costs and individual rows for unrelated projects;
- a group with no current sessions remains visible and shows no cost;
- the group marker remains understandable in both light and dark themes and through assistive technology.

No commit is included in this plan because the repository instruction explicitly requires leaving changes uncommitted unless the user asks otherwise.
