// Runs electron-builder with the repository's release configuration.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { electronBuilderInvocation, prepareElectronBuilderEnvironment } from "./electron-builder-environment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environment = prepareElectronBuilderEnvironment(process.env);

const invocation = electronBuilderInvocation(root, process.argv.slice(2));
const result = spawnSync(invocation.command, invocation.args, {
  cwd: root,
  env: environment,
  stdio: "inherit",
});
if (result.error) throw new Error(`Unable to run electron-builder: ${result.error.message}`);
if (result.status !== 0) process.exitCode = result.status ?? 1;
