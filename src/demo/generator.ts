// Generates deterministic sample usage and audit data for demo mode.
import type { AuditReport, CostSummary, ModelUsage, RecalculationResult, SessionRecord, Tokens } from "../types";
import { DEMO_HISTORICAL_PRICING, DEMO_PRICING, DEMO_RATES, type DemoModelPricing } from "./catalog";
import { DEMO_AUDIT_REPORT } from "./audit-fixture";

const DAY_MS = 24 * 60 * 60 * 1000;
const PROJECTS = [
  "/demo/atlas-console",
  "/demo/nebula-ledger",
  "/demo/orchid-cli",
  "/demo/signal-workshop",
];

export interface DemoSnapshot {
  sessions: SessionRecord[];
  rates: typeof DEMO_RATES;
  costSummary: CostSummary[];
}

export function createDemoAuditReport(): AuditReport {
  return DEMO_AUDIT_REPORT;
}

export function createDemoRecalculationResult(snapshot: DemoSnapshot): RecalculationResult {
  const models = snapshot.sessions.flatMap(session => session.models);
  return {
    sessions: snapshot.sessions,
    diagnostics: {
      catalogueValid: true,
      recalculableMessages: models.filter(model => model.source === "configured").length,
      missingDates: 0,
      missingTokens: 0,
      missingRates: models.filter(model => model.source === "stored").length,
    },
  };
}

const INVALID_REFERENCE_DATE = "referenceDate must be a finite valid timestamp";

function validateReferenceDate(referenceDate: number): Date {
  if (!Number.isFinite(referenceDate)) throw new Error(INVALID_REFERENCE_DATE);
  const date = new Date(referenceDate);
  if (Number.isNaN(date.getTime())) throw new Error(INVALID_REFERENCE_DATE);
  return date;
}

