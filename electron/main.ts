import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { IpcMainInvokeEvent, OpenDialogOptions } from "electron";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BackendProcess } from "./backend-process";
import { IPC_CHANNELS } from "./ipc-contract";
import type { IpcResult } from "./ipc-contract";
import type { ApiError } from "../src/types";

const applicationName = "ACM Agent Cost Monitor";
const legacyApplicationIdentifier = "com.fcpb6403.opencode-costs-viewer";
const backendOperations = new Set([
  "get_data",
  "get_cost_summary",
  "get_settings",
  "get_settings_status",
  "get_runtime_metrics",
  "save_settings",
  "get_resolved_paths",
  "get_rates",
  "get_catalog_status",
  "recalculate_data",
  "get_audit_report",
]);
const maximumAuditExportBytes = 128 * 1024 * 1024;

const configuredSettingsDirectory = process.env.OPENCODE_COSTS_VIEWER_SETTINGS_DIR;
app.setPath(
  "userData",
  configuredSettingsDirectory || path.join(app.getPath("appData"), legacyApplicationIdentifier),
);
app.setName(applicationName);

let mainWindow: BrowserWindow | null = null;
let startupFailure: ApiError | null = null;
let allowQuit = false;
let shutdownPromise: Promise<void> | null = null;

const rootDirectory = app.isPackaged
  ? app.getAppPath()
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendExecutable = process.platform === "win32"
  ? "OpencodeCostsViewer.Backend.exe"
  : "OpencodeCostsViewer.Backend";
const backendPath = app.isPackaged
  ? path.join(process.resourcesPath, "backend", backendExecutable)
  : path.join(rootDirectory, "src-dotnet", "bin", "Release", "net10.0", backendExecutable);

const backend = new BackendProcess({
  executablePath: backendPath,
  workingDirectory: app.isPackaged ? process.resourcesPath : rootDirectory,
  settingsDirectory: app.getPath("userData"),
  onEvent: (message) => {
    if (message.event === "db-changed") {
      mainWindow?.webContents.send(IPC_CHANNELS.databaseChanged, message.payload);
    }
  },
  onFailure: (error) => {
    startupFailure = error;
    mainWindow?.webContents.send(IPC_CHANNELS.backendFailed, error);
  },
});

ipcMain.handle(IPC_CHANNELS.invokeBackend, async (event, operation: unknown, args: unknown) => {
  if (!isTrustedSender(event)) {
    return failure({ code: "invalid_input", message: "Untrusted IPC sender." });
  }
  if (typeof operation !== "string" || !backendOperations.has(operation)) {
    return failure({ code: "invalid_input", message: "Unknown backend operation." });
  }
  if (args !== undefined && !isRecord(args)) {
    return failure({ code: "invalid_input", message: "Backend operation arguments must be an object." });
  }
  return asIpcResult(() => backend.request(operation, (args as Record<string, unknown> | undefined) ?? {}));
});

ipcMain.handle(IPC_CHANNELS.pickPath, async (event) => {
  if (!isTrustedSender(event)) return failure({ code: "invalid_input", message: "Untrusted IPC sender." });
  return asIpcResult(async () => {
  const options: OpenDialogOptions = { properties: ["openFile"] };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
  }, "settings");
});

ipcMain.handle(IPC_CHANNELS.exportAuditReport, async (event, input: unknown) => {
  if (!isTrustedSender(event)) return failure({ code: "invalid_input", message: "Untrusted IPC sender." });
  return asIpcResult(async () => {
    if (!isRecord(input)
        || typeof input.content !== "string"
        || typeof input.suggestedName !== "string"
        || path.basename(input.suggestedName) !== input.suggestedName) {
      throw { code: "invalid_input", message: "Invalid audit export request." } satisfies ApiError;
    }

    const extension = path.extname(input.suggestedName).slice(1).toLowerCase();
    if (extension !== "json" && extension !== "csv") {
      throw { code: "invalid_input", message: "Le nom d'export doit se terminer par .json ou .csv" } satisfies ApiError;
    }
    if (Buffer.byteLength(input.content, "utf8") > maximumAuditExportBytes) {
      throw { code: "invalid_input", message: "Audit export exceeds the 128 MiB size limit." } satisfies ApiError;
    }

    const options = {
      defaultPath: input.suggestedName,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    };
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;

    try {
      await writeFile(result.filePath, input.content, "utf8");
    } catch (error) {
      throw { code: "export", message: `Ecriture de l'export impossible: ${errorMessage(error)}` } satisfies ApiError;
    }
    return result.filePath;
  }, "export");
});

