// Maps renderer commands to the mock or Electron desktop API.
import type { DesktopApi } from "../electron/renderer-api";
import { invoke as invokeMock, listen as listenMock } from "./mock/desktop-mock";
import type {
  ApiError, AuditReport, BackendLogEntry, CatalogStatus, CostSummary, InternalStoreMergeResult, InternalStoreSource, InternalStoreStatus, RateEntry, RecalculationResult,
  ResolvedPaths, RuntimeMetrics, SessionRecord, Settings, SettingsResponse,
} from "./types";

export interface ApiCommandMap {
  get_data: SessionRecord[];
  get_settings: Settings;
  get_settings_status: SettingsResponse;
  get_runtime_metrics: RuntimeMetrics;
  save_settings: void;
  pick_path: string | null;
  get_resolved_paths: ResolvedPaths;
  get_internal_store_status: InternalStoreStatus;
  get_internal_store_sources: InternalStoreSource[];
  refresh_internal_store_source: void;
  refresh_opencode_api: void;
  export_internal_store: string | null;
  merge_internal_store: InternalStoreMergeResult | null;
  get_backend_logs: BackendLogEntry[];
  get_rates: RateEntry[];
  get_cost_summary: CostSummary[];
  get_catalog_status: CatalogStatus;
  recalculate_data: RecalculationResult;
  get_audit_report: AuditReport;
  export_audit_report: string | null;
}

export interface ApiCommandArgs {
  get_data: undefined;
  get_settings: undefined;
  get_settings_status: undefined;
  get_runtime_metrics: { includeDatabaseSize: boolean };
  save_settings: { s: Settings };
  pick_path: undefined;
  get_resolved_paths: undefined;
  get_internal_store_status: undefined;
  get_internal_store_sources: undefined;
  refresh_internal_store_source: { sourceId: string };
  refresh_opencode_api: undefined;
  export_internal_store: undefined;
  merge_internal_store: undefined;
  get_backend_logs: undefined;
  get_rates: undefined;
  get_cost_summary: undefined;
  get_catalog_status: undefined;
  recalculate_data: undefined;
  get_audit_report: undefined;
  export_audit_report: { content: string; suggestedName: string };
}

export type ApiCommandArguments<K extends keyof ApiCommandArgs> =
  ApiCommandArgs[K] extends undefined ? [] : [args: ApiCommandArgs[K]];

const knownApiErrorCodes = new Set(["database", "configuration", "settings", "pricing", "watcher", "integration", "export", "invalid_input"]);

export function isApiError(value: unknown): value is ApiError {
  return typeof value === "object" && value !== null
    && typeof (value as ApiError).code === "string"
    && typeof (value as ApiError).message === "string";
}

export function translateApiError(
  error: unknown,
  translate: (key: string) => string,
  fallback = "Une erreur inattendue est survenue.",
): string {
  if (isApiError(error)) {
    if (knownApiErrorCodes.has(error.code)) {
      const label = translate(`errors.${error.code}`);
      return error.message ? `${label}: ${error.message}` : label;
    }
    return error.message || fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

export function decodeApiPayload<T>(json: string): T {
  return JSON.parse(json) as T;
}

export function invokeCommand<K extends keyof ApiCommandMap>(
  command: K,
  ...args: ApiCommandArguments<K>
): Promise<ApiCommandMap[K]> {
  if (import.meta.env.VITE_OPENCODE_MOCK === "true") {
    return invokeMock<ApiCommandMap[K]>(command, args[0]);
  }

  const desktopApi = getDesktopApi();
  return invokeDesktopApi(desktopApi, command, args[0]) as Promise<ApiCommandMap[K]>;
}

export const getData = () => invokeCommand("get_data");
export const getSettings = () => invokeCommand("get_settings");
export const getSettingsStatus = () => invokeCommand("get_settings_status");
export const getLegacySettings = getSettings;
export const getRuntimeMetrics = (includeDatabaseSize: boolean) =>
  invokeCommand("get_runtime_metrics", { includeDatabaseSize });
export const saveSettings = (s: Settings) => invokeCommand("save_settings", { s });
export const pickPath = () => invokeCommand("pick_path");
export const onDbChanged = (callback: () => void): Promise<() => void> => {
  if (import.meta.env.VITE_OPENCODE_MOCK === "true") return listenMock("db-changed", callback);
  return Promise.resolve(getDesktopApi().onDatabaseChanged(callback));
};
export const getResolvedPaths = () => invokeCommand("get_resolved_paths");
export const getInternalStoreStatus = () => invokeCommand("get_internal_store_status");
export const getInternalStoreSources = () => invokeCommand("get_internal_store_sources");
export const refreshInternalStoreSource = (sourceId: string) => invokeCommand("refresh_internal_store_source", { sourceId });
export const refreshOpenCodeApi = () => invokeCommand("refresh_opencode_api");
export const exportInternalStore = () => invokeCommand("export_internal_store");
export const mergeInternalStore = () => invokeCommand("merge_internal_store");
export const getBackendLogs = () => invokeCommand("get_backend_logs");
export const onBackendLog = (callback: (entry: BackendLogEntry) => void): (() => void) => {
  if (import.meta.env.VITE_OPENCODE_MOCK === "true") return () => {};
  return getDesktopApi().onBackendLog(callback);
};
export const getRates = () => invokeCommand("get_rates");
export const getCostSummary = () => invokeCommand("get_cost_summary");
export const getCatalogStatus = () => invokeCommand("get_catalog_status");
export const recalculateData = () => invokeCommand("recalculate_data");
export const getAuditReport = () => invokeCommand("get_audit_report");
export const exportAudit = (content: string, suggestedName: string) =>
  invokeCommand("export_audit_report", { content, suggestedName });

function getDesktopApi(): DesktopApi {
  if (window.desktopApi) return window.desktopApi;
  throw new Error("Electron preload API is unavailable.");
}

function invokeDesktopApi(
  api: DesktopApi,
  command: keyof ApiCommandMap,
  args: unknown,
): Promise<unknown> {
  switch (command) {
    case "get_data": return api.getData();
    case "get_settings": return api.getSettings();
    case "get_settings_status": return api.getSettingsStatus();
    case "get_runtime_metrics": return api.getRuntimeMetrics((args as ApiCommandArgs["get_runtime_metrics"]).includeDatabaseSize);
    case "save_settings": return api.saveSettings((args as ApiCommandArgs["save_settings"]).s);
    case "pick_path": return api.pickPath();
    case "get_resolved_paths": return api.getResolvedPaths();
    case "get_internal_store_status": return api.getInternalStoreStatus();
    case "get_internal_store_sources": return api.getInternalStoreSources();
    case "refresh_internal_store_source": return api.refreshInternalStoreSource((args as ApiCommandArgs["refresh_internal_store_source"]).sourceId);
    case "refresh_opencode_api": return api.refreshOpenCodeApi();
    case "export_internal_store": return api.exportInternalStore();
    case "merge_internal_store": return api.mergeInternalStore();
    case "get_backend_logs": return api.getBackendLogs();
    case "get_rates": return api.getRates();
    case "get_cost_summary": return api.getCostSummary();
    case "get_catalog_status": return api.getCatalogStatus();
    case "recalculate_data": return api.recalculateData();
    case "get_audit_report": return api.getAuditReport();
    case "export_audit_report": {
      const exportArguments = args as ApiCommandArgs["export_audit_report"];
      return api.exportAuditReport(exportArguments.content, exportArguments.suggestedName);
    }
  }
}
