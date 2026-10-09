// Maps renderer commands to the mock or Electron desktop API.
import type { DesktopApi } from "../electron/renderer-api";
import { invoke as invokeMock, listen as listenMock } from "./mock/desktop-mock";
import type {
  ApiError, AuditReport, CatalogStatus, CostSummary, RateEntry, RecalculationResult,
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
  get_rates: undefined;
  get_cost_summary: undefined;
  get_catalog_status: undefined;
  recalculate_data: undefined;
  get_audit_report: undefined;
  export_audit_report: { content: string; suggestedName: string };
}

export type ApiCommandArguments<K extends keyof ApiCommandArgs> =
  ApiCommandArgs[K] extends undefined ? [] : [args: ApiCommandArgs[K]];

const knownApiErrorCodes = new Set(["database", "configuration", "settings", "pricing", "watcher", "export", "invalid_input"]);

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
