import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanBaseName,
  truncate,
  parseNonFlagArgs,
  formatProcessItem,
  extractProcessName,
  formatLabel,
} from "../sync.mts";

test("cleanBaseName strips paths, leading dashes, and handles Windows paths", () => {
  assert.equal(cleanBaseName("/usr/bin/make"), "make");
  assert.equal(cleanBaseName("-zsh"), "zsh");
  assert.equal(cleanBaseName("C:\\tools\\git.exe"), "git.exe");
  assert.equal(cleanBaseName("node"), "node");
  assert.equal(cleanBaseName(""), "");
});

test("truncate truncates long strings with ellipsis", () => {
  assert.equal(truncate("short", 10), "short");
  assert.equal(truncate("this is a very long command", 12), "this is a v…");
  assert.equal(truncate("unlimited", 0), "unlimited");
});

test("parseNonFlagArgs filters flags and keeps meaningful arguments", () => {
  assert.deepEqual(parseNonFlagArgs(["diff", "--stat", "HEAD"]), ["diff", "HEAD"]);
  assert.deepEqual(parseNonFlagArgs(["-i", "id_rsa", "user@example.com"]), ["user@example.com"]);
  assert.deepEqual(parseNonFlagArgs(["-m", "http.server", "8080"]), ["-m http.server", "8080"]);
  assert.deepEqual(parseNonFlagArgs(["start", "-f", "Procfile.dev"]), ["start"]);
  assert.deepEqual(parseNonFlagArgs(["test", "--filter=foo"]), ["test"]);
});

test("formatProcessItem formats common developer tools with subcommands", () => {
  assert.equal(
    formatProcessItem({ pid: 1, name: "make", argv0: "make", argv: ["make", "debug-web"] }, null),
    "make debug-web"
  );
  assert.equal(
    formatProcessItem({ pid: 2, name: "git", argv0: "git", argv: ["git", "diff", "--staged"] }, null),
    "git diff"
  );
  assert.equal(
    formatProcessItem({ pid: 3, name: "cargo", argv0: "cargo", argv: ["cargo", "test", "--workspace"] }, null),
    "cargo test"
  );
  assert.equal(
    formatProcessItem({ pid: 4, name: "docker", argv0: "docker", argv: ["docker", "compose", "up", "-d"] }, null),
    "docker compose up"
  );
  assert.equal(
    formatProcessItem({ pid: 5, name: "kubectl", argv0: "kubectl", argv: ["kubectl", "get", "pods", "-A"] }, null),
    "kubectl get"
  );
  assert.equal(
    formatProcessItem({ pid: 6, name: "overmind", argv0: "overmind", argv: ["overmind", "start", "-f", "Procfile"] }, null),
    "overmind start"
  );
});

test("formatProcessItem formats package runners", () => {
  assert.equal(
    formatProcessItem({ pid: 10, name: "npm", argv0: "npm", argv: ["npm", "run", "dev"] }, null),
    "npm run dev"
  );
  assert.equal(
    formatProcessItem({ pid: 11, name: "pnpm", argv0: "pnpm", argv: ["pnpm", "dev"] }, null),
    "pnpm dev"
  );
  assert.equal(
    formatProcessItem({ pid: 12, name: "bun", argv0: "bun", argv: ["bun", "test"] }, null),
    "bun test"
  );
});

test("formatProcessItem formats interpreters with script or module", () => {
  assert.equal(
    formatProcessItem({ pid: 20, name: "python3", argv0: "python3", argv: ["python3", "manage.py", "runserver"] }, null),
    "python3 manage.py"
  );
  assert.equal(
    formatProcessItem({ pid: 21, name: "python", argv0: "python", argv: ["python", "-m", "http.server"] }, null),
    "python -m http.server"
  );
  assert.equal(
    formatProcessItem({ pid: 22, name: "node", argv0: "node", argv: ["node", "dist/server.js"] }, null),
    "node server.js"
  );
});

test("formatProcessItem formats editors with active file", () => {
  assert.equal(
    formatProcessItem({ pid: 30, name: "nvim", argv0: "nvim", argv: ["nvim", "src/components/Header.tsx"] }, null),
    "nvim Header.tsx"
  );
  assert.equal(
    formatProcessItem({ pid: 31, name: "vim", argv0: "vim", argv: ["vim", "main.c"] }, null),
    "vim main.c"
  );
  assert.equal(
    formatProcessItem({ pid: 32, name: "helix", argv0: "hx", argv: ["hx", "src/lib.rs"] }, null),
    "hx lib.rs"
  );
});

