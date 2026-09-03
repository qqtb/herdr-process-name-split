#!/usr/bin/env node
// Process Name Split: label each pane border with its current path when idle
// or a short, informative foreground process name while a command is running.
// Legacy focused-pane tab labels remain available through configuration.
//
// Executed directly by Node.js (22.18+ / 24+) via native type stripping.
// Zero dependencies, zero build step.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { startDaemon } from "./daemon-control.mts";

export interface ProcessItem {
  pid: number;
  name?: string;
  argv0?: string;
  cmdline?: string;
  argv?: string[];
  cwd?: string;
}

export interface ProcessInfo {
  shell_pid?: number;
  foreground_process_group_id?: number;
  foreground_processes?: ProcessItem[];
  pane_id: string;
}

export interface PaneInfo {
  pane_id: string;
  tab_id: string;
  workspace_id?: string;
  focused: boolean;
  label?: string | null;
  agent?: string | null;
  agent_status?: string | null;
  terminal_title?: string | null;
  terminal_title_stripped?: string | null;
  cwd?: string | null;
  foreground_cwd?: string | null;
}

export interface TabLayoutInfo {
  tab_id: string;
  workspace_id?: string;
  focused_pane_id?: string | null;
  panes?: Array<{ pane_id: string; focused: boolean }>;
}

export interface TabInfo {
  tab_id: string;
  workspace_id?: string;
  label: string;
  number?: number;
  focused?: boolean;
}

export interface WorkspaceInfo {
  workspace_id: string;
}

export interface SnapshotResult {
  workspaces?: WorkspaceInfo[];
  tabs?: TabInfo[];
  panes?: PaneInfo[];
  layouts?: TabLayoutInfo[];
  focused_pane_id?: string | null;
}

export interface Config {
  format: string;
  target: "pane" | "tab";
  shellIdle: "dir" | "path" | "process" | "shell";
  idlePathStyle: "basename" | "relative" | "compact";
  maxLength: number;
  overwriteManual: boolean;
  includeArgs: boolean;
}

export interface ProcessResolution {
  name: string;
  isRunning: boolean;
}

export type OwnedLabels = Record<string, string>;

export const DEFAULT_LABEL = /^[0-9]+$/;

const SUBCOMMAND_TOOLS = new Set([
  "git",
  "cargo",
  "docker",
  "docker-compose",
  "podman",
  "kubectl",
  "make",
  "just",
  "rake",
  "go",
  "pip",
  "uv",
  "poetry",
  "conda",
  "brew",
  "apt",
  "dnf",
  "pacman",
  "gh",
  "aws",
  "terraform",
  "pulumi",
  "nix",
  "mix",
  "dotnet",
  "gradle",
  "mvn",
  "overmind",
]);

const RUNNERS = new Set(["npm", "pnpm", "yarn", "bun", "npx", "bunx", "deno"]);

const INTERPRETERS = new Set([
  "python",
  "python3",
  "python3.9",
  "python3.10",
  "python3.11",
  "python3.12",
  "python3.13",
  "node",
  "ruby",
  "perl",
  "php",
  "tsx",
]);

const EDITORS = new Set([
  "vim",
  "nvim",
  "vi",
  "nano",
  "emacs",
  "helix",
  "hx",
  "kak",
  "less",
  "more",
  "bat",
  "cat",
  "view",
]);

const SHELLS = new Set([
  "zsh",
  "bash",
  "sh",
  "fish",
  "dash",
  "tcsh",
  "csh",
  "ksh",
  "nu",
]);

const FLAGS_WITH_VALUE = new Set([
  "-i",
  "-p",
  "-l",
  "-F",
  "-o",
  "-u",
  "-t",
  "-f",
  "-c",
  "-e",
  "-d",
  "-s",
  "-b",
  "--config",
  "--file",
  "--profile",
  "--target",
  "--port",
  "--host",
]);

export function cleanBaseName(filePath: string): string {
  if (!filePath) return "";
  const normalized = filePath.replace(/\\/g, "/");
  const base = path.posix.basename(normalized);
  return base.replace(/^-/, "");
}

export function truncate(text: string, maxLength: number): string {
  if (maxLength > 0 && text.length > maxLength) {
    return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
  }
  return text;
}

