import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { arch, platform } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectPath = path.join(repositoryRoot, "src-dotnet", "PackagingProbe", "PackagingProbe.csproj");
const artifactRoot = path.join(repositoryRoot, "artifacts", "packaging-probe");
const runtimeIdentifier = process.env.PACKAGING_RID ?? getRuntimeIdentifier();
const applicationName = platform === "win32" ? "PackagingProbe.exe" : "PackagingProbe";

if (!existsSync(projectPath)) {
  throw new Error(`Packaging probe project not found: ${projectPath}`);
}

const modes = [
  { name: "framework-dependent", selfContained: "false", publishAot: "false" },
  { name: "self-contained", selfContained: "true", publishAot: "false" },
  { name: "native-aot", selfContained: "true", publishAot: "true" },
];

const results = [];
for (const mode of modes) {
  results.push(await measureMode(mode));
}

const report = {
  measuredAt: new Date().toISOString(),
  runtimeIdentifier,
  host: { platform, architecture: arch },
  results,
};
const reportDirectory = path.join(artifactRoot, runtimeIdentifier);
mkdirSync(reportDirectory, { recursive: true });
const reportPath = path.join(reportDirectory, "report.json");
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
console.log(`Report written to ${path.relative(repositoryRoot, reportPath)}`);

if (results.some((result) => result.status !== "passed")) {
  process.exitCode = 1;
}

async function measureMode(mode) {
  const publishDirectory = path.join(artifactRoot, runtimeIdentifier, mode.name, "publish");
  const archivePath = path.join(artifactRoot, runtimeIdentifier, `${mode.name}.tar.gz`);
  rmSync(path.dirname(publishDirectory), { recursive: true, force: true });
  mkdirSync(publishDirectory, { recursive: true });

  const publish = spawnSync("dotnet", [
    "publish",
    projectPath,
    "--configuration", "Release",
    "--runtime", runtimeIdentifier,
    "--self-contained", mode.selfContained,
    "-p:PublishSingleFile=true",
    `-p:PublishAot=${mode.publishAot}`,
    "--output", publishDirectory,
  ], { cwd: repositoryRoot, encoding: "utf8" });

  if (publish.error || publish.status !== 0) {
    const message = publish.error?.message || publish.stderr.trim() || "dotnet publish failed";
    console.warn(`${mode.name}: publish failed for ${runtimeIdentifier}: ${message}`);
    return { mode: mode.name, status: "publish-failed", details: message };
  }

  const executablePath = path.join(publishDirectory, applicationName);
  if (!existsSync(executablePath)) {
    return { mode: mode.name, status: "publish-failed", details: `Published executable not found: ${executablePath}` };
  }

  const launch = spawnSync(executablePath, [], { cwd: repositoryRoot, encoding: "utf8", timeout: 15_000 });
  const smokeOutput = String(launch.stdout ?? "").trim();
  const launchDetails = [
    `process exit code: ${launch.status ?? "unknown"}`,
    launch.error?.message,
    launch.stderr.trim(),
  ].filter(Boolean).join("; ");
  let smokeResult;
  try {
    smokeResult = JSON.parse(smokeOutput);
  } catch {
    const details = `${launchDetails}; output: ${smokeOutput}`;
    console.warn(`${mode.name}: launch failed for ${runtimeIdentifier}: ${details}`);
    return { mode: mode.name, status: "launch-failed", details };
  }

  if (launch.status !== 0
      || smokeResult.probe !== "packaging"
      || typeof smokeResult.runtime !== "string"
      || typeof smokeResult.architecture !== "string") {
    const details = `${launchDetails}; unexpected smoke result: ${smokeOutput}`;
    return { mode: mode.name, status: "launch-failed", details };
  }

  const directoryBytes = getDirectoryBytes(publishDirectory);
  normalizeModificationTimes(publishDirectory);
  rmSync(archivePath, { force: true });
  const archiveArguments = platform === "win32"
    ? ["-a", "-c", "-f", archivePath, "-C", publishDirectory, "."]
    : ["-czf", archivePath, "-C", publishDirectory, "."];
  const archive = spawnSync("tar", archiveArguments, { cwd: repositoryRoot, encoding: "utf8" });
  if (archive.error || archive.status !== 0 || !existsSync(archivePath)) {
    const details = archive.error?.message || archive.stderr.trim() || "archive command failed";
    return { mode: mode.name, status: "archive-failed", directoryBytes, details, smokeResult };
  }
  const compressedBytes = statSync(archivePath).size;

  return {
    mode: mode.name,
    status: "passed",
    directoryBytes,
    compressedBytes,
    smokeResult,
  };
}

function getDirectoryBytes(directory) {
  return readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const entryPath = path.join(directory, entry.name);
    return total + (entry.isDirectory() ? getDirectoryBytes(entryPath) : statSync(entryPath).size);
  }, 0);
}

function normalizeModificationTimes(directory) {
  const timestamp = new Date("2000-01-01T00:00:00Z");
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) normalizeModificationTimes(entryPath);
    utimesSync(entryPath, timestamp, timestamp);
  }
  utimesSync(directory, timestamp, timestamp);
}

function getRuntimeIdentifier() {
  const architecture = arch === "arm64" ? "arm64" : "x64";
  if (platform === "win32") return `win-${architecture}`;
  if (platform === "darwin") return `osx-${architecture}`;
  if (platform === "linux") return `linux-${architecture}`;
  throw new Error(`Unsupported packaging probe platform: ${platform}/${arch}`);
}
