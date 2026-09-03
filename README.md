# herdr-process-name-split

A zero-dependency [Herdr](https://herdr.dev/) plugin that shows what every terminal split is doing.

- **Idle pane:** show its current directory.
- **Busy pane:** show its foreground command.
- **Multiple splits:** give every pane its own label in the top border.
- **Legacy mode:** label the tab from its currently focused pane instead.

```text
┌── client ───────────────────┐  ┌── make debug-web ───────────┐
│ $                           │  │ Compiling web application…  │
│                             │  │                             │
└─────────────────────────────┘  └─────────────────────────────┘
```

Labels update when focus, layout, process, or working-directory state changes. A lightweight watcher detects command starts and exits without requiring you to refocus the pane.

## Features

- Per-pane labels rendered as cut-outs in Herdr's pane borders.
- Current-directory labels for idle shells (`client`, `~/code/client`, or `code/client`).
- Concise process labels such as:
  - `make debug-web`
  - `cargo test`
  - `git diff`
  - `docker compose up`
  - `npm run dev`
  - `python -m http.server`
  - `nvim Header.tsx`
  - `ssh build-host`
- Herdr-detected agent names such as `pi`, `claude`, or `codex` take precedence.
- Immediate focus/layout updates plus 300 ms process polling.
- Optional zsh, bash, and fish hooks for command boundaries and `cd` changes.
- Manual pane/tab labels are preserved by default.
- Configurable target, template, idle behavior, path style, arguments, and truncation.
- Legacy focused-pane tab-title mode.
- No runtime packages, build output, or plugin SDK required.

## Requirements

- [Herdr](https://herdr.dev/) 0.7.0 or newer.
- Node.js 22.18.0 or newer on `PATH`.
- `ui.pane_borders = true` to see per-pane border labels. This is Herdr's default.

## Installation

### Install from GitHub

Once this repository has been published, install it with:

```bash
herdr plugin install qqtb/herdr-process-name-split
```

### Link a local checkout

```bash
git clone https://github.com/qqtb/herdr-process-name-split.git
cd herdr-process-name-split
herdr plugin link .
```

The plugin starts automatically with Herdr. To apply labels immediately after linking it into an already-running session:

```bash
herdr plugin action invoke process-name-split.sync
```

### Verify the installation

```bash
herdr plugin list
herdr plugin action list --plugin process-name-split
herdr plugin log list --plugin process-name-split
```

### Disable, re-enable, or remove

```bash
herdr plugin disable process-name-split
herdr plugin enable process-name-split
herdr plugin uninstall process-name-split   # GitHub installation
herdr plugin unlink process-name-split      # Local link
```

## Default behavior

The default configuration is equivalent to:

```json
{
  "target": "pane",
  "format": "{process}",
  "shell_idle": "dir",
  "idle_path_style": "basename",
  "max_length": 25,
  "overwrite_manual": false,
  "include_args": true
}
```

With these settings:

| Pane state | Example label |
| --- | --- |
| Idle in `/Users/alice/code/client` | `client` |
| Running `make debug-web` | `make debug-web` |
| Running `cargo test --workspace` | `cargo test` |
| Running `nvim src/Header.tsx` | `nvim Header.tsx` |
| Herdr detects Claude | `claude` |

## Configuration

Configuration is optional. Find the plugin's config directory:

```bash
herdr plugin config-dir process-name-split
```

Create `config.json` in that directory, then invoke a sync or wait for the next update:

```bash
herdr plugin action invoke process-name-split.sync
```

### All options

| Option | Type | Default | Values and behavior |
| --- | --- | --- | --- |
| `target` | string | `"pane"` | `"pane"` labels every split border. `"tab"` labels each tab from that tab's selected pane. |
| `format` | string | `"{process}"` | Label template. Supports `{process}`, `{dir}`, `{path}`, `{pane_id}`, and `{tab_id}`. |
| `shell_idle` | string | `"dir"` | `"dir"` or `"path"`: use the current path. `"process"`: use the shell executable (`zsh`, `bash`, etc.). `"shell"`: use the literal `shell`. |
| `idle_path_style` | string | `"basename"` | `"basename"`, `"relative"`, or `"compact"`; described below. |
| `max_length` | integer | `25` | Truncate longer labels with `…`. Use `0` to disable truncation. |
| `overwrite_manual` | boolean | `false` | Preserve user-created pane/tab labels when `false`; continuously replace them when `true`. |
| `include_args` | boolean | `true` | Include a useful subcommand, target, script, file, or host. Set to `false` for executable names only. |

Unknown or invalid values fall back to the documented defaults.

### Template tokens

| Token | Meaning | Example |
| --- | --- | --- |
| `{process}` | Resolved foreground process, or configured idle value | `make debug-web` |
| `{dir}` | Basename of the pane's current directory | `client` |
| `{path}` | Current directory using `idle_path_style` | `~/code/client` |
| `{pane_id}` | Herdr pane ID | `w1:p2` |
| `{tab_id}` | Herdr tab ID | `w1:t1` |

Examples:

```jsonc
// Process/path only
{ "format": "{process}" }

// Directory plus process
{ "format": "{dir}: {process}" }

// Process followed by directory
{ "format": "{process} ({dir})" }

// Useful while debugging layouts
{ "format": "{pane_id} {process}" }
```

When idle, the common `{dir}: {process}` and `{process} ({dir})` forms collapse to a single directory name instead of producing duplicates such as `client: client`.

### Path styles

Given `$HOME=/Users/alice` and a pane in `/Users/alice/code/project/client`:

| `idle_path_style` | Label |
| --- | --- |
| `"basename"` | `client` |
| `"relative"` | `~/code/project/client` |
| `"compact"` | `project/client` |

The home directory itself is always displayed as `~`. Paths outside the home directory remain absolute in `relative` mode.

### Pane borders versus tab labels

Per-pane border labels are the default:

```json
{ "target": "pane" }
```

To use the old behavior—one tab label based on the split selected inside that tab—use:

```json
{ "target": "tab" }
```

When switching from tab mode to pane mode, tab labels previously owned by this plugin are restored to their numeric labels. Manual labels are left alone.

### Manual-label behavior

By default, the plugin records labels it owns in its Herdr plugin state directory. If you manually rename a pane, it stops managing that pane:

```bash
herdr pane rename w1:p2 "database"
```

To make generated labels authoritative and overwrite manual labels:

```json
{ "overwrite_manual": true }
```

To let the plugin manage a manually named pane again, clear its label:

```bash
herdr pane rename w1:p2 --clear
```

### Process arguments

With `include_args: true`, the plugin keeps one useful part of common commands while dropping noisy flags:

| Command | Label |
| --- | --- |
| `make debug-web` | `make debug-web` |
| `git diff --staged` | `git diff` |
| `docker compose up -d` | `docker compose up` |
| `npm run dev` | `npm run dev` |
| `python manage.py runserver` | `python manage.py` |
| `python -m http.server` | `python -m http.server` |
| `nvim src/components/Header.tsx` | `nvim Header.tsx` |
| `ssh -i key.pem deploy@build.example.com` | `ssh build.example.com` |

Set `include_args` to `false` for labels such as `make`, `git`, `npm`, and `python`.

Recognized subcommand-oriented tools include `git`, `cargo`, `docker`, `docker-compose`, `podman`, `kubectl`, `make`, `just`, `rake`, `go`, `pip`, `uv`, `poetry`, `conda`, `brew`, `apt`, `dnf`, `pacman`, `gh`, `aws`, `terraform`, `pulumi`, `nix`, `mix`, `dotnet`, `gradle`, `mvn`, and `overmind`.

Recognized runners include `npm`, `pnpm`, `yarn`, `bun`, `npx`, `bunx`, and `deno`. Recognized interpreters include common Python versions, Node.js, Ruby, Perl, PHP, and `tsx`. Editors/viewers include Vim, Neovim, Nano, Emacs, Helix, Kakoune, Less, More, Bat, and Cat. Other commands can include one short non-flag argument.

## Configuration recipes

### Full home-relative paths while idle

```json
{
  "format": "{process}",
  "idle_path_style": "relative"
}
```

### Compact two-component paths

```json
{
  "format": "{process}",
  "idle_path_style": "compact"
}
```

### Executable names only

```json
{
  "include_args": false
}
```

### Directory and process with longer labels

```json
{
  "format": "{dir}: {process}",
  "max_length": 40
}
```

### Never truncate

```json
{
  "max_length": 0
}
```

### Always overwrite pane names

```json
{
  "overwrite_manual": true
}
```

### Focused-pane tab titles instead of pane borders

```json
{
  "target": "tab",
  "format": "{process}"
}
```

## Optional manual keybinding

Add this to `~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "prefix+p"
type = "plugin_action"
command = "process-name-split.sync"
description = "Sync process pane names"
```

## Optional shell hooks

The watcher works without shell integration. Shell hooks are useful for commands shorter than the 300 ms polling interval and for immediate directory-change updates.

Use the absolute path to this checkout for local links. For a GitHub-managed installation, inspect `herdr plugin list` to find its plugin root.

### Zsh

Add to `~/.zshrc`:

```zsh
[[ -n "$HERDR_ENV" ]] && source /absolute/path/to/herdr-process-name-split/shell/hook.zsh
```

The zsh hook triggers on `preexec`, `precmd`, and `chpwd`.

### Bash

Add to `~/.bashrc`:

```bash
[[ -n "$HERDR_ENV" ]] && source /absolute/path/to/herdr-process-name-split/shell/hook.bash
```

Bash triggers the sync from `PROMPT_COMMAND`. The watcher detects the running command while it executes.

### Fish

Add to `~/.config/fish/config.fish`:

```fish
test -n "$HERDR_ENV"; and source /absolute/path/to/herdr-process-name-split/shell/hook.fish
```

The fish hook triggers on `fish_preexec`, `fish_postexec`, and `PWD` changes.

## How it works

1. Herdr invokes `sync.mts` for pane, tab, workspace, worktree, and agent lifecycle events.
2. A startup hook launches `daemon.mts`, which subscribes to Herdr focus/layout events.
3. Because Herdr has no dedicated generic process-start/process-exit event, the watcher also polls every 300 ms.
4. A full session snapshot supplies pane/tab/layout state.
5. `herdr pane process-info` supplies the shell PID, foreground process group, argv, and cwd for each relevant pane.
6. The plugin removes the shell process, resolves wrappers such as `sh -c`, selects the foreground process-group leader, and formats the label.
7. `herdr pane rename` updates pane mode; `herdr tab rename` updates legacy tab mode.
8. Atomic state writes and an inter-process lock prevent simultaneous Herdr events from corrupting label ownership.

The daemon reconnects across brief socket interruptions and exits if the Herdr server remains unavailable. Event/action invocations ensure it starts when a plugin is linked after Herdr has already started.

## Coexisting with other naming plugins

Pane mode does not modify tabs after migrating labels previously owned by this plugin, so it can coexist with a tab-naming plugin.

In `target: "tab"` mode, disable other plugins that rename tabs to avoid competing updates. For example:

```bash
herdr plugin disable dev-shimada.auto-tab-name
```

## Troubleshooting

### No border labels appear

Ensure pane borders are enabled in `~/.config/herdr/config.toml`:

```toml
[ui]
pane_borders = true
```

Then invoke:

```bash
herdr plugin action invoke process-name-split.sync
```

### A manually named pane does not update

This is expected when `overwrite_manual` is `false`. Clear the pane label or enable overwriting:

```bash
herdr pane rename PANE_ID --clear
```

### Labels update only after focus changes

Check that the watcher is running and inspect plugin logs:

```bash
cat ~/.local/state/herdr/plugins/process-name-split/daemon.pid
herdr plugin log list --plugin process-name-split
```

Restart the watcher from a local checkout:

```bash
node daemon.mts stop
node daemon.mts start
```

A Herdr restart also runs the plugin startup hook again.

### Force an immediate refresh

```bash
herdr plugin action invoke process-name-split.sync
```

### Inspect what Herdr sees

```bash
herdr api snapshot
herdr pane process-info --pane PANE_ID
herdr pane get PANE_ID
```

### Labels are truncated

Increase `max_length`, or set it to `0`.

### A process name is less useful than expected

Run `herdr pane process-info --pane PANE_ID` and inspect `foreground_processes`. The formatter intentionally keeps labels short and generally includes only one meaningful argument.

## Development

```bash
npm install
npm run check
npm test
```

The runtime itself has no npm dependencies. TypeScript and Node type definitions are development-only.

Repository layout:

```text
herdr-plugin.toml       Plugin metadata, action, startup hook, and event hooks
sync.mts                Snapshot, process resolution, formatting, and renaming
daemon.mts              Event subscriber and process poller
daemon-control.mts      Watcher lifecycle and PID management
shell/                   Optional zsh, bash, and fish hooks
tests/                   Unit and smoke tests
```

Useful commands:

```bash
# Re-link after manifest changes
herdr plugin link .

# Run one sync
herdr plugin action invoke process-name-split.sync

# Inspect command failures
herdr plugin log list --plugin process-name-split
```

## Known limitations

- Generic process transitions require polling because Herdr currently exposes no dedicated start/exit event for every foreground command.
- Commands shorter than the polling interval may not be visible unless a shell hook catches the boundary.
- Process argv/cwd detail depends on what the operating system exposes through Herdr.
- Label formatting is intentionally concise rather than a full shell-command reconstruction.
- Manual labels cannot be distinguished from plugin labels without ownership state; deleting that state may require clearing a pane label once.

## Security and resource use

The plugin executes as your user, like every Herdr plugin. It calls the local Herdr CLI/socket only, reads foreground process metadata exposed by Herdr, and stores label/PID state under `HERDR_PLUGIN_STATE_DIR`. It makes no network requests.

The watcher performs one snapshot plus process-info queries on a 300 ms interval. This favors responsive labels; sessions with very large pane counts will perform more local queries.

## License

[MIT](LICENSE)
