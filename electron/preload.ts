import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { ApiError } from "../src/types";
import type { DesktopApi } from "./renderer-api";
import type { IpcResult } from "./ipc-contract";
import { IPC_CHANNELS } from "./ipc-contract";

async function unwrap<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const result = await promise;
  if (!result.success) throw result.error;
  return result.value;
}

function invokeBackend<T>(operation: string, args: Record<string, unknown> = {}): Promise<T> {
  return unwrap(ipcRenderer.invoke(IPC_CHANNELS.invokeBackend, operation, args) as Promise<IpcResult<T>>);
}

function subscribe(callback: () => void): () => void {
  const listener = (_event: IpcRendererEvent) => callback();
  ipcRenderer.on(IPC_CHANNELS.databaseChanged, listener);
  return () => ipcRenderer.removeListener(IPC_CHANNELS.databaseChanged, listener);
}

const desktopApi: DesktopApi = {
  getData: () => invokeBackend("get_data"),
  getCostSummary: () => invokeBackend("get_cost_summary"),
  getSettings: () => invokeBackend("get_settings"),
  getSettingsStatus: () => invokeBackend("get_settings_status"),
  getRuntimeMetrics: (includeDatabaseSize) =>
    invokeBackend("get_runtime_metrics", { includeDatabaseSize }),
  saveSettings: (settings) => invokeBackend("save_settings", { s: settings }),
  getResolvedPaths: () => invokeBackend("get_resolved_paths"),
  getRates: () => invokeBackend("get_rates"),
  getCatalogStatus: () => invokeBackend("get_catalog_status"),
  recalculateData: () => invokeBackend("recalculate_data"),
  getAuditReport: () => invokeBackend("get_audit_report"),
  pickPath: () => unwrap(ipcRenderer.invoke(IPC_CHANNELS.pickPath) as Promise<IpcResult<string | null>>),
  exportAuditReport: (content, suggestedName) =>
    unwrap(ipcRenderer.invoke(IPC_CHANNELS.exportAuditReport, { content, suggestedName }) as Promise<IpcResult<string | null>>),
  openExternalUrl: (url) =>
    unwrap(ipcRenderer.invoke(IPC_CHANNELS.openExternalUrl, url) as Promise<IpcResult<void>>),
  onDatabaseChanged: subscribe,
  onBackendFailed: (callback) => {
    const listener = (_event: IpcRendererEvent, error: ApiError) => callback(error);
    ipcRenderer.on(IPC_CHANNELS.backendFailed, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.backendFailed, listener);
  },
};

contextBridge.exposeInMainWorld("desktopApi", desktopApi);
