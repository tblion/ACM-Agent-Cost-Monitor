// Prepares and validates the pricing catalog used for a release.
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateCatalogFile, writeCatalogAtomically, parseArguments } from "./generate-pricing.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = join(root, "src-dotnet", "Resources", "pricing.json");

export function runPricingValidator(catalogPath, {
  cwd = root,
  command = "dotnet",
  args = [
    "run",
    "--project",
    join(root, "src-dotnet", "OpencodeCostsViewer.Backend.csproj"),
    "--configuration",
    "Release",
    "--",
    "--validate-pricing",
  ],
} = {}) {
  const validation = spawnSync(command, [...args, catalogPath], {
    cwd,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (validation.error) {
    throw new Error(`cannot launch .NET pricing validator '${command}': ${validation.error.message}`);
  }
  if (validation.status !== 0) {
    throw new Error(`.NET pricing validator '${command}' exited with code ${validation.status}`);
  }
  return validation;
}

export async function preparePricing(source) {
  const temporary = `${catalog}.${process.pid}.${randomUUID()}.release.tmp`;
  try {
    await generateCatalogFile(source, temporary);
    runPricingValidator(temporary);
    await writeCatalogAtomically(JSON.parse(await readFile(temporary, "utf8")), catalog);
    console.log(`validated pricing catalog: ${catalog}`);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.includes("--output")) {
    throw new Error("release-pricing does not accept '--output'; the release catalog destination is fixed");
  }
  const { source } = parseArguments(argumentsList);
  await preparePricing(source);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`release pricing preparation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
