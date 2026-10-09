// Declares the desktop API contract available to the renderer.
import type {
  ApiError,
  AuditReport,
  CatalogStatus,
  CostSummary,
  RateEntry,
  RecalculationResult,
  ResolvedPaths,
  RuntimeMetrics,
  SessionRecord,
  Settings,
  SettingsResponse,
} from "../src/types";

export interface DesktopApi {
  getData(): Promise<SessionRecord[]>;
  getCostSummary(): Promise<CostSummary[]>;
  getSettings(): Promise<Settings>;
  getSettingsStatus(): Promise<SettingsResponse>;
  getRuntimeMetrics(includeDatabaseSize: boolean): Promise<RuntimeMetrics>;
  saveSettings(settings: Settings): Promise<void>;
  getResolvedPaths(): Promise<ResolvedPaths>;
  getRates(): Promise<RateEntry[]>;
  getCatalogStatus(): Promise<CatalogStatus>;
  recalculateData(): Promise<RecalculationResult>;
  getAuditReport(): Promise<AuditReport>;
  pickPath(): Promise<string | null>;
  exportAuditReport(content: string, suggestedName: string): Promise<string | null>;
  openExternalUrl(url: string): Promise<void>;
  onDatabaseChanged(callback: () => void): () => void;
  onBackendFailed(callback: (error: ApiError) => void): () => void;
}
