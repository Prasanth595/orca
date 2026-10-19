import { WINDOWS_HOOK_STDIN_DRAIN_LABEL } from './hook-stdin-contract'

// Why: Cursor CLI imports ~/.claude/settings.json hooks and runs them with its own hook
// environment. Only these two names are Cursor-owned, and Cursor sets both for every hook it
// runs; CLAUDE_PROJECT_DIR alone is also Claude Code's, so it cannot tell the two apart.
export function buildPosixCursorReplayGuardLines(): string[] {
  return [
    // Why: Cursor imports vendor hooks; only its native hook may report the event as Cursor.
    'if [ -n "$CURSOR_VERSION" ] && [ -n "$CURSOR_PROJECT_DIR" ]; then',
    '  exit 0',
    'fi'
  ]
}

export function buildWindowsCursorReplayGuardLines(): string[] {
  return [
    `if not "%CURSOR_VERSION%"=="" if not "%CURSOR_PROJECT_DIR%"=="" goto :${WINDOWS_HOOK_STDIN_DRAIN_LABEL}`
  ]
}
