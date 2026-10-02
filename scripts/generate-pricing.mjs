import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultSource = join(root, "src-dotnet", "Resources", "pricing-source.json");
const defaultOutput = join(root, "src-dotnet", "Resources", "pricing.json");

export function parseArguments(argumentsList) {
  const argumentsMap = new Map();
  const allowedArguments = new Set(["--source", "--output"]);
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!allowedArguments.has(argument)) {
      throw new Error(`unknown option '${argument}'`);
    }
    if (argumentsMap.has(argument)) {
      throw new Error(`duplicate option '${argument}'`);
    }
    if (index + 1 >= argumentsList.length || argumentsList[index + 1].startsWith("--")) {
      throw new Error(`missing value for option '${argument}'`);
    }
    argumentsMap.set(argument, argumentsList[index + 1]);
    index += 1;
  }
  return {
    source: resolve(argumentsMap.get("--source") ?? defaultSource),
    output: resolve(argumentsMap.get("--output") ?? defaultOutput),
  };
}

function requireText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

const RFC3339_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function parseUtcDate(value, field) {
  const date = requireText(value, field);
  const match = RFC3339_UTC.exec(date);
  if (!match) {
    throw new Error(`${field} must be an unambiguous RFC3339 UTC date ending in Z`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText] = match;
  if (fractionText && fractionText.length > 3) {
    throw new Error(`${field} must have at most 3 fractional second digits`);
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = DAYS_IN_MONTH[month - 1] + (month === 2 && leapYear ? 1 : 0);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth
    || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`${field} must be an unambiguous RFC3339 UTC date ending in Z`);
  }
  return { year, month, day, hour, minute, second, fraction: (fractionText ?? "").replace(/0+$/, "") };
}

function requireDate(value, field) {
  const date = requireText(value, field);
  parseUtcDate(date, field);
  return date;
}

function compareUtcDates(left, right) {
  const leftDate = parseUtcDate(left, "effectiveFrom");
  const rightDate = parseUtcDate(right, "effectiveFrom");
  for (const field of ["year", "month", "day", "hour", "minute", "second"]) {
    if (leftDate[field] !== rightDate[field]) return leftDate[field] - rightDate[field];
  }
  const fractionLength = Math.max(leftDate.fraction.length, rightDate.fraction.length);
  return leftDate.fraction.padEnd(fractionLength, "0").localeCompare(
    rightDate.fraction.padEnd(fractionLength, "0"),
  );
}

function requirePrice(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative number`);
  }
  return value;
}

export function normalizeSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("pricing source must be a JSON object");
  }
  const sourceVersion = requireText(source.sourceVersion, "sourceVersion");
  if (!Array.isArray(source.rates) || source.rates.length === 0) {
    throw new Error("pricing source rates must not be empty");
  }

  const rates = source.rates.map((rate, index) => {
    if (!rate || typeof rate !== "object" || Array.isArray(rate)) {
      throw new Error(`rates[${index}] must be an object`);
    }
    return {
      provider: requireText(rate.provider, `rates[${index}].provider`),
      model: requireText(rate.model, `rates[${index}].model`),
      effectiveFrom: requireDate(rate.effectiveFrom, `rates[${index}].effectiveFrom`),
      input: requirePrice(rate.input, `rates[${index}].input`),
      output: requirePrice(rate.output, `rates[${index}].output`),
      cacheRead: requirePrice(rate.cacheRead, `rates[${index}].cacheRead`),
      cacheWrite: requirePrice(rate.cacheWrite, `rates[${index}].cacheWrite`),
      source: requireText(rate.source, `rates[${index}].source`),
    };
  });

  rates.sort((left, right) => left.provider.localeCompare(right.provider)
    || left.model.localeCompare(right.model)
    || compareUtcDates(left.effectiveFrom, right.effectiveFrom));
  for (let index = 1; index < rates.length; index += 1) {
    const previous = rates[index - 1];
    const current = rates[index];
    if (previous.provider === current.provider
      && previous.model === current.model
      && compareUtcDates(previous.effectiveFrom, current.effectiveFrom) === 0) {
      throw new Error(`duplicate effectiveFrom for provider '${current.provider}' and model '${current.model}'`);
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceVersion,
    rates,
  };
}

export async function writeCatalogAtomically(catalog, output) {
  const destination = resolve(output);
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, { flag: "wx" });
    const handle = await open(temporary, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (process.platform === "win32") {
      // `move` utilise le remplacement du volume Windows, contrairement à fs.rename sur une destination existante.
      const { spawnSync } = await import("node:child_process");
      const result = spawnSync("cmd.exe", ["/d", "/s", "/c", `move /Y "${temporary}" "${destination}"`], { encoding: "utf8" });
      if (result.error) {
        throw new Error(`cannot launch Windows atomic replacement: ${result.error.message}`);
      }
      if (result.status !== 0) {
        throw new Error(`Windows atomic replacement exited with code ${result.status}: ${result.stderr || "unknown error"}`);
      }
    } else {
      await rename(temporary, destination);
    }
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function generateCatalogFile(sourcePath, outputPath) {
  let contents;
  try {
    contents = await readFile(sourcePath, "utf8");
  } catch (error) {
    throw new Error(`cannot read pricing source '${sourcePath}': ${error.message}`);
  }
  let source;
  try {
    source = JSON.parse(contents);
  } catch (error) {
    throw new Error(`cannot parse pricing source '${sourcePath}': ${error.message}`);
  }
  await writeCatalogAtomically(normalizeSource(source), outputPath);
}

async function main() {
  const { source, output } = parseArguments(process.argv.slice(2));
  await generateCatalogFile(source, output);
  console.log(`generated pricing catalog: ${output}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`pricing generation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
