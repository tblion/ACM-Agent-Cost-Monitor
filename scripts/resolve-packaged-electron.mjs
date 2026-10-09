// Locates the packaged Electron executable for the current platform.
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
    return path.join(releaseDirectory, "win-unpacked", "ACM Agent Cost Monitor.exe");
  }
  if (platform === "linux") {
    return path.join(releaseDirectory, "linux-unpacked", "acm-agent-cost-monitor");
  }
  if (platform === "darwin") {
    const architectures = arch === "arm64" ? ["mac-arm64", "mac"] : ["mac", "mac-x64"];
    for (const directory of architectures) {
      const candidate = path.join(
        releaseDirectory,
        directory,
        "ACM Agent Cost Monitor.app",
        "Contents",
        "MacOS",
        "ACM Agent Cost Monitor",
      );
      if (existsSync(candidate)) return candidate;
    }
    throw new Error(`Packaged macOS app for ${arch} was not found under ${releaseDirectory}`);
  }
  throw new Error(`Unsupported packaged Electron test platform: ${platform}/${arch}`);
}
