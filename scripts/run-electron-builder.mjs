import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environment = { ...process.env };
const hasSigningCredentials = Boolean(
  environment.CSC_LINK
  || environment.CSC_NAME
  || environment.WIN_CSC_LINK,
);
if (!hasSigningCredentials && !environment.CSC_IDENTITY_AUTO_DISCOVERY) {
  environment.CSC_IDENTITY_AUTO_DISCOVERY = "false";
}

const result = spawnSync("electron-builder", process.argv.slice(2), {
  cwd: root,
  env: environment,
  stdio: "inherit",
});
if (result.error) throw new Error(`Unable to run electron-builder: ${result.error.message}`);
if (result.status !== 0) process.exitCode = result.status ?? 1;
