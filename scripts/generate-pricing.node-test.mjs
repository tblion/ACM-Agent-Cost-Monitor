// Tests pricing catalog generation without modifying embedded release data.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import * as pricingGenerator from "./generate-pricing.mjs";
import { writeCatalogAtomically } from "./generate-pricing.mjs";
import { runPricingValidator } from "./release-pricing.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const generator = join(root, "scripts", "generate-pricing.mjs");
const release = join(root, "scripts", "release-pricing.mjs");

test("builds a PowerShell atomic replacement invocation without interpolating paths", () => {
  const source = "C:\\Runner Temp\\catalog.tmp";
  const destination = "C:\\Runner Temp\\pricing.json";
  const invocation = pricingGenerator.windowsReplacementInvocation(source, destination, { PATH: "C:\\Windows" });

  assert.equal(invocation.command, "powershell.exe");
  assert.deepEqual(invocation.args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-Command"]);
  assert.match(invocation.args[3], /\[System\.IO\.File\]::Replace/);
  assert.match(invocation.args[3], /\[System\.IO\.File\]::Move/);
  assert.equal(invocation.environment.ACM_CATALOG_SOURCE, source);
  assert.equal(invocation.environment.ACM_CATALOG_DESTINATION, destination);
});

test("removes empty signing variables before launching electron-builder", async () => {
  const environmentModule = await import("./electron-builder-environment.mjs").catch(() => ({}));
  assert.equal(typeof environmentModule.prepareElectronBuilderEnvironment, "function");

  const environment = environmentModule.prepareElectronBuilderEnvironment({
    PATH: "/usr/bin",
    CSC_LINK: "",
    CSC_KEY_PASSWORD: "",
    CSC_NAME: "",
    WIN_CSC_LINK: "",
    APPLE_ID: "",
    APPLE_APP_SPECIFIC_PASSWORD: "",
    APPLE_TEAM_ID: "",
  });

  assert.equal(environment.PATH, "/usr/bin");
  assert.equal(environment.CSC_LINK, undefined);
  assert.equal(environment.CSC_KEY_PASSWORD, undefined);
  assert.equal(environment.CSC_NAME, undefined);
  assert.equal(environment.WIN_CSC_LINK, undefined);
  assert.equal(environment.APPLE_ID, undefined);
  assert.equal(environment.APPLE_APP_SPECIFIC_PASSWORD, undefined);
  assert.equal(environment.APPLE_TEAM_ID, undefined);
  assert.equal(environment.CSC_IDENTITY_AUTO_DISCOVERY, "false");
});

test("publishes stable tags as stable releases and prerelease tags as prereleases", async () => {
  const publicationModule = await import("./release-publication.mjs").catch(() => ({}));
  assert.equal(typeof publicationModule.createReleaseArguments, "function");

  const stable = publicationModule.createReleaseArguments("v1.0.0", ["app.deb"], "owner/repo");
  const prerelease = publicationModule.createReleaseArguments("v1.1.0-beta.1", ["app.deb"], "owner/repo");
  assert.equal(stable.includes("--prerelease"), false);
  assert.equal(prerelease.includes("--prerelease"), true);
});

async function withTempDirectory(callback) {
  const directory = await mkdtemp(join(tmpdir(), "opencode-pricing-"));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("rejects an unavailable source without replacing the existing catalog", async () => {
  await withTempDirectory(async (directory) => {
    const output = join(directory, "pricing.json");
    await writeFile(output, "known-valid-catalog\n");

    const result = spawnSync(process.execPath, [generator, "--source", join(directory, "missing.json"), "--output", output], {
      cwd: root,
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cannot read pricing source/i);
    assert.equal(await readFile(output, "utf8"), "known-valid-catalog\n");
  });
});

test("rejects unknown and duplicate command options", () => {
  const unknown = spawnSync(process.execPath, [generator, "--unexpected", "value"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /unknown option '--unexpected'/i);

  const duplicate = spawnSync(process.execPath, [generator, "--source", "one.json", "--source", "two.json"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /duplicate option '--source'/i);
});

test("normalizes a declared local source into a generated catalog", async () => {
  await withTempDirectory(async (directory) => {
    const source = join(directory, "source.json");
    const output = join(directory, "pricing.json");
    await writeFile(source, JSON.stringify({
      sourceVersion: "local-fixture-1",
      rates: [{
        provider: " openai ",
        model: " gpt-test ",
        effectiveFrom: "2026-01-01T00:00:00Z",
        input: 1,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        source: "local-fixture",
      }],
    }));

    const result = spawnSync(process.execPath, [generator, "--source", source, "--output", output], {
      cwd: root,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    const catalog = JSON.parse(await readFile(output, "utf8"));
    assert.equal(catalog.version, 1);
    assert.equal(catalog.sourceVersion, "local-fixture-1");
    assert.match(catalog.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(catalog.rates[0].provider, "openai");
    assert.equal(catalog.rates[0].model, "gpt-test");
  });
});

test("rejects RFC3339 dates with incomplete time components", async () => {
  for (const effectiveFrom of ["2026-01-01Z", "2026-01-01T00:00Z"]) {
    await withTempDirectory(async (directory) => {
      const source = join(directory, "source.json");
      const output = join(directory, "pricing.json");
      await writeFile(output, "known-valid-catalog\n");
      await writeFile(source, JSON.stringify({
        sourceVersion: "invalid-date-fixture",
        rates: [{
          provider: "openai",
          model: "gpt-test",
          effectiveFrom,
          input: 1,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
          source: "local-fixture",
        }],
      }));

      const result = spawnSync(process.execPath, [generator, "--source", source, "--output", output], {
        cwd: root,
        encoding: "utf8",
      });

      assert.notEqual(result.status, 0, effectiveFrom);
      assert.match(result.stderr, /RFC3339 UTC date/i, effectiveFrom);
      assert.equal(await readFile(output, "utf8"), "known-valid-catalog\n");
    });
  }
});

test("rejects February 29 in a non-leap year below 100", async () => {
  await withTempDirectory(async (directory) => {
    const source = join(directory, "source.json");
    const output = join(directory, "pricing.json");
    await writeFile(output, "known-valid-catalog\n");
    await writeFile(source, JSON.stringify({
      sourceVersion: "invalid-date-fixture",
      rates: [{
        provider: "openai",
        model: "gpt-test",
        effectiveFrom: "0100-02-29T00:00:00Z",
        input: 1,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        source: "local-fixture",
      }],
    }));

    const result = spawnSync(process.execPath, [generator, "--source", source, "--output", output], {
      cwd: root,
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /RFC3339 UTC date/i);
    assert.equal(await readFile(output, "utf8"), "known-valid-catalog\n");
  });
});

test("rejects effectiveFrom fractions more precise than milliseconds", async () => {
  await withTempDirectory(async (directory) => {
    const source = join(directory, "source.json");
    const output = join(directory, "pricing.json");
    await writeFile(output, "known-valid-catalog\n");
    await writeFile(source, JSON.stringify({
      sourceVersion: "invalid-precision-fixture",
      rates: [{
        provider: "openai",
        model: "gpt-test",
        effectiveFrom: "2026-01-01T00:00:00.9999Z",
        input: 1,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        source: "local-fixture",
      }],
    }));

    const result = spawnSync(process.execPath, [generator, "--source", source, "--output", output], {
      cwd: root,
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /at most 3 fractional second digits/i);
    assert.equal(await readFile(output, "utf8"), "known-valid-catalog\n");
  });
});

test("reports release validator launch and exit errors", async () => {
  await withTempDirectory(async (directory) => {
    assert.throws(
      () => runPricingValidator(join(directory, "catalog.json"), {
        command: join(directory, "missing-validator"),
      }),
      /cannot launch .NET pricing validator/,
    );

    assert.throws(
      () => runPricingValidator(join(directory, "catalog.json"), {
        command: process.execPath,
        args: ["-e", "process.exit(7)"],
      }),
      /exited with code 7/,
    );
  });
});

test("release command preserves the catalog when source loading fails", async () => {
  const catalogPath = join(root, "src-dotnet", "Resources", "pricing.json");
  const before = await readFile(catalogPath, "utf8");
  const result = spawnSync(process.execPath, [release, "--source", join(root, "missing-pricing-source.json")], {
    cwd: root,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot read pricing source/i);
  assert.equal(await readFile(catalogPath, "utf8"), before);
});

test("release command rejects an output override", () => {
  const result = spawnSync(process.execPath, [release, "--output", "other-catalog.json"], {
    cwd: root,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not accept '--output'/i);
});

test("the .NET pricing validator accepts valid catalogs and rejects invalid catalogs", async () => {
  await withTempDirectory(async (directory) => {
    const validatorProject = join(root, "src-dotnet", "OpencodeCostsViewer.Backend.csproj");
    const validCatalog = join(root, "src-dotnet", "Resources", "pricing.json");
    const invalidCatalog = join(directory, "invalid-pricing.json");
    await writeFile(invalidCatalog, "not JSON");

    const runValidator = (catalogPath) => spawnSync("dotnet", [
      "run",
      "--project",
      validatorProject,
      "--configuration",
      "Release",
      "--",
      "--validate-pricing",
      catalogPath,
    ], { cwd: root, encoding: "utf8" });

    const valid = runValidator(validCatalog);
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /pricing catalog is valid/i);

    const invalid = runValidator(invalidCatalog);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /invalid pricing catalog/i);
  });
});

test("atomic replacement removes its temporary file after replacement failure", async () => {
  await withTempDirectory(async (directory) => {
    const destination = join(directory, "catalog.json");
    await mkdir(destination);

    await assert.rejects(
      writeCatalogAtomically({ version: 1 }, destination),
    );

    assert.deepEqual(await readdir(directory), ["catalog.json"]);
  });
});