test("formatProcessItem formats remote connections", () => {
  assert.equal(
    formatProcessItem({ pid: 40, name: "ssh", argv0: "ssh", argv: ["ssh", "-i", "key.pem", "deploy@remote-host.com"] }, null),
    "ssh remote-host.com"
  );
});

test("formatProcessItem prioritizes detected agent", () => {
  assert.equal(
    formatProcessItem({ pid: 50, name: "node", argv0: "node", argv: ["node", "dist/index.js"] }, "claude"),
    "claude"
  );
  assert.equal(
    formatProcessItem({ pid: 51, name: "node", argv0: "pi", argv: ["pi"] }, "pi"),
    "pi"
  );
});

test("extractProcessName handles idle shells vs active commands", () => {
  const dummyPane = {
    pane_id: "w1:p1",
    tab_id: "w1:t1",
    focused: true,
    cwd: "/Users/alice/projects/api",
  };
  const config = {
    format: "{process}",
    shellIdle: "process",
    maxLength: 25,
    overwriteManual: false,
    includeArgs: true,
  };

  // Idle shell
  const idleInfo = {
    pane_id: "w1:p1",
    shell_pid: 100,
    foreground_process_group_id: 100,
    foreground_processes: [{ pid: 100, name: "zsh", argv0: "-zsh", argv: ["-zsh"] }],
  };
  assert.equal(extractProcessName(idleInfo, dummyPane, config), "zsh");

  // Idle shell with shellIdle = 'dir'
  assert.equal(
    extractProcessName(idleInfo, dummyPane, { ...config, shellIdle: "dir" }),
    "api"
  );

  // Active command running under shell
  const activeInfo = {
    pane_id: "w1:p1",
    shell_pid: 100,
    foreground_process_group_id: 200,
    foreground_processes: [
      { pid: 100, name: "zsh", argv0: "-zsh", argv: ["-zsh"] },
      { pid: 200, name: "cargo", argv0: "cargo", argv: ["cargo", "test", "--workspace"] },
      { pid: 205, name: "cargo-test", argv0: "cargo-test", argv: ["target/debug/deps/test-123"] },
    ],
  };
  assert.equal(extractProcessName(activeInfo, dummyPane, config), "cargo test");
});

test("extractProcessName un-nests shell wrappers (sh -c)", () => {
  const dummyPane = { pane_id: "w1:p1", tab_id: "w1:t1", focused: true };
  const config = {
    format: "{process}",
    shellIdle: "process",
    maxLength: 25,
    overwriteManual: false,
    includeArgs: true,
  };

  const wrappedInfo = {
    pane_id: "w1:p1",
    shell_pid: 100,
    foreground_process_group_id: 200,
    foreground_processes: [
      { pid: 100, name: "zsh", argv0: "-zsh" },
      { pid: 200, name: "sh", argv0: "sh", argv: ["sh", "-c", "overmind start"] },
      { pid: 201, name: "overmind", argv0: "overmind", argv: ["overmind", "start"] },
    ],
  };
  assert.equal(extractProcessName(wrappedInfo, dummyPane, config), "overmind start");
});

test("formatLabel applies templates and truncates", () => {
  const dummyPane = {
    pane_id: "w1:p1",
    tab_id: "w1:t1",
    focused: true,
    cwd: "/Users/alice/projects/frontend",
  };

  const cfg1 = { format: "{process}", maxLength: 20, shellIdle: "process", overwriteManual: false, includeArgs: true };
  assert.equal(formatLabel("npm run dev", dummyPane, cfg1), "npm run dev");

  const cfg2 = { format: "{dir}: {process}", maxLength: 30, shellIdle: "process", overwriteManual: false, includeArgs: true };
  assert.equal(formatLabel("cargo test", dummyPane, cfg2), "frontend: cargo test");

  const cfg3 = { format: "{process}", maxLength: 8, shellIdle: "process", overwriteManual: false, includeArgs: true };
  assert.equal(formatLabel("make debug-web", dummyPane, cfg3), "make de…");
});
