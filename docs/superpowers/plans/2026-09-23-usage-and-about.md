# Usage And About Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show free-model usage despite zero cost, add an accessible provider legend, and add an About modal.

**Architecture:** Add a pure billing-usage aggregation helper, render it in a dedicated donut, preserve provider cost aggregation while adding an HTML legend, and implement About as an accessible modal matching existing modal behavior.

**Tech Stack:** React, TypeScript, Recharts, Vitest, existing i18n and modal styles.

---

### Task 1: Billing Usage Aggregation

**Files:**
- Modify: `src/lib/aggregate.ts`
- Modify: `src/lib/aggregate.test.ts`
- Modify: `src/types.ts` only if a shared aggregate type is needed

- [ ] Add `BillingUsage` with `freeTokens`, `paidTokens`, `freeSessions`, and `paidSessions`.
- [ ] Add `usageByBillingType(data)`; sum all token fields for each model usage, classify only positive-token usages, count a session once per category, and keep zero-cost usages in `freeTokens`.
- [ ] Test free-only, paid-only, mixed sessions, zero-token usages, zero-cost sessions, and percentage-safe empty results.
- [ ] Run `npm test -- src/lib/aggregate.test.ts` and `git diff --check`.

### Task 2: Charts And Dashboard Integration

**Files:**
- Create: `src/components/charts/UsageByBilling.tsx`
- Modify: `src/components/charts/CostByProvider.tsx`
- Modify: `src/App.tsx`
- Modify: `src/index.css` if responsive legend styles are needed
- Modify: translation resources under `src/i18n/`

- [ ] Render `UsageByBilling` as an accessible two-slice donut using tokens as values and a visible legend with tokens, sessions, and percentages.
- [ ] Add the chart to the dashboard grid without removing existing charts.
- [ ] Add an accessible HTML legend to `CostByProvider`, preserving all providers represented by model usages even when cost is `0`.
- [ ] Add translated titles, labels, tooltip text, and empty-state text in the existing locales.
- [ ] Test pure helpers and build the frontend.

### Task 3: About Modal

**Files:**
- Create: `src/components/AboutModal.tsx`
- Modify: `src/components/Header.tsx`
- Modify: `src/App.tsx`
- Modify: `src/index.css` if needed
- Modify: translation resources under `src/i18n/`

- [ ] Add an accessible Header button next to Rates and Settings.
- [ ] Implement the modal with Thomas Blion, `https://github.com/tblion`, and `https://thomasblion.com`.
- [ ] Preserve focus, keyboard Escape, restoration, and external link semantics.
- [ ] Validate the modal through the browser mock scenario.

### Task 4: Verification And Delivery

**Files:**
- No additional implementation files.

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `cd src-tauri && cargo test`.
- [ ] Run `git diff --check` and inspect status/diff.
- [ ] Commit with `feat: show free usage and add about dialog`.
- [ ] Push the current branch to `origin`.