export function formatPath(
  cwd: string | null | undefined,
  style: "basename" | "relative" | "compact" = "basename"
): string {
  if (!cwd) return "~";
  const home = os.homedir();
  if (cwd === home) return "~";

  const isInsideHome = cwd.startsWith(`${home}${path.sep}`);

  if (style === "relative") {
    if (isInsideHome) {
      return `~${cwd.slice(home.length)}`;
    }
    return cwd;
  }

  if (style === "compact") {
    let rel = cwd;
    if (isInsideHome) {
      rel = `~${cwd.slice(home.length)}`;
    }
    const parts = rel.split(path.sep).filter(Boolean);
    if (parts.length > 2) {
      return parts.slice(-2).join("/");
    }
    return rel;
  }

  // default: basename
  const base = path.basename(cwd);
  return base || cwd;
}

export function parseNonFlagArgs(rawArgs: string[]): string[] {
  const nonFlagArgs: string[] = [];
  let skipNext = false;

  for (let i = 0; i < rawArgs.length; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    const arg = rawArgs[i];
    if (arg === "-m" && i + 1 < rawArgs.length) {
      nonFlagArgs.push(`-m ${cleanBaseName(rawArgs[i + 1])}`);
      skipNext = true;
      continue;
    }
    if (FLAGS_WITH_VALUE.has(arg)) {
      skipNext = true;
      continue;
    }
    if (arg.startsWith("--") && arg.includes("=")) {
      continue;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    const clean = cleanBaseName(arg);
    if (clean) {
      nonFlagArgs.push(clean);
    }
  }

  return nonFlagArgs;
}

export function formatProcessItem(
  proc: ProcessItem,
  agent: string | null | undefined,
  includeArgs: boolean = true
): string {
  if (agent) {
    return agent;
  }

  const rawArgv0 = proc.argv0 || (proc.argv && proc.argv[0]) || proc.name || "";
  let base = cleanBaseName(rawArgv0);
  if (!base && proc.name) {
    base = cleanBaseName(proc.name);
  }
  if (!base) {
    return "shell";
  }

  if (!includeArgs) {
    return base;
  }

  const argv = proc.argv || [];
  const rawArgs = argv.slice(1);
  const nonFlagArgs = parseNonFlagArgs(rawArgs);

  // 1. Common developer tools with subcommands: git diff, cargo test, make debug-web, overmind start
  if (SUBCOMMAND_TOOLS.has(base) && nonFlagArgs.length > 0) {
    const sub = nonFlagArgs[0];
    if (base === "docker" && sub === "compose" && nonFlagArgs.length > 1) {
      return `docker compose ${nonFlagArgs[1]}`;
    }
    return `${base} ${sub}`;
  }

  // 2. Package runners: npm run dev, pnpm build, bun test
  if (RUNNERS.has(base) && nonFlagArgs.length > 0) {
    if (nonFlagArgs[0] === "run" && nonFlagArgs.length > 1) {
      return `${base} run ${nonFlagArgs[1]}`;
    }
    return `${base} ${nonFlagArgs[0]}`;
  }

  // 3. Interpreters: python train.py, node server.js, python -m unittest
  if (INTERPRETERS.has(base) && nonFlagArgs.length > 0) {
    return `${base} ${nonFlagArgs[0]}`;
  }

  // 4. Text editors: nvim index.ts, vim main.c
  if (EDITORS.has(base) && nonFlagArgs.length > 0) {
    return `${base} ${nonFlagArgs[0]}`;
  }

  // 5. Remote shell: ssh host
  if (base === "ssh" && nonFlagArgs.length > 0) {
    let target = nonFlagArgs[0];
    if (target.includes("@")) {
      target = target.split("@").pop() || target;
    }
    return `ssh ${target}`;
  }

  // 6. Generic command with a short clean argument
  if (
    nonFlagArgs.length > 0 &&
    !SHELLS.has(base) &&
    nonFlagArgs[0].length <= 16
  ) {
    return `${base} ${nonFlagArgs[0]}`;
  }

  return base;
}

export function extractProcessResolution(
  processInfo: ProcessInfo | null | undefined,
  pane: PaneInfo,
  config: Config
): ProcessResolution {
  const agent = pane.agent;
  const procs = processInfo?.foreground_processes || [];
  const shellPid = processInfo?.shell_pid;
  const fgGroupId = processInfo?.foreground_process_group_id;
  const idlePath = formatPath(pane.foreground_cwd || pane.cwd, config.idlePathStyle);

  // If an agent is detected by Herdr
  if (agent) {
    return { name: agent, isRunning: true };
  }

  // If no process info could be queried
  if (!processInfo || procs.length === 0) {
    if (pane.terminal_title_stripped && !pane.terminal_title_stripped.includes("@")) {
      return { name: truncate(pane.terminal_title_stripped, config.maxLength), isRunning: true };
    }
    return {
      name: config.shellIdle === "process" ? "shell" : idlePath,
      isRunning: false,
    };
  }

  // Only a shell is running (idle at its prompt). Some platforms can identify
  // the shell by name but do not expose shell_pid.
  if (
    procs.length === 1 &&
    (procs[0].pid === shellPid ||
      SHELLS.has(cleanBaseName(procs[0].argv0 || procs[0].name || "")))
  ) {
    if (config.shellIdle === "process") {
      return { name: formatProcessItem(procs[0], null, false), isRunning: false };
    }
    if (config.shellIdle === "shell") {
      return { name: "shell", isRunning: false };
    }
    // Default: display the current path when no process is running
    return { name: idlePath, isRunning: false };
  }

  // Filter out the shell itself
  const nonShells = procs.filter((p) => p.pid !== shellPid);
  if (nonShells.length === 0) {
    if (config.shellIdle === "process") {
      return { name: "shell", isRunning: false };
    }
    return { name: idlePath, isRunning: false };
  }

  // Find the foreground group leader or the root non-shell process
  let target = nonShells.find((p) => p.pid === fgGroupId) || nonShells[0];

  // If group leader is a wrapper shell like `sh -c` or `bash -c`, find its child if available
  const leaderBase = cleanBaseName(target.argv0 || target.name || "");
  if (SHELLS.has(leaderBase) && nonShells.length > 1) {
    const specific = nonShells.find(
      (p) => p !== target && !SHELLS.has(cleanBaseName(p.argv0 || p.name || ""))
    );
    if (specific) {
      target = specific;
    }
  }

  const name = formatProcessItem(target, agent, config.includeArgs);
  return { name, isRunning: true };
}

export function extractProcessName(
  processInfo: ProcessInfo | null | undefined,
  pane: PaneInfo,
  config: Config
): string {
  return extractProcessResolution(processInfo, pane, config).name;
}

export function formatLabel(
  resolution: ProcessResolution,
  pane: PaneInfo,
  config: Config
): string {
  const dirName = formatPath(pane.foreground_cwd || pane.cwd, "basename");
  const pathName = formatPath(pane.foreground_cwd || pane.cwd, config.idlePathStyle);
  let label: string;

  if (!resolution.isRunning && config.format.includes("{process}") && config.format.includes("{dir}")) {
    // Avoid duplicating e.g. "client: client" when idle
    label = config.format
      .replace(/\{dir\}\s*:\s*\{process\}/g, dirName)
      .replace(/\{process\}\s*\(\{dir\}\)/g, dirName)
      .replace(/\{process\}/g, pathName)
      .replace(/\{dir\}/g, dirName)
      .replace(/\{path\}/g, pathName)
      .replace(/\{pane_id\}/g, pane.pane_id)
      .replace(/\{tab_id\}/g, pane.tab_id);
  } else {
    label = config.format
      .replace(/\{process\}/g, resolution.name)
      .replace(/\{dir\}/g, dirName)
      .replace(/\{path\}/g, pathName)
      .replace(/\{pane_id\}/g, pane.pane_id)
      .replace(/\{tab_id\}/g, pane.tab_id);
  }

  if (config.maxLength > 0) {
    label = truncate(label, config.maxLength);
  }
  return label;
}

export function callHerdr<T>(args: string[], herdrBin: string): T {
  const res = spawnSync(herdrBin, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.error) {
    throw res.error;
  }
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || "").trim();
    throw new Error(`herdr ${args.join(" ")} exited ${res.status}: ${detail}`);
  }
  const parsed = JSON.parse(res.stdout);
  return (parsed && typeof parsed === "object" && "result" in parsed
    ? parsed.result
    : parsed) as T;
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function loadConfig(): Config {
  const dir = process.env.HERDR_PLUGIN_CONFIG_DIR;
  const raw = dir
    ? readJson<Record<string, unknown>>(path.join(dir, "config.json"), {})
    : {};

  const format =
    typeof raw.format === "string" && raw.format.trim().length > 0
      ? raw.format.trim()
      : "{process}";

  // Default: show the current directory/path when no process is running
  const target = raw.target === "tab" ? "tab" : "pane";

  const shellIdle =
    raw.shell_idle === "process" || raw.shell_idle === "shell"
      ? (raw.shell_idle as "process" | "shell")
      : "dir";

  const idlePathStyle =
    raw.idle_path_style === "relative" || raw.idle_path_style === "compact"
      ? (raw.idle_path_style as "relative" | "compact")
      : "basename";

  const maxLength = Number.isInteger(raw.max_length)
    ? (raw.max_length as number)
    : 25;

  const overwriteManual = raw.overwrite_manual === true;
  const includeArgs = raw.include_args !== false;

  return {
    format,
    target,
    shellIdle,
    idlePathStyle,
    maxLength,
    overwriteManual,
    includeArgs,
  };
}

