// Starts the browser mock server with isolated temporary OpenCode fixtures.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const fixtureId = "e2e-sql-v1";
const expectedSha256 = "1d13c18eea6954042b94b859a65a41d5ff4d42fb569ddcb419f1fad75bd8f74e";
const sourcePath = path.resolve("e2e/fixtures/opencode-fixture.sql");
const source = await readFile(sourcePath, "utf8");
const sourceSha256 = createHash("sha256").update(source).digest("hex");
if (sourceSha256 !== expectedSha256) throw new Error(`E2E SQL fixture hash changed: ${sourceSha256}`);
if (!source.includes(`fixture-id: ${fixtureId}`) || source.includes("opencode.db")) throw new Error("Invalid isolated E2E SQL fixture");

let isolatedDirectory;
let primaryDatabase;
let alternateDatabase;
let controlServer;
let child;
let childPidFile;
let watchdog;
let cleanupPromise;
let stopping = false;
const launcherParentPid = process.ppid;
const parentMonitor = setInterval(() => {
  if (launcherParentPid !== 1 && process.ppid === 1) stopFromSignal("SIGTERM");
}, 250);

function signalExitCode(signal) {
  return signal === "SIGINT" ? 130 : 143;
}

async function terminateChild(signal) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    await new Promise(resolve => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      killer.once("exit", resolve);
      killer.once("error", resolve);
    });
  } else if (child.pid) {
    try { process.kill(-child.pid, signal); } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  if (child.exitCode === null && child.signalCode === null) {
    await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 5_000))]);
  }
}

function cleanup({ terminate = false, signal = "SIGTERM" } = {}) {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    clearInterval(parentMonitor);
    if (terminate) await terminateChild(signal);
    if (watchdog && watchdog.exitCode === null && watchdog.signalCode === null) watchdog.kill("SIGTERM");
    if (controlServer) await new Promise(resolve => controlServer.close(() => resolve()));
    primaryDatabase?.close();
    alternateDatabase?.close();
    if (isolatedDirectory) await rm(isolatedDirectory, { recursive: true, force: true });
  })();
  return cleanupPromise;
}

function stopFromSignal(signal, exitCode = signalExitCode(signal)) {
  if (stopping) return;
  stopping = true;
  void cleanup({ terminate: true, signal }).finally(() => process.exit(exitCode));
}

process.once("SIGINT", () => stopFromSignal("SIGINT"));
process.once("SIGTERM", () => stopFromSignal("SIGTERM"));

