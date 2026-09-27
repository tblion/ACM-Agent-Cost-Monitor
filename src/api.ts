import { invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  ApiError, AuditReport, CatalogStatus, CostSummary, RateEntry, RecalculationResult,
  ResolvedPaths, RuntimeMetrics, SessionRecord, Settings, SettingsResponse,
} from "./types";

// Contract for results exposed by public Tauri commands.
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

// Arguments expected by each command; undefined means no payload is allowed.
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

// Decode fixtures and JSON responses without hiding a name transformation.
export function decodeApiPayload<T>(json: string): T {
  return JSON.parse(json) as T;
}

// Centralize command/response mapping to avoid diverging contracts.
export function invokeCommand<K extends keyof ApiCommandMap>(
  command: K,
  ...args: ApiCommandArguments<K>
): Promise<ApiCommandMap[K]> {
  return args.length === 0
    ? invoke<ApiCommandMap[K]>(command)
    : invoke<ApiCommandMap[K]>(command, args[0] as InvokeArgs);
}

export const getData = () => invokeCommand("get_data");
export const getSettings = () => invokeCommand("get_settings");
export const getSettingsStatus = () => invokeCommand("get_settings_status");
export const getLegacySettings = getSettings;
export const getRuntimeMetrics = (includeDatabaseSize: boolean) =>
  invokeCommand("get_runtime_metrics", { includeDatabaseSize });
export const saveSettings = (s: Settings) => invokeCommand("save_settings", { s });
export const pickPath = () => invokeCommand("pick_path");
export const onDbChanged = (cb: () => void) => listen("db-changed", cb);
export const getResolvedPaths = () => invokeCommand("get_resolved_paths");
export const getRates = () => invokeCommand("get_rates");
export const getCostSummary = () => invokeCommand("get_cost_summary");
export const getCatalogStatus = () => invokeCommand("get_catalog_status");
export const recalculateData = () => invokeCommand("recalculate_data");
export const getAuditReport = () => invokeCommand("get_audit_report");
export const exportAudit = (content: string, suggestedName: string) =>
  invokeCommand("export_audit_report", { content, suggestedName });
