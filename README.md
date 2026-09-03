# herdr-process-name-split

A [Herdr](https://herdr.dev/) plugin that automatically displays the running process name (short, informative) of the currently selected split panel inside each tab.

Never lose track of what is running in your split panes again.

```text
Before:  [ 1 ]        [ 2 ]        [ 3 ]
After:   [ nvim ]     [ cargo test ] [ make debug-web ]
```

When you have multiple split panels inside a tab, the tab label dynamically updates to reflect the process running in whichever split panel is currently focused.

---

## Features

- **Split Panel Awareness**: In tabs with multiple splits, it resolves the currently selected split panel and tracks its process.
- **Short, Informative Names**:
  - Subcommands: `cargo test`, `git diff`, `docker compose up`, `make debug-web`, `kubectl get`, `overmind start`
  - Package runners: `npm run dev`, `pnpm build`, `bun test`, `yarn start`
  - Interpreters: `python3 manage.py`, `python -m http.server`, `node server.js`
  - Editors & Viewers: `nvim Header.tsx`, `vim main.c`, `hx lib.rs`
  - Remote sessions: `ssh dev-box.internal`
  - AI Agents: `pi`, `claude`, `codex`, `gemini`, `cursor`
  - Idle shells: `zsh`, `bash`, `fish` (or directory name if configured)
- **Zero Build Step & Zero Runtime Dependencies**: Executed directly by Node.js via native type stripping (Node 22.18+ / 24+).
- **Manual Rename Protection**: Does not overwrite custom names you manually gave to tabs unless explicitly configured to do so.
- **Configurable**: Customize formatting templates (e.g. `{process}`, `{dir}: {process}`, `{process} ({dir})`), truncation length, and idle shell behavior.
- **Optional Companion Shell Hooks**: Instant updates when commands start and finish inside your shell.

---

## Requirements

- [Herdr](https://herdr.dev/) `>= 0.7.0`
- [Node.js](https://nodejs.org/) `>= 22.18.0` on your `PATH`

---

## Installation

### Local Development / Direct Link

To link this repository directly into your local Herdr installation:

```bash
cd /path/to/herdr-process-name-split
herdr plugin link .
```

To test that it works immediately:

```bash
herdr plugin action invoke process-name-split.sync
```

### From GitHub

```bash
herdr plugin install <owner>/herdr-process-name-split
```

---

## How It Works

1. **Event Driven**: The plugin hooks Herdr lifecycle events (`pane.focused`, `pane.created`, `pane.closed`, `pane.exited`, `pane.moved`, `pane.agent_detected`, `tab.focused`, `tab.created`, `layout.updated`, `workspace.focused`).
2. **Tab Layout Resolution**: For each tab, it queries Herdr's layout to determine the tab's `focused_pane_id` (the selected split panel inside that tab).
3. **Process Inspection**: It queries `herdr pane process-info` on the selected split panel to inspect foreground processes, process group leaders, and arguments.
4. **Intelligent Formatting**: Formats the process into a concise, developer-friendly label (filtering out noisy flags while keeping meaningful subcommands and target files).
5. **Tab Rename**: Renames the tab via `herdr tab rename`.

---

## Keybindings (Optional)

You can bind a shortcut in your `~/.config/herdr/config.toml` to manually trigger a sync at any time:

```toml
[[keys.command]]
key = "prefix+p"
type = "plugin_action"
command = "process-name-split.sync"
description = "Sync process tab names"
```

---

## Instant Updates on Command Execution (Optional Shell Hooks)

Because Herdr's PTY events update on pane and tab interactions, commands started inside an existing shell can also trigger instant tab updates using the companion shell hooks.

### Zsh (`~/.zshrc`)

Add the following to your `~/.zshrc`:

```zsh
[[ -n "$HERDR_ENV" ]] && source /path/to/herdr-process-name-split/shell/hook.zsh
```

### Bash (`~/.bashrc`)

Add the following to your `~/.bashrc`:

```bash
[[ -n "$HERDR_ENV" ]] && source /path/to/herdr-process-name-split/shell/hook.bash
```

### Fish (`~/.config/fish/config.fish`)

Add the following to your `~/.config/fish/config.fish`:

```fish
test -n "$HERDR_ENV"; and source /path/to/herdr-process-name-split/shell/hook.fish
```

---

## Configuration

Configuration is optional. Create a `config.json` file in the plugin's configuration directory.

To find the configuration directory path, run:

```bash
herdr plugin config-dir process-name-split
```

### Example `config.json`

```json
{
  "format": "{process}",
  "shell_idle": "process",
  "max_length": 25,
  "overwrite_manual": false,
  "include_args": true
}
```

### Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `format` | `string` | `"{process}"` | Template for the tab label. Available tokens: `{process}`, `{dir}`, `{pane_id}`, `{tab_id}`. Examples: `"{process}"`, `"{dir}: {process}"`, `"{process} ({dir})"`. |
| `shell_idle` | `string` | `"process"` | How to label a tab when only an idle shell is running in the split panel. Options: `"process"` (shows shell name like `zsh`), `"dir"` (shows folder name like `api` or `~`), or `"shell"`. |
| `max_length` | `number` | `25` | Maximum tab label length before truncating with `…`. Set to `0` to disable truncation. |
| `overwrite_manual` | `boolean` | `false` | When `false`, preserves tabs you renamed manually. When `true`, relabels every tab. |
| `include_args` | `boolean` | `true` | When `true`, includes informative subcommands or arguments (e.g. `cargo test`, `git diff`). When `false`, displays only the binary name (`cargo`, `git`). |

---

## Coexisting with `auto-tab-name`

If you previously used `dev-shimada.auto-tab-name` (which renames tabs to the working directory), you can either:

1. **Disable `auto-tab-name`** in favor of `process-name-split`:
   ```bash
   herdr plugin disable dev-shimada.auto-tab-name
   ```
2. **Combine directory and process** by setting `"format": "{dir}: {process}"` in `process-name-split`'s `config.json` and disabling `auto-tab-name`.

---

## Development & Testing

Run type checks (strict, erasable syntax only):

```bash
npm run check
```

Run test suite:

```bash
npm test
```

Inspect plugin logs in Herdr:

```bash
herdr plugin log list --plugin process-name-split
```

---

## License

[MIT](LICENSE)
