// Declares the shared renderer and desktop API data contracts.
import type { SupportedLanguage } from "./i18n/locale";

export interface Tokens { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; }
export type CostSource = "configured" | "stored";
export interface ModelUsage { provider: string; model: string; cost: number; tokens: Tokens; source: CostSource; }
export interface MessageUsage { date: number | null; provider: string; model: string; cost: number; tokens: Tokens; source: CostSource; }
export interface SessionRecord {
  id: string; project: string; title: string; date: number; cost: number;
  tokens: Tokens; isSubagent: boolean; parentId: string | null;
  source: CostSource; models: ModelUsage[]; messages?: MessageUsage[];
}
export interface CustomGroup { name: string; projects: string[]; }
export interface FixedSubscription {
  id: string;
  provider: string;
  amount: number;
  period: "monthly" | "annual";
  models: string[];
  effectiveFrom: string;
  effectiveTo: string | null;
}
export interface ConfiguredRateVersion {
  id: string;
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  effectiveFrom: string;
  source: string;
}
export interface Settings {
  dbPath: string | null; configPath: string | null; live: boolean;
  theme: "system" | "light" | "dark"; language: SupportedLanguage | null;
  defaultPeriodDays: number; customGroups: CustomGroup[]; customRates: ConfiguredRateVersion[]; fixedSubscriptions: FixedSubscription[];
}
export interface ApiError { code: string; message: string; }
export interface BackendLogEntry { timestamp: string; level: string; message: string; exception: string | null; }
export interface SettingsResponse { settings: Settings; diagnostic: ApiError | null; liveActive: boolean; }
export interface ResolvedPaths { db: string; config: string; }
export interface InternalStoreStatus {
  databasePath: string;
  projects: number;
  sessions: number;
  messages: number;
  sources: number;
  lastImportedAt: string | null;
  lastSyncError: string | null;
}
export interface InternalStoreSource {
  sourceId: string;
  agentName: string;
  sourcePath: string;
  lastImportedAt: string | null;
  lastSyncAttemptAt: string;
  lastSyncError: string | null;
  channelKey: "database" | "api" | string;
}
export interface InternalStoreMergeResult { projectsAdded: number; sessionsAdded: number; messagesAdded: number; }
export interface RuntimeMetrics {
  databaseSizeBytes: number | null;
  processMemoryBytes: number | null;
  measuredAt: number;
}
export interface RateEntry {
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  source: "catalog" | "configured";
  effectiveFrom: string | null;
}
export interface CostSummary { provider: string; model: string; messages: number; storedCost: number; configured: boolean; }
export interface CatalogStatus { valid: boolean; version: number; generatedAt: string; sourceVersion: string; rateCount: number; }
export interface PricingLookupKey { kind: "usage" | "subscription"; provider: string; model: string; }
export interface PricingCandidate {
  sourceId: string; sourceType: "official" | "aggregator" | "other"; sourceName: string; sourceUrl: string;
  retrievedAt: string; effectiveFrom: string | null; provider: string; model: string; region: string | null;
  currency: string; unit: string; input: number | null; output: number | null; cacheRead: number | null;
  cacheWrite: number | null; matchStatus: "exact" | "ambiguous" | "unmatched"; confidenceReasons: string[];
}
export interface PricingSourceResult {
  sourceId: string; sourceType: "official" | "aggregator" | "other"; sourceName: string; sourceUrl: string;
  status: "available" | "error"; error: string | null; candidates: PricingCandidate[];
}
export interface PricingComparisonResult { retrievedAt: string; sources: PricingSourceResult[]; }
export interface RecalculationDiagnostics {
  catalogueValid: boolean;
  recalculableMessages: number;
  missingDates: number;
  missingTokens: number;
  missingRates: number;
}
export interface RecalculationResult { sessions: SessionRecord[]; diagnostics: RecalculationDiagnostics; }
export interface RecalculationPreview extends RecalculationResult {}

export interface CostBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
}
export type AuditCostSource = "configured" | "catalog" | "stored";
export type AuditRateSource = "configured" | "catalog";
export type AuditAnomaly = "missingTokens" | "missingDate" | "missingRate" | "invalidRate" | "storedCostFallback";
export interface AuditRate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}
export interface AuditProvenance {
  databasePath: string;
  configPath: string;
  catalogPath: string;
  catalogVersion: number;
  catalogSourceVersion: string;
  catalogGeneratedAt: string;
  catalogRateCount: number;
}
export interface AuditAnomalyCounts {
  missingTokens: number;
  missingDate: number;
  missingRate: number;
  invalidRate: number;
  storedCostFallback: number;
}
export interface AuditSummary {
  allSessions: number;
  totalMessages: number;
  sessionsWithAssistant: number;
  assistantMessages: number;
  ignoredMessages: number;
  recalculableMessages: number;
  customRateMessages: number;
  catalogRateMessages: number;
  storedFallbackMessages: number;
  missingTokenMessages: number;
  missingDateMessages: number;
  missingRateMessages: number;
  storedCostTotal: number;
  calculatedCostTotal: number;
  selectedCostTotal: number;
  tokens: Tokens;
  anomalyCounts: AuditAnomalyCounts;
}
export interface AuditMessage {
  messageId: string;
  sessionId: string;
  project: string;
  provider: string;
  model: string;
  messageDate: number | null;
  tokens: Tokens | null;
  storedCost: number;
  calculatedCost: number | null;
  selectedCost: number;
  costSource: AuditCostSource;
  rateSource: AuditRateSource | null;
  effectiveFrom: string | null;
  rate: AuditRate | null;
  breakdown: CostBreakdown | null;
  anomalies: AuditAnomaly[];
}
export interface AuditIgnoredMessage {
  messageId: string;
  sessionId: string;
  role: string;
  reason: string;
}
export interface AuditSession {
  sessionId: string;
  project: string;
  title: string;
  parentId: string | null;
  assistantMessages: number;
  cost: number;
  tokens: Tokens;
  messageIds: string[];
}
export interface AuditInvariantStatus {
  valid: boolean;
  failed: string[];
}
export interface AuditReport {
  generatedAt: string;
  valid: boolean;
  provenance: AuditProvenance;
  summary: AuditSummary;
  messages: AuditMessage[];
  ignored: AuditIgnoredMessage[];
  sessions: AuditSession[];
  invariants: AuditInvariantStatus;
}
