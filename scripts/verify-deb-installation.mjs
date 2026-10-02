import { spawnSync } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDirectory = path.join(root, "release");
const debs = (await readdir(releaseDirectory)).filter(name => name.endsWith(".deb"));
if (debs.length !== 1) throw new Error(`Expected one .deb in release/, found ${debs.length}.`);
const debPath = path.join(releaseDirectory, debs[0]);
const packageName = capture("dpkg-deb", ["-f", debPath, "Package"]).trim();
let installed = false;

try {
  run("sudo", ["apt-get", "install", "--yes", debPath]);
  installed = true;
  const packageFiles = capture("dpkg-query", ["-L", packageName]).split(/\r?\n/).filter(Boolean);
  const executableCandidates = packageFiles.filter(file => path.basename(file) === "acm-agent-cost-monitor");
  const executablePath = await findExecutable(executableCandidates);
  const desktopLaunchers = packageFiles.filter(file => file.endsWith(".desktop"));
  if (desktopLaunchers.length !== 1) {
    throw new Error(`Expected one .desktop launcher, found ${desktopLaunchers.length}.`);
  }

  await runPackagedE2e(executablePath);
  run("sudo", ["apt-get", "install", "--yes", "--reinstall", debPath]);
  await runPackagedE2e(executablePath);

  run("sudo", ["dpkg", "--remove", packageName]);
  installed = false;
  if (packageFiles.some(file => file.endsWith(".desktop") && existsSync(file))) {
    throw new Error("Debian uninstall left a desktop launcher behind.");
  }
  if (existsSync(executablePath)) throw new Error("Debian uninstall left the application executable behind.");
} finally {
  if (installed) run("sudo", ["dpkg", "--remove", packageName]);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: "inherit" });
  if (result.error) throw new Error(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status}.`);
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.error) throw new Error(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status}: ${result.stderr}`);
  return result.stdout;
}

async function findExecutable(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("Installed acm-agent-cost-monitor executable was not found in the Debian package file list.");
}

async function runPackagedE2e(executablePath) {
  const result = spawnSync(process.execPath, [path.join(root, "e2e", "run-playwright.mjs")], {
    cwd: root,
    env: { ...process.env, E2E_ELECTRON: "true", ELECTRON_EXECUTABLE_PATH: executablePath },
    stdio: "inherit",
  });
  if (result.error) throw new Error(`Packaged Electron E2E failed to start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Packaged Electron E2E exited with code ${result.status}.`);
}