function acquireSyncLock(stateDir: string | undefined): (() => void) | null {
  if (!stateDir) return () => {};

  fs.mkdirSync(stateDir, { recursive: true });
  const lockFile = path.join(stateDir, "sync.lock");

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockFile, "wx");
      fs.writeFileSync(fd, `${process.pid}\n`);
      fs.closeSync(fd);
      return () => {
        try {
          const owner = Number.parseInt(fs.readFileSync(lockFile, "utf8").trim(), 10);
          if (owner === process.pid) fs.unlinkSync(lockFile);
        } catch {
          // Already removed or replaced.
        }
      };
    } catch {
      try {
        const owner = Number.parseInt(fs.readFileSync(lockFile, "utf8").trim(), 10);
        process.kill(owner, 0);
        return null; // Another sync is in progress.
      } catch {
        try {
          fs.unlinkSync(lockFile); // Recover a stale lock once.
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function sync(herdrBin: string = process.env.HERDR_BIN_PATH || "herdr"): void {
  // Event/action invocations also start the watcher. This covers plugins linked
  // while Herdr is already running (startup hooks only run on server startup).
  if (process.env.HERDR_PLUGIN_STATE_DIR && process.env.HERDR_SOCKET_PATH) {
    try {
      startDaemon();
    } catch {
      // A failed watcher must not prevent this one-shot sync.
    }
  }

  const stateDir = process.env.HERDR_PLUGIN_STATE_DIR;
  const releaseLock = acquireSyncLock(stateDir);
  if (!releaseLock) return;

  try {
    syncLocked(herdrBin, stateDir);
  } finally {
    releaseLock();
  }
}

function syncLocked(herdrBin: string, stateDir: string | undefined): void {
  const config = loadConfig();
  const stateFile = stateDir ? path.join(stateDir, "labels.json") : null;
  const ownedLabels: OwnedLabels = stateFile ? readJson<OwnedLabels>(stateFile, {}) : {};
  const nextOwnedLabels: OwnedLabels = {};

  // Fetch full snapshot first for maximum efficiency
  let tabs: TabInfo[] = [];
  let panes: PaneInfo[] = [];
  let layouts: TabLayoutInfo[] = [];

  try {
    const snapRes = callHerdr<{ snapshot?: SnapshotResult }>(["api", "snapshot"], herdrBin);
    const snap = snapRes.snapshot;
    if (snap) {
      tabs = snap.tabs || [];
      panes = snap.panes || [];
      layouts = snap.layouts || [];
    }
  } catch {
    // Fallback for environments where api snapshot is not available
    try {
      const wsList = callHerdr<{ workspaces?: WorkspaceInfo[] }>(["workspace", "list"], herdrBin);
      const workspaces = wsList.workspaces || [];
      for (const ws of workspaces) {
        const tList = callHerdr<{ tabs?: TabInfo[] }>(["tab", "list", "--workspace", ws.workspace_id], herdrBin);
        const pList = callHerdr<{ panes?: PaneInfo[] }>(["pane", "list", "--workspace", ws.workspace_id], herdrBin);
        if (tList.tabs) tabs.push(...tList.tabs);
        if (pList.panes) panes.push(...pList.panes);
      }
    } catch (e) {
      throw new Error(`Failed to discover Herdr workspaces: ${e}`);
    }
  }

  if (config.target === "pane") {
    // Pane labels are rendered as cut-outs in each split's top border.
    for (const pane of panes) {
      let procInfo: ProcessInfo | null = null;
      try {
        const pRes = callHerdr<{ process_info?: ProcessInfo }>(
          ["pane", "process-info", "--pane", pane.pane_id],
          herdrBin
        );
        procInfo = pRes.process_info || null;
      } catch {
        // Fall back to pane cwd/title data.
      }

      const resolution = extractProcessResolution(procInfo, pane, config);
      const label = formatLabel(resolution, pane, config);
      const currentLabel = pane.label || "";
      const isOwned = !currentLabel || ownedLabels[pane.pane_id] === currentLabel;
      if (!isOwned && !config.overwriteManual) continue;

      if (label !== currentLabel) {
        try {
          callHerdr(["pane", "rename", pane.pane_id, label], herdrBin);
        } catch (e) {
          console.error(`process-name-split: failed to rename pane ${pane.pane_id}:`, e);
          continue;
        }
      }
      nextOwnedLabels[pane.pane_id] = label;
    }

    // Restore tab numbers when upgrading from the old tab-label behavior.
    for (const tab of tabs) {
      if (ownedLabels[tab.tab_id] === tab.label && tab.number !== undefined) {
        try {
          callHerdr(["tab", "rename", tab.tab_id, String(tab.number)], herdrBin);
        } catch (e) {
          console.error(`process-name-split: failed to restore tab ${tab.tab_id}:`, e);
        }
      }
    }

    if (stateFile) writeJsonAtomic(stateFile, nextOwnedLabels);
    return;
  }

  for (const tab of tabs) {
    // 1. Identify selected split panel inside the tab
    const tabPanes = panes.filter((p) => p.tab_id === tab.tab_id);
    if (tabPanes.length === 0) {
      continue;
    }

    let selectedPane: PaneInfo | undefined;

    // Check tab layout for focused_pane_id
    const layout = layouts.find((l) => l.tab_id === tab.tab_id);
    if (layout?.focused_pane_id) {
      selectedPane = tabPanes.find((p) => p.pane_id === layout.focused_pane_id);
    }

    // Fallback to globally focused pane if in this tab
    if (!selectedPane) {
      selectedPane = tabPanes.find((p) => p.focused);
    }

    // Fallback: query layout directly for the first pane
    if (!selectedPane && tabPanes.length > 1) {
      try {
        const layoutRes = callHerdr<{ layout?: { focused_pane_id?: string } }>(
          ["pane", "layout", "--pane", tabPanes[0].pane_id],
          herdrBin
        );
        if (layoutRes.layout?.focused_pane_id) {
          selectedPane = tabPanes.find((p) => p.pane_id === layoutRes.layout?.focused_pane_id);
        }
      } catch {
        // ignore layout query error and fall back to first pane
      }
    }

    if (!selectedPane) {
      selectedPane = tabPanes[0];
    }

    // 2. Query process info for the selected split panel
    let procInfo: ProcessInfo | null = null;
    try {
      const pRes = callHerdr<{ process_info?: ProcessInfo }>(
        ["pane", "process-info", "--pane", selectedPane.pane_id],
        herdrBin
      );
      procInfo = pRes.process_info || null;
    } catch {
      // process info could not be read
    }

    // 3. Extract running process name and format tab label
    const resolution = extractProcessResolution(procInfo, selectedPane, config);
    const label = formatLabel(resolution, selectedPane, config);

    // 4. Respect manual renames unless overwriteManual is enabled
    // Older versions could lose ownership when simultaneous focus events raced
    // while writing labels.json. A matching pane terminal title safely recovers
    // those generated labels on the next sync.
    const matchesPaneTitle = tabPanes.some(
      (pane) => pane.terminal_title_stripped === tab.label
    );
    const isOwned =
      DEFAULT_LABEL.test(tab.label) ||
      ownedLabels[tab.tab_id] === tab.label ||
      matchesPaneTitle;
    if (!isOwned && !config.overwriteManual) continue;

    if (label !== tab.label) {
      try {
        callHerdr(["tab", "rename", tab.tab_id, label], herdrBin);
      } catch (e) {
        console.error(`process-name-split: failed to rename tab ${tab.tab_id}:`, e);
      }
    }

    nextOwnedLabels[tab.tab_id] = label;
  }

  if (stateFile) {
    writeJsonAtomic(stateFile, nextOwnedLabels);
  }
}

// Execute main when run directly
function main(): void {
  try {
    sync();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`process-name-split: ${msg}`);
    process.exit(1);
  }
}

// Only invoke if running directly as main module
const isMain = process.argv[1] && (
  process.argv[1].endsWith("sync.mts") ||
  process.argv[1].endsWith("sync.js") ||
  process.argv[1].endsWith("sync.ts")
);

if (isMain) {
  main();
}
