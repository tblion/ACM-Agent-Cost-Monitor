import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { writeCatalogAtomically } from "./generate-pricing.mjs";
import { runPricingValidator } from "./release-pricing.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const generator = join(root, "scripts", "generate-pricing.mjs");
const release = join(root, "scripts", "release-pricing.mjs");

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
      /cannot launch pricing validator/,
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
  const catalogPath = join(root, "src-tauri", "catalog", "pricing.json");
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
