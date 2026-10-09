// Defines the validated IPC channels and result envelope shared by Electron processes.
import type { ApiError } from "../src/types";

export type IpcResult<T> =
  | { success: true; value: T }
  | { success: false; error: ApiError };

export const IPC_CHANNELS = {
  invokeBackend: "backend:invoke",
  pickPath: "native:pick-path",
  exportAuditReport: "native:export-audit-report",
  openExternalUrl: "native:open-external-url",
  databaseChanged: "backend:db-changed",
  backendFailed: "backend:failed",
} as const;
