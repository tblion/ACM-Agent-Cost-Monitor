// Runs a child process and terminates it if the configured watchdog expires.
import { spawn } from "node:child_process";

const ownerPid = Number(process.argv[2]);
const targetPid = Number(process.argv[3]);
if (!ownerPid || !targetPid) process.exit(2);

function stopTarget() {
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(targetPid), "/T", "/F"], { stdio: "ignore" });
    killer.once("exit", () => process.exit(0));
    killer.once("error", () => process.exit(0));
    return;
  }
  try { process.kill(-targetPid, "SIGTERM"); } catch { /* Le groupe est déjà arrêté. */ }
  setTimeout(() => {
    try { process.kill(-targetPid, "SIGKILL"); } catch { /* Le groupe est déjà arrêté. */ }
    process.exit(0);
  }, 250);
}

const timer = setInterval(() => {
  try { process.kill(ownerPid, 0); } catch { clearInterval(timer); stopTarget(); }
}, 100);
