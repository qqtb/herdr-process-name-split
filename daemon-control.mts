import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export function getStateDir(): string {
  return (
    process.env.HERDR_PLUGIN_STATE_DIR ||
    path.join(os.homedir(), ".local", "state", "herdr", "plugins", "process-name-split")
  );
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readDaemonPid(): number | null {
  try {
    const pid = Number.parseInt(
      fs.readFileSync(path.join(getStateDir(), "daemon.pid"), "utf8").trim(),
      10
    );
    return isPidAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** Start the detached watcher if it is not already running. */
export function startDaemon(): void {
  if (readDaemonPid() !== null) return;

  const stateDir = getStateDir();
  const pidFile = path.join(stateDir, "daemon.pid");
  const lockFile = path.join(stateDir, "daemon.start.lock");
  fs.mkdirSync(stateDir, { recursive: true });

  let lock: number;
  try {
    lock = fs.openSync(lockFile, "wx");
  } catch {
    // Another event hook is starting the watcher right now.
    return;
  }

  try {
    if (readDaemonPid() !== null) return;

    const scriptPath = path.join(import.meta.dirname, "daemon.mts");
    const child = spawn(process.execPath, [scriptPath, "run"], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });

    if (child.pid) fs.writeFileSync(pidFile, `${child.pid}\n`);
    child.on("error", () => {
      try {
        fs.unlinkSync(pidFile);
      } catch {
        // Already removed or replaced.
      }
    });
    child.unref();
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockFile);
  }
}
