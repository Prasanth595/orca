import { useEffect } from 'react'
import { installClaudeSessionMoveCoordinator } from '@/lib/claude-session-move-coordinator'

/** Moves Claude sessions to the selected account once they can go, as the move setting says. */
export function ClaudeSessionMoveGate(): null {
  useEffect(() => installClaudeSessionMoveCoordinator(), [])
  return null
}
