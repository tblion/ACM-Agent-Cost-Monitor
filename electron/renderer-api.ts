// Declares the desktop API contract available to the renderer.
import type {
  ApiError,
  BackendLogEntry,
  AuditReport,
  CatalogStatus,
  CostSummary,
  InternalStoreMergeResult,
  InternalStoreStatus,
  InternalStoreSource,
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
  getInternalStoreStatus(): Promise<InternalStoreStatus>;
  getInternalStoreSources(): Promise<InternalStoreSource[]>;
  refreshInternalStoreSource(sourceId: string): Promise<void>;
  refreshOpenCodeApi(): Promise<void>;
  exportInternalStore(): Promise<string | null>;
  mergeInternalStore(): Promise<InternalStoreMergeResult | null>;
  getBackendLogs(): Promise<BackendLogEntry[]>;
  onBackendLog(callback: (entry: BackendLogEntry) => void): () => void;
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