try {
  isolatedDirectory = await mkdtemp(path.join(os.tmpdir(), "acm-agent-cost-monitor-e2e-"));
const isolatedSqlPath = path.join(isolatedDirectory, "fixture.sql");
const alternateSqlPath = path.join(isolatedDirectory, "alternate-fixture.sql");
const primaryDatabasePath = path.join(isolatedDirectory, "primary.sqlite");
const alternateDatabasePath = path.join(isolatedDirectory, "alternate.sqlite");
const manifestPath = path.join(isolatedDirectory, "manifest.json");
const snapshotPath = path.join(isolatedDirectory, "snapshot.json");
const alternateSnapshotPath = path.join(isolatedDirectory, "alternate-snapshot.json");
const appPort = Number(process.env.E2E_PORT ?? 1422);
await writeFile(isolatedSqlPath, source, "utf8");
await writeFile(alternateSqlPath, source, "utf8");

const sqlModulePath = fileURLToPath(await import.meta.resolve("sql.js"));
const SQL = await initSqlJs({ locateFile: file => path.join(path.dirname(sqlModulePath), file) });
primaryDatabase = new SQL.Database();
alternateDatabase = new SQL.Database();
primaryDatabase.run(source);
alternateDatabase.run(source);
alternateDatabase.run(`INSERT INTO session_fixture (id, title, project, created_at, cost, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens)
  VALUES ('alternate', 'Alternate SQLite fixture session', '/fixtures/alternate', '2026-09-27T12:00:00Z', 8.9, 800, 160, 20, 3, 2)`);

function snapshotFromDatabase(database) {
  const query = database.exec(`
    SELECT id, title, project, created_at, cost, input_tokens, output_tokens,
           cache_read_tokens, cache_write_tokens, reasoning_tokens
    FROM session_fixture
    ORDER BY id
  `);
  if (query.length !== 1) throw new Error("E2E SQL fixture query returned no session table");
  const [table] = query;
  return table.values.map(values => {
    const row = Object.fromEntries(table.columns.map((column, index) => [column, values[index]]));
    const tokens = {
      input: row.input_tokens,
      output: row.output_tokens,
      cacheRead: row.cache_read_tokens,
      cacheWrite: row.cache_write_tokens,
      reasoning: row.reasoning_tokens,
    };
    return {
      id: row.id,
      title: row.title,
      project: row.project,
      date: Date.parse(row.created_at),
      cost: row.cost,
      tokens,
      isSubagent: false,
      parentId: null,
      source: "configured",
      models: [{ provider: "fixture", model: "fixture-model", cost: row.cost, tokens, source: "configured" }],
      messages: [{ date: Date.parse(row.created_at), provider: "fixture", model: "fixture-model", cost: row.cost, tokens, source: "configured" }],
    };
  });
}

const primarySnapshot = { sessions: snapshotFromDatabase(primaryDatabase), rates: [], costSummary: [] };
const alternateSnapshot = { sessions: snapshotFromDatabase(alternateDatabase), rates: [], costSummary: [] };
const boundary = primarySnapshot.sessions.find(session => session.id === "today" && session.title === "Boundary fixture session");
const outside = primarySnapshot.sessions.find(session => session.id === "outside");
if (!boundary || !outside) throw new Error("E2E SQL fixture is missing required sessions");
const firstMessageTokens = Object.fromEntries(Object.entries(boundary.tokens).map(([key, value]) => [key, Math.floor(value / 2)]));
const secondMessageTokens = Object.fromEntries(Object.entries(boundary.tokens).map(([key, value]) => [key, value - firstMessageTokens[key]]));
boundary.messages = [
  { date: boundary.date, provider: "fixture", model: "fixture-model", cost: boundary.cost / 2, tokens: firstMessageTokens, source: "configured" },
  { date: boundary.date + 24 * 60 * 60 * 1000, provider: "fixture", model: "fixture-model", cost: boundary.cost - boundary.cost / 2, tokens: secondMessageTokens, source: "configured" },
];
await writeFile(primaryDatabasePath, Buffer.from(primaryDatabase.export()));
await writeFile(alternateDatabasePath, Buffer.from(alternateDatabase.export()));
await writeFile(snapshotPath, JSON.stringify(primarySnapshot, null, 2), "utf8");
await writeFile(alternateSnapshotPath, JSON.stringify(alternateSnapshot, null, 2), "utf8");
await writeFile(manifestPath, JSON.stringify({
  fixtureId, sourcePath, isolatedSqlPath, alternateSqlPath, primaryDatabasePath, alternateDatabasePath,
  sourceSha256, manifestPath, snapshotPath, alternateSnapshotPath,
  boundaryTitle: boundary.title, outsideTitle: outside.title,
  boundaryDate: new Date(boundary.date).toISOString(), boundaryCost: boundary.cost,
}, null, 2), "utf8");

const controlPort = 0;
controlServer = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Access-Control-Allow-Origin", `http://127.0.0.1:${appPort}`);
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }
  try {
    if (request.method === "POST" && request.url === "/mutate-live") {
      primaryDatabase.run(`INSERT INTO session_fixture (id, title, project, created_at, cost, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens)
        VALUES ('live-sql', 'Live SQL inserted session', '/fixtures/live', '2026-09-27T13:00:00Z', 3.21, 111, 22, 3, 1, 2)`);
      const snapshot = { sessions: snapshotFromDatabase(primaryDatabase), rates: [], costSummary: [] };
      await writeFile(primaryDatabasePath, Buffer.from(primaryDatabase.export()));
      await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");
      response.end(JSON.stringify(snapshot));
      return;
    }
    if (request.method === "GET" && request.url === "/snapshot?database=alternate") {
      response.end(JSON.stringify(alternateSnapshot));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "unknown E2E control operation" }));
  } catch (error) {
    response.statusCode = 500;
    response.end(JSON.stringify({ error: String(error) }));
  }
});
await new Promise((resolve, reject) => {
  controlServer.once("error", reject);
  controlServer.listen(controlPort, "127.0.0.1", resolve);
});
const controlAddress = controlServer.address();
if (!controlAddress || typeof controlAddress === "string") throw new Error("Unable to reserve E2E control port");
child = spawn("npm", ["run", "dev:mock", "--", "--host", "127.0.0.1", "--port", String(appPort)], {
  detached: process.platform !== "win32",
  env: {
    ...process.env,
    VITE_E2E: "true",
    VITE_E2E_FIXTURE_ID: fixtureId,
    VITE_E2E_FIXTURE_SHA256: sourceSha256,
    VITE_E2E_FIXTURE_SQL_PATH: isolatedSqlPath,
    VITE_E2E_FIXTURE_MANIFEST_PATH: manifestPath,
    VITE_E2E_FIXTURE_SNAPSHOT_PATH: snapshotPath,
    VITE_E2E_FIXTURE_ALTERNATE_SNAPSHOT_PATH: alternateSnapshotPath,
    VITE_E2E_CONTROL_URL: `http://127.0.0.1:${controlAddress.port}`,
    VITE_E2E_FIXTURE_SNAPSHOT: JSON.stringify(primarySnapshot),
  },
  stdio: "inherit",
});
childPidFile = process.env.E2E_CHILD_PID_FILE;
if (childPidFile) await writeFile(childPidFile, String(child.pid), "utf8");
watchdog = spawn(process.execPath, ["e2e/process-watchdog.mjs", String(process.pid), String(child.pid)], {
  detached: true,
  stdio: "ignore",
});
watchdog.unref();

child.once("error", error => {
  console.error(error);
  stopFromSignal("SIGTERM", 1);
});
child.once("exit", async (code, signal) => {
  if (stopping) return;
  stopping = true;
  await cleanup({ terminate: true, signal: "SIGTERM" });
  process.exit(code ?? (signal ? 1 : 0));
});
} catch (error) {
  console.error(error);
  await cleanup();
  process.exit(1);
}
