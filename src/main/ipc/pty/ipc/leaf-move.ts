import { getPtyIpc } from '../../pty-host-bindings'
import type { Store } from '../../../persistence'
import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'
import { agentHookServer } from '../../../agent-hooks/server'
import { rekeyMigrationUnsupportedPtyPaneKey } from '../../../agent-hooks/migration-unsupported-pty-state'
import { rememberPaneKeyForPty } from '../pane/key-state'
import {
  isTerminalLeafMoveRequest,
  terminalLeafMovePaneKeys,
  type TerminalLeafMoveRequest,
  type TerminalLeafMoveResult
} from '../../../../shared/terminal-leaf-move'

/** Durable move first; agent-status and orchestration keys follow only a committed move. */
export async function commitLeafMoveAndRekey(
  deps: { store?: Store; runtime?: OrcaRuntimeService },
  request: TerminalLeafMoveRequest
): Promise<TerminalLeafMoveResult> {
  if (!deps.store) {
    return { status: 'not_held' }
  }
  const result = await deps.store.moveTerminalLeafToNewTab(request)
  if (result.status !== 'moved') {
    return result
  }
  const { from: fromPaneKey, to: toPaneKey } = terminalLeafMovePaneKeys(request)
  try {
    // The process keeps the pane key baked into its env, so status must alias old to new.
    agentHookServer.transferPaneAuthority(
      fromPaneKey,
      toPaneKey,
      result.ptyId ?? undefined,
      Date.now(),
      { authorityVerified: true }
    )
  } catch (error) {
    console.warn('[pty] moved pane kept its old agent-status key:', error)
  }
  if (result.ptyId) {
    try {
      // Why: the PTY keeps its spawn-time key in its env; every main-side pane-key lookup must see the new owner.
      rememberPaneKeyForPty(result.ptyId, toPaneKey)
      rekeyMigrationUnsupportedPtyPaneKey(result.ptyId, toPaneKey)
      deps.runtime?.restampMovedPtySurface(result.ptyId, request.targetTabId, toPaneKey)
    } catch (error) {
      console.warn('[pty] moved pane kept its old PTY identity records:', error)
    }
  }
  try {
    deps.runtime?.getExistingOrchestrationDb()?.rekeyWorkerTerminalResourcePaneKey({
      fromPaneKey,
      toPaneKey
    })
  } catch (error) {
    console.warn('[pty] moved pane kept its old orchestration resource key:', error)
  }
  return result
}

export function installPtyLeafMoveIpcHandler(deps: {
  store?: Store
  runtime?: OrcaRuntimeService
}): void {
  getPtyIpc().handle('pty:moveLeafToNewTab', async (_event, args: unknown) => {
    if (!isTerminalLeafMoveRequest(args)) {
      return { status: 'refused', reason: 'invalid_request' } satisfies TerminalLeafMoveResult
    }
    return commitLeafMoveAndRekey(deps, args)
  })
}
