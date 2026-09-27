# Contrast Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every UI text remains readable in light and dark themes, especially modal close controls, without changing layout or typography.

**Architecture:** Establish semantic text and control color tokens in `src/index.css`, then replace ambiguous inline text colors in the existing React components with those tokens. Keep chart/KPI accent colors, but provide theme-safe text colors for labels, statuses, badges, errors, and disabled controls.

**Tech Stack:** React, TypeScript, Vite, CSS custom properties, Vitest, Playwright/mock browser validation.

---

### Task 1: Establish semantic contrast tokens

**Files:**
- Modify: `src/index.css:2-10,20-22,39-44,61-73,89-95`
- Modify: `src/App.css:8-16,49-57,63-115`

- [ ] **Step 1: Add explicit semantic tokens to both themes**

Define `--text`, `--muted`, `--text-subtle`, `--control-text`, `--control-bg`, `--control-border`, and `--disabled-text` in `:root` and `:root.dark`. Keep the existing `--text` and `--muted` names compatible with current components, and make the light/dark values respectively dark-on-light and light-on-dark.

- [ ] **Step 2: Make shared controls inherit the theme text color**

Update shared `button`, `input`, and `select` rules so they use `color: var(--control-text)` and `background: var(--control-bg)` rather than the Vite starter colors from `App.css`. Keep component-specific borders and spacing unchanged.

- [ ] **Step 3: Add disabled-state contrast without using opacity as the only signal**

Use `:disabled` rules with `color: var(--disabled-text)`, `background: var(--control-bg)`, and a visible border. Retain cursor behavior and existing component opacity only where it does not make text unreadable.

- [ ] **Step 4: Run the frontend typecheck/build**

Run: `npm run build`

Expected: exit code 0 with a successful Vite build.

- [ ] **Step 5: Commit the token layer**

```bash
git add src/index.css src/App.css
git commit -m "fix: define theme-safe text colors"
```

### Task 2: Replace ambiguous text colors in core components

**Files:**
- Modify: `src/components/Header.tsx`
- Modify: `src/components/InfoTooltip.tsx`
- Modify: `src/components/KpiCards.tsx`
- Modify: `src/components/SessionTable.tsx`
- Modify: `src/components/MultiSelect.tsx`
- Modify: `src/components/FilterBar.tsx`

- [ ] **Step 1: Replace muted text used for primary interactive labels**

Use `var(--text)` for modal/header/action labels and `var(--muted)` only for secondary metadata. Ensure the header Rates, About, Settings, live control, table sort controls, and filter triggers remain visible in both themes.

- [ ] **Step 2: Preserve accent colors only for data meaning**

Keep KPI values and configured-rate badges colored, but use theme-safe text tokens for KPI labels/subtitles, table metadata, no-value placeholders, and multi-select explanatory text. Do not change chart series colors.

- [ ] **Step 3: Remove any hardcoded black/white text from these components**

Search these files for `#000`, `#fff`, `#ffffff`, `#0f0f0f`, and starter-theme colors. Replace only text/background declarations that can conflict with the active theme; leave icon/gradient accent declarations intact.

- [ ] **Step 4: Run component tests**

Run: `npm test -- --run`

Expected: all existing Vitest tests pass.

- [ ] **Step 5: Commit core component changes**

```bash
git add src/components/Header.tsx src/components/InfoTooltip.tsx src/components/KpiCards.tsx src/components/SessionTable.tsx src/components/MultiSelect.tsx src/components/FilterBar.tsx
git commit -m "fix: improve contrast in dashboard controls"
```

### Task 3: Fix popup, status, and form text colors

**Files:**
- Modify: `src/components/RatesModal.tsx`
- Modify: `src/components/SettingsModal.tsx`
- Modify: `src/components/AboutModal.tsx`
- Modify: `src/components/StatusBar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Fix the Rates popup close controls first**

Set both the `×` close button and the bottom Close button to use semantic control colors. The `×` must remain readable on `var(--panel)` while enabled and disabled. Keep `aria-label`, focus behavior, loading behavior, and modal layout unchanged.

- [ ] **Step 2: Fix settings/about modal controls and fields**

Replace inline muted or hardcoded text colors on labels, errors, inputs, selects, cancel/save buttons, and close controls with theme tokens. The primary save button may keep its accent background, but its foreground text must use a token or a verified high-contrast value for both themes.

- [ ] **Step 3: Fix status and application error messages**

Use a readable semantic status/error token instead of a fixed gray. Keep error semantics and existing layout unchanged.

- [ ] **Step 4: Search all frontend source for remaining risky color declarations**

Run:

```bash
rg -n '#(000|fff|ffffff|0f0f0f)|color:\s*["'"']?(black|white)|rgba\(255,255,255|rgba\(0,0,0' src
```

Review every match and either replace the text color with a semantic token or document why it is a non-text overlay, shadow, chart, or decorative accent.

- [ ] **Step 5: Run build and tests**

Run: `npm run build && npm test -- --run`

Expected: both commands exit 0.

- [ ] **Step 6: Commit popup and status fixes**

```bash
git add src/components/RatesModal.tsx src/components/SettingsModal.tsx src/components/AboutModal.tsx src/components/StatusBar.tsx src/App.tsx src/index.css
git commit -m "fix: make modal and status text theme safe"
```

### Task 4: Browser verification in both themes

**Files:**
- No source changes expected.

- [ ] **Step 1: Start the mock frontend**

Run: `npm run dev:mock`

Expected: Vite starts the mock application and prints a local URL.

- [ ] **Step 2: Verify the light theme**

Open the dashboard, Rates popup, Settings popup, and About popup. Confirm that all labels, close buttons, table headers, badges, loading/error messages, inputs, and disabled controls are readable on their actual backgrounds.

- [ ] **Step 3: Verify the dark theme**

Switch the theme to dark in Settings and repeat the same screens. Confirm there is no black/dark text on dark backgrounds or white/light text on light backgrounds.

- [ ] **Step 4: Verify responsive modal behavior is unchanged**

Check the Rates popup at desktop and narrow viewport widths. Confirm only colors changed and that the close controls remain reachable and visible.

- [ ] **Step 5: Record final status**

Run: `git status --short`

Expected: only intentional contrast-pass changes remain uncommitted, or the final contrast commits leave a clean worktree.
