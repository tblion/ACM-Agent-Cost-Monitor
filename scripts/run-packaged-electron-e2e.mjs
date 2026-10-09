// Builds or locates a packaged app and runs its Electron E2E scenarios.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resolved = spawnSync(process.execPath, [
  path.join(root, "scripts", "resolve-packaged-electron.mjs"),
], { cwd: root, encoding: "utf8" });

if (resolved.error) throw new Error(`Unable to locate packaged Electron app: ${resolved.error.message}`);
if (resolved.status !== 0) throw new Error(resolved.stderr.trim() || "Unable to locate packaged Electron app.");

const executablePath = resolved.stdout.trim();
const result = spawnSync(process.execPath, [path.join(root, "e2e", "run-playwright.mjs")], {
  cwd: root,
  env: {
    ...process.env,
    E2E_ELECTRON: "true",
    ELECTRON_EXECUTABLE_PATH: executablePath,
  },
  stdio: "inherit",
});

if (result.error) throw new Error(`Unable to run packaged Electron E2E: ${result.error.message}`);
if (result.status !== 0) process.exitCode = result.status ?? 1;
