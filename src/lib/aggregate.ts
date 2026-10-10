// Filters sessions and computes dashboard aggregates from usage records.
import type { CostSource, MessageUsage, ModelUsage, SessionRecord, Tokens, CustomGroup } from "../types";

// projects/models/providers:
//   undefined = no filter (everything passes)
//   []        = nothing selected -> nothing passes
//   [...]     = union filter over these elements
export type DatePreset = "today" | "yesterday" | "last7Days" | "thisWeek" | "last30Days" | "thisMonth" | "lastMonth" | "thisYear" | "custom" | "allTime";
export interface Filters { projects?: string[]; models?: string[]; providers?: string[]; from?: number; to?: number; datePreset?: DatePreset; includeWholeSessions?: boolean; }
export interface KV { key: string; value: number; }

export const MAX_PERIOD_DAYS = 3650;

export function startOfLocalDay(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
  return date.getTime();
}

export function endOfLocalDay(value: string): number | undefined {
  const start = startOfLocalDay(value);
  if (start === undefined) return undefined;
  const date = new Date(start);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

export function formatLocalDate(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateRangeForPreset(preset: Exclude<DatePreset, "custom">, referenceTime = Date.now()): Pick<Filters, "from" | "to"> {
  const today = new Date(referenceTime);
  today.setHours(0, 0, 0, 0);
  const dayRange = (start: Date, end: Date) => ({
    from: startOfLocalDay(formatLocalDate(start.getTime())),
    to: endOfLocalDay(formatLocalDate(end.getTime())),
  });

  switch (preset) {
    case "today":
      return dayRange(today, today);
    case "yesterday": {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return dayRange(yesterday, yesterday);
    }
    case "last7Days":
    case "last30Days": {
      const start = new Date(today);
      start.setDate(start.getDate() - (preset === "last7Days" ? 6 : 29));
      return dayRange(start, today);
    }
    case "thisWeek": {
      const start = new Date(today);
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return dayRange(start, end);
    }
    case "thisMonth": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return dayRange(start, end);
    }
    case "lastMonth": {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return dayRange(start, end);
    }
    case "thisYear":
      return dayRange(new Date(today.getFullYear(), 0, 1), new Date(today.getFullYear(), 11, 31));
    case "allTime":
      return { from: undefined, to: undefined };
  }
}

export function filterSessions(data: SessionRecord[], f: Filters): SessionRecord[] {
  const projects = f.projects === undefined ? undefined : new Set(f.projects);
  const hasDateRange = f.from !== undefined || f.to !== undefined;
  const includeWholeSessions = f.includeWholeSessions !== false;

  return data.flatMap(session => {
    if (projects !== undefined && !projects.has(session.project)) return [];
    const messages = session.messages;
    if (!messages?.length) {
      if (f.from !== undefined && session.date < f.from) return [];
      if (f.to !== undefined && session.date > f.to) return [];
      if (f.models !== undefined && !session.models.some(model => f.models!.includes(model.model))) return [];
      if (f.providers !== undefined && !session.models.some(model => f.providers!.includes(model.provider))) return [];
      return [session];
    }

    const hasDatedMessages = messages.some(message => message.date !== null);
    const sessionDateMatches = (f.from === undefined || session.date >= f.from)
      && (f.to === undefined || session.date <= f.to);
    const matchingDateMessages = !hasDateRange || !hasDatedMessages
      ? (sessionDateMatches ? messages : [])
      : messages.filter(message => message.date !== null
        && (f.from === undefined || message.date >= f.from)
        && (f.to === undefined || message.date <= f.to));
    const matchesModelAndProvider = (message: MessageUsage) =>
      (f.models === undefined || f.models.includes(message.model))
      && (f.providers === undefined || f.providers.includes(message.provider));
    const matchingMessages = matchingDateMessages.filter(matchesModelAndProvider);
    if (matchingMessages.length === 0) return [];

    const dimensionFilteredMessages = includeWholeSessions
      ? messages.filter(matchesModelAndProvider)
      : matchingMessages;
    if (dimensionFilteredMessages.length === 0) return [];
    if (includeWholeSessions && dimensionFilteredMessages.length === messages.length) return [session];
    return [aggregateFilteredMessages(session, dimensionFilteredMessages)];
  });
}

function aggregateFilteredMessages(session: SessionRecord, messages: MessageUsage[]): SessionRecord {
  const models = new Map<string, ModelUsage>();
  let cost = 0;
  let source: CostSource = "configured";
  const tokens = createTokens();

  for (const message of messages) {
    cost += message.cost;
    addTokens(tokens, message.tokens);
    if (message.source === "stored") source = "stored";
    const key = `${message.provider}\u0000${message.model}`;
    const model = models.get(key);
    if (model) {
      model.cost += message.cost;
      addTokens(model.tokens, message.tokens);
      if (message.source === "stored") model.source = "stored";
    } else {
      models.set(key, {
        provider: message.provider,
        model: message.model,
        cost: message.cost,
        tokens: { ...message.tokens },
        source: message.source,
      });
    }
  }

  return { ...session, cost, tokens, source, models: [...models.values()], messages };
}

function createTokens(): Tokens {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
}

function addTokens(target: Tokens, value: Tokens): void {
  target.input += value.input;
  target.output += value.output;
  target.cacheRead += value.cacheRead;
  target.cacheWrite += value.cacheWrite;
  target.reasoning += value.reasoning;
}

export function sumCost(data: SessionRecord[]): number {
  return data.reduce((a, s) => a + s.cost, 0);
}

export interface CostBySource { configured: number; stored: number; }

export function costBySource(data: SessionRecord[]): CostBySource {
  const result: CostBySource = { configured: 0, stored: 0 };
  for (const session of data) {
    const usages = session.models;
    if (usages.length === 0) {
      result[session.source] += session.cost;
      continue;
    }

    let modelTotal = 0;
    for (const usage of usages) {
      result[usage.source] += usage.cost;
      modelTotal += usage.cost;
    }

    // The backend normally sums model costs exactly.
    // The residual still preserves the total in case of rounding.
    const residual = session.cost - modelTotal;
    if (Math.abs(residual) > Number.EPSILON) {
      const source: CostSource = session.source;
      result[source] += residual;
    }
  }
  return result;
}

function groupBy(data: SessionRecord[], keyFn: (s: SessionRecord) => Iterable<string>): KV[] {
  const m = new Map<string, number>();
  for (const s of data) for (const k of keyFn(s)) m.set(k, (m.get(k) ?? 0) + s.cost);
  return [...m.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
}

export const byProject = (d: SessionRecord[]) => groupBy(d, s => [s.project]);

const PROJECT_GROUP_KEY_PREFIX = "\u0000project-group:";

export function isProjectGroupKey(key: string): boolean {
  return key.startsWith(PROJECT_GROUP_KEY_PREFIX);
}

export function projectSelectionLabel(key: string): string {
  return isProjectGroupKey(key) ? key.slice(PROJECT_GROUP_KEY_PREFIX.length) : key;
}

export function byProjectSelection(data: SessionRecord[], activeGroup?: CustomGroup): KV[] {
  if (!activeGroup) return byProject(data);
  const members = new Set(activeGroup.projects);
  const groupKey = `${PROJECT_GROUP_KEY_PREFIX}${activeGroup.name}`;
  const rows = groupBy(data, session => [members.has(session.project) ? groupKey : session.project]);
  if (!data.some(session => members.has(session.project))) {
    rows.push({ key: groupKey, value: 0 });
    rows.sort((a, b) => b.value - a.value);
  }
  return rows;
}

export const byModel = (d: SessionRecord[]): KV[] => {
  const m = new Map<string, number>();
  for (const s of d) for (const mu of s.models)
    m.set(mu.model, (m.get(mu.model) ?? 0) + mu.cost);
  return [...m.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
};

export const byProvider = (d: SessionRecord[]): KV[] => {
  const m = new Map<string, number>();
  for (const s of d) for (const mu of s.models)
    m.set(mu.provider, (m.get(mu.provider) ?? 0) + mu.cost);
  return [...m.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
};

export function tokenTotals(data: SessionRecord[]): Tokens {
  const t: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
  for (const s of data) {
    for (const m of s.models) {
      t.input += m.tokens.input; t.output += m.tokens.output;
      t.cacheRead += m.tokens.cacheRead; t.cacheWrite += m.tokens.cacheWrite;
      t.reasoning += m.tokens.reasoning;
    }
  }
  return t;
}

export interface BillingUsage {
  freeTokens: number;
  paidTokens: number;
  freeSessions: number;
  paidSessions: number;
}

export function usageByBillingType(data: SessionRecord[]): BillingUsage {
  const result: BillingUsage = { freeTokens: 0, paidTokens: 0, freeSessions: 0, paidSessions: 0 };
  for (const session of data) {
    let hasFree = false;
    let hasPaid = false;
    for (const usage of session.models) {
      const tokens = usage.tokens.input + usage.tokens.output + usage.tokens.cacheRead + usage.tokens.cacheWrite + usage.tokens.reasoning;
      if (tokens <= 0) continue;
      if (usage.cost === 0) {
        result.freeTokens += tokens;
        hasFree = true;
      } else if (usage.cost > 0) {
        result.paidTokens += tokens;
        hasPaid = true;
      }
    }
    if (hasFree) result.freeSessions += 1;
    if (hasPaid) result.paidSessions += 1;
  }
  return result;
}

export function topSessions(data: SessionRecord[], n: number): SessionRecord[] {
  return [...data].sort((a, b) => b.cost - a.cost).slice(0, n);
}

function parentDir(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
}

export function byGroup(data: SessionRecord[], custom: CustomGroup[]): KV[] {
  const m = new Map<string, number>();
  for (const s of data) {
    // A custom group takes precedence over the automatic group.
    const cg = custom.find(g => g.projects.includes(s.project));
    const key = cg ? cg.name : parentDir(s.project);
    m.set(key, (m.get(key) ?? 0) + s.cost);
  }
  return [...m.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
}
