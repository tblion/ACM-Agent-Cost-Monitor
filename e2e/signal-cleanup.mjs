import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { spawn } from "node:child_process";

if (process.platform === "win32") process.exit(0);

const execFileAsync = promisify(execFile);
const runner = spawn(process.execPath, ["e2e/run-playwright.mjs"], { stdio: "inherit" });

async function descendants(rootPid) {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid="]);
  const children = new Map();
  for (const line of stdout.split("\n")) {
    const [pid, parentPid] = line.trim().split(/\s+/).map(Number);
    if (pid && parentPid) children.set(parentPid, [...(children.get(parentPid) ?? []), pid]);
  }
  const result = [];
  const queue = [rootPid];
  while (queue.length) {
    const parent = queue.shift();
    for (const child of children.get(parent) ?? []) {
      result.push(child);
      queue.push(child);
    }
  }
  return result;
}

const deadline = Date.now() + 10_000;
let before = [];
while (Date.now() < deadline && before.length < 2) {
  await new Promise(resolve => setTimeout(resolve, 250));
  before = await descendants(runner.pid);
}
if (before.length < 2) {
  runner.kill("SIGTERM");
  throw new Error("The E2E launcher did not create its child process tree");
}

runner.kill("SIGTERM");
const [code, signal] = await new Promise(resolve => runner.once("exit", (exitCode, exitSignal) => resolve([exitCode, exitSignal])));
if (!((code === 143 && signal === null) || (code === null && signal === "SIGTERM"))) throw new Error(`Unexpected launcher termination: code=${code} signal=${signal}`);
await new Promise(resolve => setTimeout(resolve, 500));
const remaining = await descendants(runner.pid).catch(() => []);
if (remaining.length > 0) throw new Error(`Orphan E2E descendants remain: ${remaining.join(", ")}`);
