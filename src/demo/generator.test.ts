// Verifies deterministic demo usage generation and derived values.
import { describe, expect, it } from "vitest";
import { DEMO_HISTORICAL_PRICING, DEMO_PRICING, DEMO_RATES } from "./catalog";
import {
  calculateDemoCost,
  createDemoAuditReport,
  dateSeed,
  generateDemoSnapshot,
  roundCurrency,
  sumTokens,
} from "./generator";
import { DEMO_AUDIT_REPORT } from "./audit-fixture";
import type { Tokens } from "../types";

const referenceDate = Date.UTC(2026, 8, 22, 18, 30);
const nextDay = referenceDate + 24 * 60 * 60 * 1000;
const pricingKeys = new Set(DEMO_PRICING.map(rate => `${rate.provider}\u0000${rate.model}`));
const historicalKeys = new Set(DEMO_HISTORICAL_PRICING.map(rate => `${rate.provider}\u0000${rate.model}`));
const keyFor = (provider: string, model: string) => `${provider}\u0000${model}`;

describe("demo generator", () => {
  it("reuses the centralized audit report fixture", () => {
    expect(createDemoAuditReport()).toBe(DEMO_AUDIT_REPORT);
  });

  it("exposes the exact provider catalog", () => {
    expect(DEMO_PRICING).toEqual([
      { provider: "Anthropic", model: "claude-sonnet-4-6", input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      { provider: "Anthropic", model: "claude-haiku-4-5", input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
      { provider: "OpenAI", model: "gpt-5.4", input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
      { provider: "OpenAI", model: "gpt-5.4-mini", input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
      { provider: "OpenAI", model: "gpt-4.1", input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
      { provider: "Mistral", model: "mistral-medium-3.5", input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 },
      { provider: "Mistral", model: "mistral-small-4", input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
      { provider: "Mistral", model: "codestral", input: 0.3, output: 0.9, cacheRead: 0.03, cacheWrite: 0 },
    ]);
    expect(DEMO_HISTORICAL_PRICING).toEqual([
      { provider: "Anthropic", model: "claude-3-5-sonnet-20241022", input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      { provider: "Anthropic", model: "claude-3-haiku-20240307", input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 },
      { provider: "OpenAI", model: "gpt-4o", input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
      { provider: "OpenAI", model: "gpt-4o-mini", input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
      { provider: "OpenAI", model: "o1-mini", input: 3, output: 12, cacheRead: 1.5, cacheWrite: 0 },
      { provider: "Mistral", model: "mistral-large-2", input: 2, output: 6, cacheRead: 0.2, cacheWrite: 0 },
      { provider: "Mistral", model: "ministral-8b-latest", input: 0.1, output: 0.1, cacheRead: 0.01, cacheWrite: 0 },
      { provider: "Mistral", model: "pixtral-large-latest", input: 2, output: 6, cacheRead: 0.2, cacheWrite: 0 },
    ]);
    expect(DEMO_HISTORICAL_PRICING.every(rate => ["Anthropic", "OpenAI", "Mistral"].includes(rate.provider))).toBe(true);
    expect([...historicalKeys].every(key => !pricingKeys.has(key))).toBe(true);
    expect(DEMO_RATES.some(rate => historicalKeys.has(keyFor(rate.provider, rate.model)))).toBe(false);
  });

  it("calculates all token components using per-million rates", () => {
    const tokens: Tokens = { input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6, reasoning: 1e6 };
    expect(calculateDemoCost(tokens, DEMO_PRICING[0])).toBe(37.05);
    expect(calculateDemoCost({ ...tokens, input: -1, output: Number.NaN }, DEMO_PRICING[0])).toBe(19.05);
    expect(sumTokens([tokens, { input: -1, output: Number.NaN, cacheRead: 3, cacheWrite: Number.POSITIVE_INFINITY, reasoning: 5 }])).toEqual({
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 1_000_003,
      cacheWrite: 1_000_000,
      reasoning: 1_000_005,
    });
    expect(roundCurrency(1.005)).toBe(1.01);
  });

  it("generates a deterministic, bounded and anonymized snapshot", () => {
    const snapshot = generateDemoSnapshot(referenceDate);
    const repeat = generateDemoSnapshot(referenceDate);
    const from = Date.UTC(2024, 8, 22);

    expect(snapshot.sessions.length).toBeGreaterThan(100);
    expect(snapshot.sessions).toEqual(repeat.sessions);
    expect(snapshot.sessions).not.toEqual(generateDemoSnapshot(nextDay).sessions);
    expect(dateSeed(referenceDate)).toBe(dateSeed(referenceDate - 6 * 60 * 60 * 1000));
    expect(dateSeed(referenceDate)).not.toBe(dateSeed(nextDay));
    expect(snapshot.sessions.every(session => session.date >= from && session.date <= referenceDate)).toBe(true);
    expect(snapshot.sessions.every(session => !/[\\/]Users[\\/]|[\\/]home[\\/]|[A-Za-z]:[\\/]|OpencodeCostsViewer/.test(session.project))).toBe(true);
    expect(snapshot.sessions.every(session => session.models.every(model => pricingKeys.has(`${model.provider}\u0000${model.model}`) || historicalKeys.has(`${model.provider}\u0000${model.model}`)))).toBe(true);
    const weekCount = 105;
    const allWeeks = new Set(Array.from({ length: weekCount }, (_, week) => week));
    const weekVolumes = new Map<number, number>();
    for (const session of snapshot.sessions) {
      const week = Math.floor((session.date - from) / (7 * 24 * 60 * 60 * 1000));
      weekVolumes.set(week, (weekVolumes.get(week) ?? 0) + 1);
    }
    const activeVolumes = [...weekVolumes.values()].filter(volume => volume > 0);
    expect([...allWeeks].some(week => !weekVolumes.has(week))).toBe(true);
    expect(new Set(activeVolumes).size).toBeGreaterThanOrEqual(2);
  });

  it("clamps the rolling start date to the last valid target-month day", () => {
    const leapReference = Date.UTC(2024, 1, 29, 18, 30);
    const leapFrom = Date.UTC(2022, 1, 28);
    const snapshot = generateDemoSnapshot(leapReference);
    const firstSession = snapshot.sessions.find(session => session.id === "demo-configured");

    expect(firstSession?.date).toBe(leapFrom + 2 * 24 * 60 * 60 * 1000);
    expect(snapshot.sessions.every(session => session.date >= leapFrom && session.date <= Date.UTC(2024, 1, 29))).toBe(true);
  });

  it("rejects non-finite and invalid reference dates explicitly", () => {
    const invalidDates = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e20];

    for (const invalidDate of invalidDates) {
      expect(() => dateSeed(invalidDate)).toThrow("referenceDate must be a finite valid timestamp");
      expect(() => generateDemoSnapshot(invalidDate)).toThrow("referenceDate must be a finite valid timestamp");
    }
  });

  it("covers provenance, zero cost and parent-child invariants", () => {
    const { sessions, rates, costSummary } = generateDemoSnapshot(referenceDate);
    const parent = sessions.find(session => sessions.some(child => child.parentId === session.id));
    const child = sessions.find(session => session.isSubagent && session.parentId !== null);

    expect(sessions.some(session => session.source === "configured")).toBe(true);
    expect(sessions.some(session => session.source === "stored")).toBe(true);
    const mixedSessions = sessions.filter(session => session.models.some(model => model.source === "configured") && session.models.some(model => model.source === "stored"));
    expect(mixedSessions.length).toBeGreaterThan(0);
    expect(mixedSessions.every(session => session.models.some(model => model.source === "configured" && pricingKeys.has(keyFor(model.provider, model.model))))).toBe(true);
    expect(mixedSessions.every(session => session.models.some(model => model.source === "stored" && historicalKeys.has(keyFor(model.provider, model.model))))).toBe(true);
    expect(sessions.every(session => session.models.every(model => model.source === "stored"
      ? historicalKeys.has(keyFor(model.provider, model.model))
      : pricingKeys.has(keyFor(model.provider, model.model))))).toBe(true);
    expect(sessions.filter(session => session.source === "configured").every(session => session.models.every(model => pricingKeys.has(`${model.provider}\u0000${model.model}`)))).toBe(true);
    expect(sessions.filter(session => session.source === "stored").every(session => session.models.filter(model => model.source === "stored").every(model => historicalKeys.has(`${model.provider}\u0000${model.model}`)))).toBe(true);
    expect(sessions.some(session => session.cost === 0 && session.tokens.input === 0)).toBe(true);
    expect(child?.parentId).toBe(parent?.id);
    expect(child?.isSubagent).toBe(true);
    expect(rates).toEqual(DEMO_RATES);
    expect(costSummary.every(summary => summary.storedCost > 0)).toBe(true);
    expect(costSummary.every(summary => historicalKeys.has(keyFor(summary.provider, summary.model))
      ? summary.configured === false
      : summary.configured === true && pricingKeys.has(keyFor(summary.provider, summary.model)))).toBe(true);
    expect(costSummary.some(summary => !summary.configured && historicalKeys.has(`${summary.provider}\u0000${summary.model}`))).toBe(true);
    expect(rates.every(rate => pricingKeys.has(`${rate.provider}\u0000${rate.model}`))).toBe(true);
  });

  it("derives session totals and stored summaries from model usage", () => {
    const { sessions, costSummary } = generateDemoSnapshot(referenceDate);
    const storedCosts = new Map<string, number>();
    for (const session of sessions) {
      expect(session.cost).toBe(roundCurrency(session.models.reduce((total, model) => total + model.cost, 0)));
      expect(session.tokens).toEqual(sumTokens(session.models.map(model => model.tokens)));
      for (const model of session.models) {
        if (model.source === "stored" && model.cost > 0) {
          const key = `${model.provider}\u0000${model.model}`;
          storedCosts.set(key, (storedCosts.get(key) ?? 0) + model.cost);
        }
      }
    }
    for (const summary of costSummary) {
      expect(summary.storedCost).toBe(roundCurrency(storedCosts.get(`${summary.provider}\u0000${summary.model}`) ?? 0));
      expect(summary.messages).toBeGreaterThan(0);
    }
    expect(sessions.some(session => session.models.some(model => model.cost !== roundCurrency(model.cost)))).toBe(true);
  });
});