ipcMain.handle(IPC_CHANNELS.openExternalUrl, async (event, input: unknown) => {
  if (!isTrustedSender(event)) return failure({ code: "invalid_input", message: "Untrusted IPC sender." });
  return asIpcResult(async () => {
    if (typeof input !== "string") {
      throw { code: "invalid_input", message: "External URL must be a string." } satisfies ApiError;
    }
    const url = new URL(input);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password) {
      throw { code: "invalid_input", message: "External URL is not allowed." } satisfies ApiError;
    }
    await shell.openExternal(url.toString());
  }, "invalid_input");
});

function createMainWindow(): void {
  const rendererFile = path.join(rootDirectory, "dist-electron-renderer", "index.html");
  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  mainWindow = new BrowserWindow({
    title: applicationName,
    width: 1100,
    height: 760,
    show: false,
    icon: path.join(
      rootDirectory,
      "assets",
      "icons",
      process.platform === "win32" ? "icon.ico" : "icon.png",
    ),
    webPreferences: {
      preload: path.join(rootDirectory, "dist-electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  if (developmentUrl) {
    void mainWindow.loadURL(developmentUrl);
  } else {
    void mainWindow.loadFile(rendererFile);
  }

  if (startupFailure) {
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow?.webContents.send(IPC_CHANNELS.backendFailed, startupFailure);
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  if (!mainWindow || event.sender !== mainWindow.webContents) return false;
  const frame = event.senderFrame;
  if (!frame || frame !== mainWindow.webContents.mainFrame) return false;

  return isTrustedUrl(frame.url);
}

function isTrustedUrl(url: string): boolean {
  try {
    const expectedUrl = process.env.VITE_DEV_SERVER_URL
      ? new URL(process.env.VITE_DEV_SERVER_URL)
      : pathToFileURL(path.join(rootDirectory, "dist-electron-renderer", "index.html"));
    const senderUrl = new URL(url);
    if (expectedUrl.protocol === "file:") {
      if (senderUrl.protocol !== "file:") return false;
      const expectedPath = path.resolve(fileURLToPath(expectedUrl));
      const senderPath = path.resolve(fileURLToPath(senderUrl));
      return process.platform === "win32"
        ? senderPath.toLowerCase() === expectedPath.toLowerCase()
        : senderPath === expectedPath;
    }
    return senderUrl.origin === expectedUrl.origin
      && senderUrl.pathname === expectedUrl.pathname;
  } catch {
    return false;
  }
}

async function asIpcResult<T>(action: () => Promise<T>, fallbackCode = "database"): Promise<IpcResult<T>> {
  try {
    return { success: true, value: await action() };
  } catch (error) {
    return { success: false, error: normalizeApiError(error, fallbackCode) };
  }
}

function failure<T>(error: ApiError): IpcResult<T> {
  return { success: false, error };
}

function normalizeApiError(error: unknown, fallbackCode: string): ApiError {
  if (isRecord(error)
      && typeof error.code === "string"
      && typeof error.message === "string") {
    return { code: error.code, message: error.message };
  }
  return { code: fallbackCode, message: errorMessage(error) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (allowQuit) return;
  event.preventDefault();
  if (shutdownPromise) return;

  shutdownPromise = backend.stop().finally(() => {
    allowQuit = true;
    app.quit();
  });
});

void app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    app.dock?.setIcon(path.join(rootDirectory, "assets", "icons", "icon.png"));
  }

  try {
    await backend.start();
  } catch (error) {
    startupFailure = normalizeApiError(error, "database");
  }
  createMainWindow();
});
