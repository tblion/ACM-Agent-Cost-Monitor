// Publishes the .NET backend for the requested release runtime.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { arch, platform } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = path.join(root, "src-dotnet", "OpencodeCostsViewer.Backend.csproj");
const output = path.join(root, "src-dotnet", "publish", "backend");
const runtimeIdentifier = process.env.DOTNET_RID ?? currentRuntimeIdentifier();
const expectedRid = currentRuntimeIdentifier();

if (runtimeIdentifier !== expectedRid) {
  throw new Error(`Publish RID ${runtimeIdentifier} does not match build host ${expectedRid}.`);
}

rmSync(output, { recursive: true, force: true });
const publish = spawnSync("dotnet", [
  "publish",
  project,
  "--configuration", "Release",
  "--runtime", runtimeIdentifier,
  "--self-contained", "true",
  "-p:PublishSingleFile=true",
  "-p:PublishAot=false",
  "--output", output,
], { cwd: root, encoding: "utf8", stdio: "inherit" });

if (publish.error) throw new Error(`Unable to run dotnet publish: ${publish.error.message}`);
if (publish.status !== 0) throw new Error(`dotnet publish exited with code ${publish.status}.`);

const executable = path.join(output, platform === "win32" ? "OpencodeCostsViewer.Backend.exe" : "OpencodeCostsViewer.Backend");
if (!existsSync(executable)) throw new Error(`Published backend executable not found: ${executable}`);
console.log(`Published self-contained .NET backend for ${runtimeIdentifier}: ${path.relative(root, executable)}`);

function currentRuntimeIdentifier() {
  const architecture = arch === "arm64" ? "arm64" : "x64";
  if (platform === "win32" && architecture === "x64") return "win-x64";
  if (platform === "darwin") return `osx-${architecture}`;
  if (platform === "linux" && architecture === "x64") return "linux-x64";
  throw new Error(`Unsupported desktop publish host: ${platform}/${arch}`);
}
