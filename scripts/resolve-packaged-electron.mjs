import { existsSync, readdirSync } from "node:fs";
import { arch, platform } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDirectory = path.join(root, "release");
const executable = resolveExecutable();
if (!existsSync(executable)) throw new Error(`Packaged Electron executable not found: ${executable}`);

if (process.env.GITHUB_OUTPUT) {
  await import("node:fs/promises").then(({ appendFile }) =>
    appendFile(process.env.GITHUB_OUTPUT, `electron-executable=${executable}\n`, "utf8"));
}
console.log(executable);

function resolveExecutable() {
  if (platform === "win32") {
    return path.join(releaseDirectory, "win-unpacked", "Opencode Costs Viewer.exe");
  }
  if (platform === "linux") {
    return path.join(releaseDirectory, "linux-unpacked", "opencode-costs-viewer");
  }
  if (platform === "darwin") {
    const architectures = arch === "arm64" ? ["mac-arm64", "mac"] : ["mac", "mac-x64"];
    for (const directory of architectures) {
      const candidate = path.join(
        releaseDirectory,
        directory,
        "Opencode Costs Viewer.app",
        "Contents",
        "MacOS",
        "Opencode Costs Viewer",
      );
      if (existsSync(candidate)) return candidate;
    }
    throw new Error(`Packaged macOS app for ${arch} was not found under ${releaseDirectory}`);
  }
  throw new Error(`Unsupported packaged Electron test platform: ${platform}/${arch}`);
}
