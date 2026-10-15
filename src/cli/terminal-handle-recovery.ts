// Why: the runtime answers a closed or replaced terminal with a bare error code that
// never echoes the handle, so the CLI, which still knows `--terminal`, shapes the recovery.

const MISSING_TERMINAL_CODES: ReadonlySet<string> = new Set([
  'terminal_handle_stale',
  'terminal_split_source_not_found'
])

export type TerminalHandleRecovery = {
  terminalHandle: string
  nextSteps: readonly string[]
}

export function isMissingTerminalError(code: string | undefined, message: string): boolean {
  return (
    MISSING_TERMINAL_CODES.has(message) || (code !== undefined && MISSING_TERMINAL_CODES.has(code))
  )
}

export function terminalHandleRecovery(terminalHandle: string): TerminalHandleRecovery {
  return {
    terminalHandle,
    nextSteps: [
      `Terminal handle "${terminalHandle}" no longer exists: it was closed or replaced. Run \`orca terminal list\` to see the current handles, then retry with one of them.`
    ]
  }
}
