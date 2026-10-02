import net from "node:net";
import { readFile, unlink } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to reserve an E2E port"));
        return;
      }
      const port = address.port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

const port = Number(process.env.E2E_PORT ?? await reserveFreePort());
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Invalid E2E_PORT: ${port}`);
const childPidFile = path.join(os.tmpdir(), `opencode-costs-viewer-e2e-${process.pid}.pid`);
const electronConfig = process.env.E2E_ELECTRON === "true"
  ? ["--config=playwright.electron.config.ts"]
  : [];
const child = spawn(process.execPath, ["node_modules/@playwright/test/cli.js", "test", ...electronConfig, ...process.argv.slice(2)], {
  env: {
    ...process.env,
    E2E_PORT: String(port),
    E2E_REPORT_DIR: process.env.E2E_REPORT_DIR ?? `playwright-report/${port}`,
    E2E_TEST_RESULTS_DIR: process.env.E2E_TEST_RESULTS_DIR ?? `test-results/${port}`,
    E2E_CHILD_PID_FILE: childPidFile,
  },
  stdio: "inherit",
});

let shuttingDown = false;

function signalExitCode(signal) {
  return signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1;
}

async function terminateMockTree() {
  let pid;
  try { pid = Number(await readFile(childPidFile, "utf8")); } catch { return; }
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/pid", String(pid), "/T", "/F"]).catch(() => undefined);
  } else {
    try { process.kill(-pid, "SIGTERM"); } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
    try { process.kill(-pid, 0); process.kill(-pid, "SIGKILL"); } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  await unlink(childPidFile).catch(() => undefined);
}

function finish(exitCode, signal, terminateChild) {
  if (finish.promise) return finish.promise;
  shuttingDown = true;
  finish.promise = (async () => {
    if (terminateChild && child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
      await Promise.race([new Promise(resolve => child.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 5_000))]);
    }
    await terminateMockTree();
    await unlink(childPidFile).catch(() => undefined);
    process.exit(exitCode);
  })();
  return finish.promise;
}

process.once("SIGINT", () => finish(130, "SIGINT", true));
process.once("SIGTERM", () => finish(143, "SIGTERM", true));
child.once("error", error => {
  console.error(error);
  void finish(1, "SIGTERM", true);
});
child.once("exit", (code, signal) => {
  if (!shuttingDown) void finish(code ?? (signal ? signalExitCode(signal) : 1), signal ?? "SIGTERM", false);
});
