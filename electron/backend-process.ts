import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { ApiError } from "../src/types";
import { BACKEND_PROTOCOL_VERSION } from "./protocol";
import type { BackendEvent, BackendRequest, BackendResponse } from "./protocol";

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: ApiError): void;
}

interface BackendProcessOptions {
  executablePath: string;
  workingDirectory: string;
  settingsDirectory: string;
  onEvent(event: BackendEvent): void;
  onFailure(error: ApiError): void;
}

export class BackendProcess {
  private static readonly maximumStderrCharacters = 64 * 1024;
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private exited: Promise<void> = Promise.resolve();
  private resolveExited: (() => void) | undefined;
  private stderrTail = "";
  private stopping = false;

  constructor(private readonly options: BackendProcessOptions) {}

  async start(): Promise<void> {
    if (this.child) return;

    const child = spawn(this.options.executablePath, [], {
      cwd: this.options.workingDirectory,
      env: {
        ...process.env,
        OPENCODE_COSTS_VIEWER_SETTINGS_DIR: this.options.settingsDirectory,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.stopping = false;
    this.stderrTail = "";
    this.exited = new Promise<void>((resolve) => {
      this.resolveExited = resolve;
    });

    const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
    output.on("line", (line) => this.handleOutputLine(line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (data: string) => {
      this.stderrTail = `${this.stderrTail}${data}`.slice(-BackendProcess.maximumStderrCharacters);
    });
    child.on("error", (error) => {
      const apiError = toApiError(error, "database");
      this.rejectPending(apiError);
      if (!this.stopping) this.options.onFailure(apiError);
      if (child.pid && child.exitCode === null && !child.killed) child.kill();
    });
    child.on("close", (code, signal) => {
      output.close();
      this.child = null;
      this.rejectPending({
        code: "database",
        message: `Backend process exited (${signal ?? code ?? "unknown"}).`,
      });
      this.resolveExited?.();
      this.resolveExited = undefined;
      if (!this.stopping) {
        if (this.stderrTail) process.stderr.write(`[.NET backend stderr tail]\n${this.stderrTail}\n`);
        this.options.onFailure({
          code: "database",
          message: `Backend process exited unexpectedly (${signal ?? code ?? "unknown"}).`,
        });
      }
    });

    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
  }

  request<T>(operation: string, args: Record<string, unknown> = {}): Promise<T> {
    const child = this.child;
    if (!child || child.exitCode !== null || child.killed || !child.stdin.writable) {
      return Promise.reject({ code: "database", message: "Backend process is not running." } satisfies ApiError);
    }

    const request: BackendRequest = {
      id: randomUUID(),
      operation,
      arguments: args,
      protocolVersion: BACKEND_PROTOCOL_VERSION,
    };

    return new Promise<T>((resolve, reject) => {
      this.pending.set(request.id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      child.stdin.write(`${JSON.stringify(request)}\n`, "utf8", (error) => {
        if (!error) return;
        this.pending.delete(request.id);
        reject(toApiError(error, "database"));
      });
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    try {
      if (child.stdin.writable) child.stdin.end();
      await waitForExit(this.exited, 5000);
      if (this.child === child) {
        child.kill();
        await waitForExit(this.exited, 2000);
      }
    } catch (error) {
      process.stderr.write(`Failed to stop .NET backend cleanly: ${errorMessage(error)}\n`);
      if (child.pid && child.exitCode === null && !child.killed) child.kill();
    } finally {
      this.stopping = false;
    }
  }

  private handleOutputLine(line: string): void {
    let message: BackendResponse | BackendEvent;
    try {
      message = JSON.parse(line) as BackendResponse | BackendEvent;
    } catch (error) {
      const apiError = toApiError(error, "database");
      this.rejectPending(apiError);
      this.options.onFailure({ code: "database", message: "Backend emitted invalid protocol JSON." });
      this.child?.kill();
      return;
    }

    if ("event" in message) {
      if (message.event === "db-changed" && message.payload === null) {
        this.options.onEvent(message);
      }
      return;
    }

    if (!("id" in message) || typeof message.id !== "string") {
      this.failProtocol("Backend response is missing a request id.");
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error && typeof message.error.code === "string" && typeof message.error.message === "string") {
      pending.reject(message.error);
    } else if ("result" in message) {
      pending.resolve(message.result);
    } else {
      pending.reject({ code: "database", message: "Backend response has no result or error." });
    }
  }

  private failProtocol(message: string): void {
    const error = { code: "database", message } satisfies ApiError;
    this.rejectPending(error);
    this.options.onFailure(error);
    this.child?.kill();
  }

  private rejectPending(error: ApiError): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}

async function waitForExit(exited: Promise<void>, timeoutMilliseconds: number): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  const timedOut = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, timeoutMilliseconds);
    timeout.unref();
  });
  await Promise.race([exited, timedOut]);
  if (timeout) clearTimeout(timeout);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toApiError(error: unknown, code: string): ApiError {
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
  };
}
