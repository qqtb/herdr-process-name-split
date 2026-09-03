#!/usr/bin/env node
// Process Name Split: set each tab's label to the running process name
// (short, informative) of the tab's currently selected split panel.
//
// Executed directly by Node.js (22.18+ / 24+) via native type stripping.
// Zero dependencies, zero build step.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

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
  shellIdle: "process" | "dir" | "shell";
  maxLength: number;
  overwriteManual: boolean;
  includeArgs: boolean;
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

export function extractProcessName(
  processInfo: ProcessInfo | null | undefined,
  pane: PaneInfo,
  config: Config
): string {
  const agent = pane.agent;
  const procs = processInfo?.foreground_processes || [];
  const shellPid = processInfo?.shell_pid;
  const fgGroupId = processInfo?.foreground_process_group_id;

  // If no process info could be queried
  if (!processInfo || procs.length === 0) {
    if (agent) return agent;
    if (pane.terminal_title_stripped && !pane.terminal_title_stripped.includes("@")) {
      return truncate(pane.terminal_title_stripped, config.maxLength);
    }
    return config.shellIdle === "dir" ? getDirName(pane.foreground_cwd || pane.cwd) : "shell";
  }

  // Only shell running (idle at prompt)
  if (procs.length === 1 && procs[0].pid === shellPid) {
    if (config.shellIdle === "dir") {
      return getDirName(pane.foreground_cwd || pane.cwd);
    }
    if (config.shellIdle === "shell") {
      return "shell";
    }
    return formatProcessItem(procs[0], agent, false);
  }

  // Filter out the shell itself
  const nonShells = procs.filter((p) => p.pid !== shellPid);
  if (nonShells.length === 0) {
    if (config.shellIdle === "dir") {
      return getDirName(pane.foreground_cwd || pane.cwd);
    }
    return "shell";
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

  return formatProcessItem(target, agent, config.includeArgs);
}

export function getDirName(cwd: string | null | undefined): string {
  if (!cwd) return "~";
  if (cwd === os.homedir()) return "~";
  const base = path.basename(cwd);
  return base || cwd;
}

export function formatLabel(
  processName: string,
  pane: PaneInfo,
  config: Config
): string {
  const dirName = getDirName(pane.foreground_cwd || pane.cwd);
  let label = config.format
    .replace(/\{process\}/g, processName)
    .replace(/\{dir\}/g, dirName)
    .replace(/\{pane_id\}/g, pane.pane_id)
    .replace(/\{tab_id\}/g, pane.tab_id);

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

  const shellIdle =
    raw.shell_idle === "dir" || raw.shell_idle === "shell"
      ? (raw.shell_idle as "dir" | "shell")
      : "process";

  const maxLength = Number.isInteger(raw.max_length)
    ? (raw.max_length as number)
    : 25;

  const overwriteManual = raw.overwrite_manual === true;
  const includeArgs = raw.include_args !== false;

  return {
    format,
    shellIdle,
    maxLength,
    overwriteManual,
    includeArgs,
  };
}

export function sync(herdrBin: string = process.env.HERDR_BIN_PATH || "herdr"): void {
  const config = loadConfig();
  const stateDir = process.env.HERDR_PLUGIN_STATE_DIR;
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
    const procName = extractProcessName(procInfo, selectedPane, config);
    const label = formatLabel(procName, selectedPane, config);

    // 4. Respect manual renames unless overwriteManual is enabled
    const isOwned = DEFAULT_LABEL.test(tab.label) || ownedLabels[tab.tab_id] === tab.label;
    if (!isOwned && !config.overwriteManual) {
      continue;
    }

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
