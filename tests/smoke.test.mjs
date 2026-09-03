import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sync } from "../sync.mts";

test("sync() updates tabs from snapshot and process info using stub herdr binary", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-test-"));
  const stubHerdr = path.join(tmpDir, "herdr-stub");
  const logFile = path.join(tmpDir, "calls.log");

  // Create stub herdr binary
  const stubScript = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const log = ${JSON.stringify(logFile)};
fs.appendFileSync(log, args.join(" ") + "\\n");

if (args[0] === "api" && args[1] === "snapshot") {
  process.stdout.write(JSON.stringify({
    result: {
      snapshot: {
        workspaces: [{ workspace_id: "w1" }],
        tabs: [
          { tab_id: "w1:t1", label: "1", workspace_id: "w1" },
          { tab_id: "w1:t2", label: "2", workspace_id: "w1" }
        ],
        panes: [
          { pane_id: "w1:p1", tab_id: "w1:t1", focused: false, cwd: "/home/user/code/api" },
          { pane_id: "w1:p2", tab_id: "w1:t1", focused: true, cwd: "/home/user/code/api" },
          { pane_id: "w1:p3", tab_id: "w1:t2", focused: false, cwd: "/home/user/code/web" }
        ],
        layouts: [
          { tab_id: "w1:t1", focused_pane_id: "w1:p2" },
          { tab_id: "w1:t2", focused_pane_id: "w1:p3" }
        ]
      }
    }
  }));
  process.exit(0);
}

if (args[0] === "pane" && args[1] === "process-info") {
  const paneId = args[3];
  if (paneId === "w1:p2") {
    process.stdout.write(JSON.stringify({
      result: {
        process_info: {
          shell_pid: 100,
          foreground_process_group_id: 200,
          foreground_processes: [
            { pid: 100, name: "zsh", argv0: "-zsh" },
            { pid: 200, name: "make", argv0: "make", argv: ["make", "debug-web"] }
          ]
        }
      }
    }));
    process.exit(0);
  }
  if (paneId === "w1:p3") {
    process.stdout.write(JSON.stringify({
      result: {
        process_info: {
          shell_pid: 300,
          foreground_process_group_id: 300,
          foreground_processes: [
            { pid: 300, name: "zsh", argv0: "-zsh", argv: ["-zsh"] }
          ]
        }
      }
    }));
    process.exit(0);
  }
}

if (args[0] === "tab" && args[1] === "rename") {
  process.stdout.write(JSON.stringify({ result: { tab_id: args[2], label: args[3] } }));
  process.exit(0);
}

process.exit(0);
`;

  fs.writeFileSync(stubHerdr, stubScript, { mode: 0o755 });

  const oldEnv = { ...process.env };
  process.env.HERDR_PLUGIN_STATE_DIR = tmpDir;
  delete process.env.HERDR_PLUGIN_CONFIG_DIR;

  try {
    sync(stubHerdr);

    const calls = fs.readFileSync(logFile, "utf8").trim().split("\n");
    assert.ok(calls.includes("tab rename w1:t1 make debug-web"));
    assert.ok(calls.includes("tab rename w1:t2 zsh"));

    const state = JSON.parse(fs.readFileSync(path.join(tmpDir, "labels.json"), "utf8"));
    assert.equal(state["w1:t1"], "make debug-web");
    assert.equal(state["w1:t2"], "zsh");
  } finally {
    process.env = oldEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