export function createSeededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x6d2b79f5;
  return () => {
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function dateSeed(referenceDate: number): number {
  const date = validateReferenceDate(referenceDate);
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  let hash = 2166136261;
  for (const character of new Date(day).toISOString().slice(0, 10)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function safeToken(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function tokenSet(random: () => number, scale: number): Tokens {
  const input = safeToken((8_000 + random() * 70_000) * scale);
  const output = safeToken((1_000 + random() * 18_000) * scale);
  return {
    input,
    output,
    cacheRead: safeToken(input * (0.2 + random() * 0.7)),
    cacheWrite: safeToken(input * random() * 0.08),
    reasoning: safeToken(output * random() * 0.8),
  };
}

export function sumTokens(tokens: Tokens[]): Tokens {
  return tokens.reduce((total, current) => ({
    input: total.input + safeToken(current.input),
    output: total.output + safeToken(current.output),
    cacheRead: total.cacheRead + safeToken(current.cacheRead),
    cacheWrite: total.cacheWrite + safeToken(current.cacheWrite),
    reasoning: total.reasoning + safeToken(current.reasoning),
  }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 });
}

export function roundCurrency(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number((value + Number.EPSILON).toFixed(2));
}

export function calculateDemoCost(tokens: Tokens, pricing: DemoModelPricing): number {
  const input = safeToken(tokens.input);
  const output = safeToken(tokens.output);
  const cacheRead = safeToken(tokens.cacheRead);
  const cacheWrite = safeToken(tokens.cacheWrite);
  const reasoning = safeToken(tokens.reasoning);
  const inputRate = safeToken(pricing.input);
  const outputRate = safeToken(pricing.output);
  const cacheReadRate = safeToken(pricing.cacheRead);
  const cacheWriteRate = safeToken(pricing.cacheWrite);
  const result = (input * inputRate + output * outputRate + cacheRead * cacheReadRate
    + cacheWrite * cacheWriteRate + reasoning * outputRate) / 1_000_000;
  return Number.isFinite(result) && result > 0 ? result : 0;
}

function usage(pricing: DemoModelPricing, tokens: Tokens, source: ModelUsage["source"]): ModelUsage {
  return {
    provider: pricing.provider,
    model: pricing.model,
    tokens,
    source,
    cost: calculateDemoCost(tokens, pricing),
  };
}

function session(id: string, date: number, project: string, models: ModelUsage[], isSubagent = false, parentId: string | null = null): SessionRecord {
  const stored = models.some(model => model.source === "stored");
  return {
    id,
    project,
    title: isSubagent ? "Background analysis" : "Implement feature",
    date,
    cost: roundCurrency(models.reduce((total, model) => total + model.cost, 0)),
    tokens: sumTokens(models.map(model => model.tokens)),
    isSubagent,
    parentId,
    source: stored ? "stored" : "configured",
    models,
  };
}

export function generateDemoSnapshot(referenceDate: number = Date.now()): DemoSnapshot {
  const reference = validateReferenceDate(referenceDate);
  const end = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate());
  const targetYear = reference.getUTCFullYear() - 2;
  const targetMonth = reference.getUTCMonth();
  const targetDay = reference.getUTCDate();
  const lastTargetDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const from = Date.UTC(targetYear, targetMonth, Math.min(targetDay, lastTargetDay));
  const random = createSeededRandom(dateSeed(end));
  const sessions: SessionRecord[] = [];
  const add = (id: string, offset: number, projectIndex: number, models: ModelUsage[], child = false, parentId: string | null = null) => {
    sessions.push(session(id, from + offset * DAY_MS, PROJECTS[projectIndex], models, child, parentId));
  };

  add("demo-configured", 2, 0, [usage(DEMO_PRICING[0], tokenSet(random, 1.3), "configured")]);
  add("demo-stored", 8, 1, [usage(DEMO_HISTORICAL_PRICING[1], tokenSet(random, 0.8), "stored")]);
  add("demo-mixed", 15, 2, [
    usage(DEMO_PRICING[2], tokenSet(random, 1.1), "configured"),
    usage(DEMO_HISTORICAL_PRICING[2], tokenSet(random, 0.7), "stored"),
  ]);
  add("demo-zero", 22, 3, [usage(DEMO_HISTORICAL_PRICING[4], { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, "stored")]);
  const parentId = "demo-parent";
  add(parentId, 30, 0, [usage(DEMO_PRICING[5], tokenSet(random, 1.5), "configured")]);
  add("demo-child", 30, 0, [usage(DEMO_HISTORICAL_PRICING[6], tokenSet(random, 0.4), "stored")], true, parentId);

  const days = Math.floor((end - from) / DAY_MS);
  const weeks = Math.ceil((days + 1) / 7);
  let generated = 0;
  for (let week = 0; week < weeks; week += 1) {
    if (week % 8 === 0) continue;
    const activityProbability = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(week / 7));
    const count = 2 + (random() < activityProbability ? 1 : 0) + (random() < activityProbability * 0.35 ? 1 : 0);
    for (let offset = 0; offset < count; offset += 1) {
      const index = generated;
      const dayOffset = Math.min(days, week * 7 + Math.floor(random() * 7));
      const models: ModelUsage[] = [];
      const scale = 0.35 + random() * 1.8;
      if (index % 4 === 0) {
        models.push(usage(DEMO_PRICING[index % DEMO_PRICING.length], tokenSet(random, scale), "configured"));
      } else if (index % 4 === 1) {
        models.push(usage(DEMO_HISTORICAL_PRICING[index % DEMO_HISTORICAL_PRICING.length], tokenSet(random, scale), "stored"));
      } else {
        models.push(usage(DEMO_PRICING[index % DEMO_PRICING.length], tokenSet(random, scale), "configured"));
        models.push(usage(DEMO_HISTORICAL_PRICING[(index + 2) % DEMO_HISTORICAL_PRICING.length], tokenSet(random, 0.2 + random()), "stored"));
      }
      add(`demo-session-${index}`, dayOffset, index % PROJECTS.length, models);
      generated += 1;
    }
  }

  const summaryMap = new Map<string, { provider: string; model: string; messages: number; storedCost: number }>();
  for (const current of sessions) {
    for (const model of current.models) {
      if (model.source !== "stored" || model.cost <= 0) continue;
      const key = `${model.provider}\u0000${model.model}`;
      const summary = summaryMap.get(key) ?? { provider: model.provider, model: model.model, messages: 0, storedCost: 0 };
      summary.messages += 1;
      summary.storedCost += model.cost;
      summaryMap.set(key, summary);
    }
  }
  const costSummary = [...summaryMap.values()]
    .map(summary => ({
      ...summary,
      storedCost: roundCurrency(summary.storedCost),
      configured: DEMO_PRICING.some(rate => rate.provider === summary.provider && rate.model === summary.model),
    }))
    .filter(summary => summary.storedCost > 0);

  return { sessions, rates: DEMO_RATES.map(rate => ({ ...rate })), costSummary };
}
