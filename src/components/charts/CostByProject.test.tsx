// @vitest-environment happy-dom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "../../i18n/config";
import type { SessionRecord } from "../../types";
import { CostByProject } from "./CostByProject";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("recharts", () => ({
  BarChart: ({ data }: { data: Array<{ name: string; cost: number }> }) => createElement("div", { "data-testid": "bar-chart", "data-rows": JSON.stringify(data) }),
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => createElement("div", {}, children),
}));

const S = (o: Partial<SessionRecord>): SessionRecord => ({
  id: "s", project: "A", title: "t", date: 1700000000000, cost: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  isSubagent: false, parentId: null, source: "stored", models: [], ...o,
});

const mounted: Root[] = [];

async function renderChart(data: SessionRecord[], activeGroup?: { name: string; projects: string[] }): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(root);
  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n }, createElement(CostByProject, { data, activeGroup })));
  });
  return container;
}

beforeEach(async () => { await i18n.changeLanguage("fr"); });

afterEach(async () => {
  await act(async () => { for (const root of mounted.splice(0)) root.unmount(); });
  document.body.replaceChildren();
  await i18n.changeLanguage("en");
});

describe("CostByProject", () => {
  it("affiche un groupe vide avec un coût nul", async () => {
    const container = await renderChart([], { name: "Clients", projects: ["A"] });
    const rows = JSON.parse(container.querySelector("[data-testid=bar-chart]")?.getAttribute("data-rows") ?? "[]");

    expect(rows).toEqual([{ name: "Clients", cost: 0 }]);
    expect(container.textContent).not.toContain("Aucune donnée");
  });

  it("conserve le groupe vide dans les huit lignes avec neuf projets hors groupe", async () => {
    const data = Array.from({ length: 9 }, (_, index) => S({
      id: `project-${index + 1}`,
      project: `/work/project-${index + 1}`,
      cost: 9 - index,
    }));
    const container = await renderChart(data, { name: "Clients", projects: ["/work/member"] });
    const rows = JSON.parse(container.querySelector("[data-testid=bar-chart]")?.getAttribute("data-rows") ?? "[]");

    expect(rows).toHaveLength(8);
    expect(rows.map((row: { name: string }) => row.name)).toEqual([
      "project-1", "project-2", "project-3", "project-4", "project-5", "project-6", "project-7", "Clients",
    ]);
  });

  it("sépare un projet homonyme et conserve le séparateur du nom de groupe", async () => {
    const container = await renderChart([
      S({ id: "member", project: "A", cost: 10 }),
      S({ id: "project", project: "Clients", cost: 5 }),
    ], { name: "Clients/Team\\West", projects: ["A"] });
    const rows = JSON.parse(container.querySelector("[data-testid=bar-chart]")?.getAttribute("data-rows") ?? "[]");

    expect(rows).toEqual([
      { name: "Clients/Team\\West", cost: 10 },
      { name: "Clients", cost: 5 },
    ]);
  });
});
