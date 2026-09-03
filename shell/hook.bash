# herdr-process-name-split: companion shell hook for bash.
# Gives instant updates when commands start, finish, or when directory changes.
#
# Source this file from ~/.bashrc:
#   [[ -n "$HERDR_ENV" ]] && source /path/to/herdr-process-name-split/shell/hook.bash

if [[ -n "$HERDR_ENV" && -n "$HERDR_TAB_ID" ]]; then
  _herdr_process_name_split_sync() {
    local herdr_bin="${HERDR_BIN_PATH:-herdr}"
    "$herdr_bin" plugin action invoke process-name-split.sync >/dev/null 2>&1 &
  }

  if [[ -z "$PROMPT_COMMAND" ]]; then
    PROMPT_COMMAND="_herdr_process_name_split_sync"
  elif [[ "$PROMPT_COMMAND" != *"_herdr_process_name_split_sync"* ]]; then
    PROMPT_COMMAND="_herdr_process_name_split_sync; $PROMPT_COMMAND"
  fi
fi
