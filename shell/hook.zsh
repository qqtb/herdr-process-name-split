# herdr-process-name-split: companion shell hook for instant tab name updates.
# Gives instant updates when commands start and finish inside your shell.
#
# Source this file from ~/.zshrc:
#   [[ -n "$HERDR_ENV" ]] && source /path/to/herdr-process-name-split/shell/hook.zsh

if [[ -n "$HERDR_ENV" && -n "$HERDR_TAB_ID" ]]; then
  _herdr_process_name_split_sync() {
    local herdr_bin="${HERDR_BIN_PATH:-herdr}"
    "$herdr_bin" plugin action invoke process-name-split.sync >/dev/null 2>&1 &!
  }

  autoload -Uz add-zsh-hook
  add-zsh-hook preexec _herdr_process_name_split_sync
  add-zsh-hook precmd _herdr_process_name_split_sync
fi
