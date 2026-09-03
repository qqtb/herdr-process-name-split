# herdr-process-name-split: companion shell hook for fish.
# Gives instant updates when commands start and finish inside your shell.
#
# Source this file from ~/.config/fish/config.fish:
#   test -n "$HERDR_ENV"; and source /path/to/herdr-process-name-split/shell/hook.fish

if test -n "$HERDR_ENV"; and test -n "$HERDR_TAB_ID"
  function _herdr_process_name_split_preexec --on-event fish_preexec
    set -l herdr_bin (test -n "$HERDR_BIN_PATH"; and echo "$HERDR_BIN_PATH"; or echo "herdr")
    $herdr_bin plugin action invoke process-name-split.sync >/dev/null 2>&1 &
  end

  function _herdr_process_name_split_postexec --on-event fish_postexec
    set -l herdr_bin (test -n "$HERDR_BIN_PATH"; and echo "$HERDR_BIN_PATH"; or echo "herdr")
    $herdr_bin plugin action invoke process-name-split.sync >/dev/null 2>&1 &
  end
end
