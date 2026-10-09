// Tests date boundaries, session filtering, and usage aggregation helpers.
import { describe, it, expect } from "vitest";
import { endOfLocalDay, filterSessions, formatLocalDate, startOfLocalDay, sumCost, costBySource, byProject, byProjectSelection, isProjectGroupKey, projectSelectionLabel, byModel, byProvider, tokenTotals, topSessions, byGroup, usageByBillingType } from "./aggregate";
import { buildProjectFilterOptions, resolveProjectSelection } from "./projectFilters";
import type { SessionRecord } from "../types";

const S = (o: Partial<SessionRecord>): SessionRecord => ({
  id: "s", project: "C:/git/a", title: "t", date: 1700000000000, cost: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  isSubagent: false, parentId: null, source: "stored", models: [], ...o,
});

describe("filterSessions", () => {
  it("rejette les dates locales invalides ou impossibles", () => {
    for (const value of ["2026-02-30", "2026-13-01", "2026-1-01", "not-a-date"]) {
      expect(startOfLocalDay(value)).toBeUndefined();
      expect(endOfLocalDay(value)).toBeUndefined();
    }
  });

  it("ne formate pas une valeur temporelle non finie", () => {
    expect(formatLocalDate(Number.NaN)).toBe("");
    expect(formatLocalDate(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("inclut toute la journée de fin mais exclut le lendemain", () => {
    const end = endOfLocalDay("2026-01-07");
    expect(end).toBeDefined();
    if (end === undefined) return;
    const data = [
      S({ id: "end", date: end }),
      S({ id: "next", date: end + 1 }),
    ];

    expect(filterSessions(data, { from: startOfLocalDay("2026-01-01"), to: end }).map(s => s.id)).toEqual(["end"]);
  });

  it("filtre par un projet", () => {
    const data = [S({ id: "1", project: "C:/git/a" }), S({ id: "2", project: "C:/git/b" })];
    expect(filterSessions(data, { projects: ["C:/git/a"] }).map(s => s.id)).toEqual(["1"]);
  });
  it("filtre par plusieurs projets (union)", () => {
    const data = [S({ id: "1", project: "C:/git/a" }), S({ id: "2", project: "C:/git/b" }), S({ id: "3", project: "C:/git/c" })];
    expect(filterSessions(data, { projects: ["C:/git/a", "C:/git/b"] }).map(s => s.id)).toEqual(["1", "2"]);
  });
  it("conserve les chemins complets pour distinguer des projets homonymes", () => {
    const data = [
      S({ id: "one", project: "/clients/one/app" }),
      S({ id: "two", project: "/clients/two/app" }),
    ];

    expect(filterSessions(data, { projects: ["/clients/one/app"] }).map(s => s.project)).toEqual(["/clients/one/app"]);
  });
  it("filtre vide = rien afficher", () => {
    const data = [S({ id: "1", project: "C:/git/a" }), S({ id: "2", project: "C:/git/b" })];
    expect(filterSessions(data, { projects: [] }).map(s => s.id)).toEqual([]);
  });
  it("filtre undefined = tout afficher", () => {
    const data = [S({ id: "1", project: "C:/git/a" }), S({ id: "2", project: "C:/git/b" })];
    expect(filterSessions(data, {}).map(s => s.id)).toEqual(["1", "2"]);
  });
  it("ne double pas les sessions quand un groupe et un de ses projets sont sélectionnés", () => {
    const data = [
      S({ id: "a", project: "/work/a", cost: 10 }),
      S({ id: "b", project: "/work/b", cost: 7 }),
      S({ id: "c", project: "/work/c", cost: 3 }),
    ];
    const options = buildProjectFilterOptions(
      data.map(session => session.project),
      [{ name: "Clients", projects: ["/work/a", "/work/b"] }],
      { groupAriaLabel: name => `Group ${name}` },
    );
    const projects = resolveProjectSelection([options.groups[0].value, "/work/a"], options);
    const filtered = filterSessions(data, { projects });

    expect(filtered.map(session => session.id)).toEqual(["a", "b"]);
    expect(sumCost(filtered)).toBe(17);
  });
  it("filtre par plage de dates", () => {
    const data = [S({ id: "1", date: 1000 }), S({ id: "2", date: 5000 })];
    expect(filterSessions(data, { from: 2000, to: 4000 }).map(s => s.id)).toEqual([]);
    expect(filterSessions(data, { from: 0, to: 4000 }).map(s => s.id)).toEqual(["1"]);
  });

  it("applique une borne epoch 0 aux sessions avant et après cette borne", () => {
    const data = [
      S({ id: "before", date: -1 }),
      S({ id: "epoch", date: 0 }),
      S({ id: "after", date: 1 }),
    ];

    expect(filterSessions(data, { from: 0 }).map(s => s.id)).toEqual(["epoch", "after"]);
  });
});

describe("agrégations", () => {
  const data = [
    S({ id: "1", project: "C:/git/a", cost: 10, models: [{ provider: "p", model: "m1", cost: 10, source: "configured", tokens: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 } }] }),
    S({ id: "2", project: "C:/git/a", cost: 5, models: [{ provider: "p", model: "m2", cost: 5, source: "configured", tokens: { input: 0, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0 } }] }),
    S({ id: "3", project: "C:/git/b", cost: 7, models: [{ provider: "q", model: "m1", cost: 7, source: "stored", tokens: { input: 0, output: 0, cacheRead: 3, cacheWrite: 0, reasoning: 0 } }] }),
  ];
  it("sumCost", () => expect(sumCost(data)).toBeCloseTo(22));
  it("répartit les coûts par source, modèle par modèle pour une session mixte", () => {
    const mixed = S({
      id: "mixed", cost: 7,
      models: [
        { provider: "p", model: "configured-model", cost: 2.5, source: "configured", tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 } },
        { provider: "q", model: "stored-model", cost: 4.5, source: "stored", tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 } },
      ],
    });
    expect(costBySource([mixed])).toEqual({ configured: 2.5, stored: 4.5 });
  });
  it("utilise la source de session quand aucun modèle n'est disponible", () => {
    expect(costBySource([S({ cost: 3, source: "configured", models: [] })])).toEqual({ configured: 3, stored: 0 });
    expect(costBySource([S({ cost: 4, source: "stored", models: [] })])).toEqual({ configured: 0, stored: 4 });
  });
  it("conserve les coûts nuls et la conservation du total", () => {
    const result = costBySource([
      S({ cost: 0, source: "stored", models: [{ provider: "p", model: "m", cost: 0, source: "stored", tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 } }] }),
      S({ cost: 1.25, source: "configured", models: [] }),
    ]);
    expect(result).toEqual({ configured: 1.25, stored: 0 });
    expect(result.configured + result.stored).toBeCloseTo(sumCost([
      S({ cost: 0 }),
      S({ cost: 1.25 }),
    ]));
  });
  it("byProject", () => {
    const r = byProject(data);
    expect(r.find(x => x.key === "C:/git/a")!.value).toBeCloseTo(15);
    expect(r.find(x => x.key === "C:/git/b")!.value).toBeCloseTo(7);
  });
  it("byProjectSelection regroupe les membres sous le groupe actif", () => {
    const sessions = [
      S({ id: "a", project: "A", cost: 10 }),
      S({ id: "b", project: "B", cost: 7 }),
      S({ id: "c", project: "C", cost: 3 }),
    ];

    expect(byProjectSelection(sessions, { name: "Clients", projects: ["A", "B"] }).map(row => ({ ...row, key: projectSelectionLabel(row.key) }))).toEqual([
      { key: "Clients", value: 17 },
      { key: "C", value: 3 },
    ]);
  });
  it("ne double pas une session sélectionnée par le groupe et son membre", () => {
    const sessions = [
      S({ id: "a", project: "A", cost: 10 }),
      S({ id: "b", project: "B", cost: 7 }),
      S({ id: "c", project: "C", cost: 3 }),
    ];
    const selected = filterSessions(sessions, { projects: ["A", "B"] });

    expect(sumCost(selected)).toBe(17);
    expect(byProjectSelection(selected, { name: "Clients", projects: ["A", "B"] }).map(row => ({ ...row, key: projectSelectionLabel(row.key) }))).toEqual([
      { key: "Clients", value: 17 },
    ]);
  });
  it("sans groupe actif retourne exactement byProject", () => {
    expect(byProjectSelection(data)).toEqual(byProject(data));
  });
  it("conserve les projets hors groupe quand le groupe n'a aucune session membre", () => {
    const sessions = [S({ id: "c", project: "C", cost: 3 })];

    expect(byProjectSelection(sessions, { name: "Clients", projects: ["A", "B"] }).map(row => ({ ...row, key: projectSelectionLabel(row.key) }))).toEqual([
      { key: "C", value: 3 },
      { key: "Clients", value: 0 },
    ]);
  });
  it("sépare la clé interne du groupe d'un projet portant le même nom", () => {
    const rows = byProjectSelection([
      S({ id: "member", project: "A", cost: 10 }),
      S({ id: "project", project: "Clients", cost: 5 }),
    ], { name: "Clients", projects: ["A"] });
    const groupRows = rows.filter(row => isProjectGroupKey(row.key));
    const projectRows = rows.filter(row => !isProjectGroupKey(row.key));

    expect(groupRows).toHaveLength(1);
    expect(groupRows[0].key).not.toBe("Clients");
    expect(groupRows[0].value).toBe(10);
    expect(projectRows).toEqual([{ key: "Clients", value: 5 }]);
    expect(projectSelectionLabel(groupRows[0].key)).toBe("Clients");
  });
  it("byModel", () => {
    const r = byModel(data);
    expect(r.find(x => x.key === "m1")!.value).toBeCloseTo(17); // 10 + 7
  });
  it("byProvider", () => {
    const r = byProvider(data);
    expect(r.find(x => x.key === "p")!.value).toBeCloseTo(15);
  });
  it("byProvider : session multi-provider ne double pas le coût", () => {
    const mixed = S({
      id: "mix", cost: 2.75,
      models: [
        { provider: "llmproxy", model: "claude", cost: 2.75, source: "configured", tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 } },
        { provider: "openrama", model: "qwen", cost: 0, source: "stored", tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 } },
      ],
    });
    const r = byProvider([mixed]);
    expect(r.find(x => x.key === "llmproxy")!.value).toBeCloseTo(2.75);
    expect(r.find(x => x.key === "openrama")!.value).toBeCloseTo(0);
  });
  it("byModel : session multi-provider ne double pas le coût", () => {
    const mixed = S({
      id: "mix2", cost: 2.75,
      models: [
        { provider: "llmproxy", model: "claude", cost: 2.75, source: "configured", tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 } },
        { provider: "openrama", model: "qwen", cost: 0, source: "stored", tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 } },
      ],
    });
    const r = byModel([mixed]);
    expect(r.find(x => x.key === "claude")!.value).toBeCloseTo(2.75);
    expect(r.find(x => x.key === "qwen")!.value).toBeCloseTo(0);
  });
  it("tokenTotals", () => {
    const t = tokenTotals(data);
    expect(t.input).toBe(1); expect(t.output).toBe(2); expect(t.cacheRead).toBe(3);
  });
  it("topSessions", () => {
    const r = topSessions(data, 2);
    expect(r.map(s => s.id)).toEqual(["1", "3"]); // descending cost order
  });
  it("byGroup (dossier parent)", () => {
    const r = byGroup(data, []);
    // C:/git/a -> parent C:/git; C:/git/b -> parent C:/git
    expect(r.find(x => x.key === "C:/git")!.value).toBeCloseTo(22);
  });

  it("byGroup ne fusionne pas deux projets distincts ayant le même nom court", () => {
    const projects = [
      S({ id: "one", project: "/clients/one/app", cost: 3 }),
      S({ id: "two", project: "/clients/two/app", cost: 5 }),
    ];

    expect(byGroup(projects, [])).toEqual([
      { key: "/clients/two", value: 5 },
      { key: "/clients/one", value: 3 },
    ]);
    expect(byGroup(projects, [{ name: "One app", projects: ["/clients/one/app"] }])).toEqual([
      { key: "/clients/two", value: 5 },
      { key: "One app", value: 3 },
    ]);
  });

  it("agrège l'utilisation gratuite", () => {
    const result = usageByBillingType([S({ models: [{ provider: "p", model: "free", cost: 0, source: "stored", tokens: { input: 10, output: 2, cacheRead: 3, cacheWrite: 4, reasoning: 1 } }] })]);
    expect(result).toEqual({ freeTokens: 20, paidTokens: 0, freeSessions: 1, paidSessions: 0 });
  });

  it("agrège l'utilisation payante", () => {
    const result = usageByBillingType([S({ models: [{ provider: "p", model: "paid", cost: 1, source: "configured", tokens: { input: 10, output: 2, cacheRead: 3, cacheWrite: 4, reasoning: 1 } }] })]);
    expect(result).toEqual({ freeTokens: 0, paidTokens: 20, freeSessions: 0, paidSessions: 1 });
  });

  it("compte une session mixte une fois par catégorie", () => {
    const result = usageByBillingType([S({ models: [
      { provider: "p", model: "free", cost: 0, source: "stored", tokens: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 } },
      { provider: "q", model: "paid", cost: 2, source: "configured", tokens: { input: 0, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0 } },
    ] })]);
    expect(result).toEqual({ freeTokens: 10, paidTokens: 5, freeSessions: 1, paidSessions: 1 });
  });

  it("ignore les usages sans tokens et les données vides", () => {
    const empty = usageByBillingType([]);
    const zero = usageByBillingType([S({ models: [{ provider: "p", model: "empty", cost: 0, source: "stored", tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 } }] })]);
    expect(empty).toEqual({ freeTokens: 0, paidTokens: 0, freeSessions: 0, paidSessions: 0 });
    expect(zero).toEqual(empty);
  });
});
