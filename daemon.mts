#!/usr/bin/env node
// Process Name Split Daemon: background event watcher and poller.
// Ensures pane labels update promptly when commands start, run, or finish.

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { getStateDir, isPidAlive, startDaemon } from "./daemon-control.mts";
import { sync } from "./sync.mts";

const DEFAULT_SOCKET_PATH = path.join(os.homedir(), ".config", "herdr", "herdr.sock");
const SOCKET_PATH = process.env.HERDR_SOCKET_PATH || DEFAULT_SOCKET_PATH;

export { startDaemon };

export function stopDaemon(): void {
  const pidFile = path.join(getStateDir(), "daemon.pid");
  try {
    const pid = Number.parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
    if (isPidAlive(pid)) process.kill(pid, "SIGTERM");
  } catch {
    // The watcher is not running.
  } finally {
    try {
      fs.unlinkSync(pidFile);
    } catch {
      // Already removed.
    }
  }
}

function runDaemon(): void {
  const stateDir = getStateDir();
  const pidFile = path.join(stateDir, "daemon.pid");

  fs.mkdirSync(stateDir, { recursive: true });
  try {
    const existingPid = Number.parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
    if (existingPid !== process.pid && isPidAlive(existingPid)) return;
  } catch {
    // No existing watcher.
  }
  fs.writeFileSync(pidFile, `${process.pid}\n`);

  const removeOwnPidFile = () => {
    try {
      const pid = Number.parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
      if (pid === process.pid) fs.unlinkSync(pidFile);
    } catch {
      // Already removed or replaced.
    }
  };
  const shutdown = () => {
    removeOwnPidFile();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", shutdown);
  process.on("exit", removeOwnPidFile);

  let syncing = false;
  const triggerSync = () => {
    if (syncing) return;
    syncing = true;
    try {
      sync();
    } catch {
      // The server can briefly be unavailable while starting or handing off.
    } finally {
      syncing = false;
    }
  };

  let debounceTimer: NodeJS.Timeout | null = null;
  const triggerDebouncedSync = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(triggerSync, 40);
  };

  triggerDebouncedSync();

  // Herdr does not currently emit a process-start/process-exit event. Polling
  // fills that gap; socket events still make focus/layout changes immediate.
  const pollInterval = setInterval(triggerSync, 300);

  let reconnectAttempts = 0;
  const maxReconnectAttempts = 10;

  function reconnect(): void {
    reconnectAttempts += 1;
    if (reconnectAttempts > maxReconnectAttempts) {
      clearInterval(pollInterval);
      shutdown();
    } else {
      setTimeout(connectSocket, 1000);
    }
  }

  function connectSocket(): void {
    // Connect directly: HERDR_SOCKET_PATH is a Unix socket on macOS/Linux and
    // a named pipe on Windows, where existsSync() is not a reliable probe.
    const client = net.createConnection(SOCKET_PATH, () => {
      reconnectAttempts = 0;
      client.write(`${JSON.stringify({
        id: "process_name_split",
        method: "events.subscribe",
        params: {
          subscriptions: [
            { type: "pane.updated" },
            { type: "pane.focused" },
            { type: "tab.focused" },
            { type: "layout.updated" },
            { type: "pane.created" },
            { type: "pane.closed" },
            { type: "pane.exited" },
            { type: "workspace.focused" },
          ],
        },
      })}\n`);
    });

    client.on("data", triggerDebouncedSync);
    client.on("error", () => client.destroy());
    client.on("close", reconnect);
  }

  connectSocket();
}

function main(): void {
  const command = process.argv[2];
  if (command === "run") runDaemon();
  else if (command === "stop") stopDaemon();
  else startDaemon();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) main();
