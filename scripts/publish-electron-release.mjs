import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = path.resolve(process.argv[2] ?? path.join(root, "release-assets"));
const tag = process.env.RELEASE_TAG;
const repository = process.env.GITHUB_REPOSITORY;
if (!tag || !repository) throw new Error("RELEASE_TAG and GITHUB_REPOSITORY are required.");
const version = tag.replace(/^v/, "");

const installers = await collectInstallers(artifactRoot);
const filesWithoutVersion = installers.filter(file => !path.basename(file).includes(version));
if (filesWithoutVersion.length > 0) {
  throw new Error(`Installer filename version mismatch: ${filesWithoutVersion.map(file => path.basename(file)).join(", ")}`);
}
const counts = {
  ".exe": 1,
  ".msi": 1,
  ".dmg": 2,
  ".deb": 1,
};
for (const [extension, requiredCount] of Object.entries(counts)) {
  const actualCount = installers.filter(file => path.extname(file).toLowerCase() === extension).length;
  if (actualCount !== requiredCount) {
    throw new Error(`Expected ${requiredCount} ${extension} installer(s), found ${actualCount}.`);
  }
}
const dmgNames = installers
  .filter(file => path.extname(file).toLowerCase() === ".dmg")
  .map(file => path.basename(file).toLowerCase());
const hasAppleSiliconDmg = dmgNames.filter(name => name.includes("arm64") || name.includes("aarch64")).length === 1;
const hasIntelDmg = dmgNames.filter(name => name.includes("x64") || name.includes("x86_64")).length === 1;
if (!hasAppleSiliconDmg || !hasIntelDmg) {
  throw new Error("Expected one Apple Silicon ARM64 DMG and one Intel x64 DMG.");
}

const releaseView = spawnSync("gh", ["release", "view", tag, "--repo", repository], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
});
if (releaseView.error) throw new Error(`Unable to run gh: ${releaseView.error.message}`);

if (releaseView.status === 0 && process.env.ALLOW_RELEASE_REPLACE !== "true") {
  throw new Error(`Release ${tag} already exists; set ALLOW_RELEASE_REPLACE=true for an intentional asset rebuild.`);
}

const publish = releaseView.status === 0
  ? ["release", "upload", tag, ...installers, "--repo", repository, "--clobber"]
  : ["release", "create", tag, ...installers, "--repo", repository, "--title", tag, "--generate-notes", "--prerelease"];
const result = spawnSync("gh", publish, { cwd: root, stdio: "inherit" });
if (result.error) throw new Error(`Unable to publish release assets: ${result.error.message}`);
if (result.status !== 0) throw new Error(`gh release command exited with code ${result.status}.`);

async function collectInstallers(directory) {
  const collected = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collected.push(...await collectInstallers(entryPath));
    else if ([".exe", ".msi", ".dmg", ".deb"].includes(path.extname(entry.name).toLowerCase())) {
      collected.push(entryPath);
    }
  }
  return collected.sort((left, right) => left.localeCompare(right));
}
