import type { PtyConnectionDeps } from './pty-connection-types'

type PaneRestartStartup = NonNullable<PtyConnectionDeps['startup']>
type PaneRestart = (startup: PaneRestartStartup) => void

// Why a registry of mounted panes, not a store queue: only a mounted pane restarts in place, and an
// account move must not join the Codex restart queue, whose detached path relaunches a pane as Codex.
const restartByPtyId = new Map<string, PaneRestart>()

export function registerPaneAccountMoveRestart(ptyId: string, restart: PaneRestart): () => void {
  restartByPtyId.set(ptyId, restart)
  return () => {
    if (restartByPtyId.get(ptyId) === restart) {
      restartByPtyId.delete(ptyId)
    }
  }
}

/** Restarts the mounted pane that owns this PTY; false when no mounted pane does. */
export function restartPaneForAccountMove(ptyId: string, startup: PaneRestartStartup): boolean {
  const restart = restartByPtyId.get(ptyId)
  if (!restart) {
    return false
  }
  restart(startup)
  return true
}
