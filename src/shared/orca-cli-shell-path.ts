export const ORCA_CLI_POSIX_PATH_RESTORE = `if [ -n "\${ORCA_CLI_BIN_DIR:-}" ]; then
  case "\${PATH:-}" in
    "$ORCA_CLI_BIN_DIR"|"$ORCA_CLI_BIN_DIR":*) ;;
    *) export PATH="$ORCA_CLI_BIN_DIR\${PATH:+:$PATH}" ;;
  esac
fi`

/** Reassert the managed CLI in the same invocation that a tool's login shell executes. */
export const ORCA_CLI_POSIX_INVOCATION =
  'PATH="${ORCA_CLI_BIN_DIR:+$ORCA_CLI_BIN_DIR:}${ORCA_WSL_CLI_DIR:+$ORCA_WSL_CLI_DIR:}$PATH" "${ORCA_CLI_COMMAND:-orca}"'
