import { getPtyIpc } from '../../pty-host-bindings'
import type { Store } from '../../../persistence'
import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'
import { agentHookServer } from '../../../agent-hooks/server'
import { rekeyMigrationUnsupportedPtyPaneKey } from '../../../agent-hooks/migration-unsupported-pty-state'
import { rememberPaneKeyForPty } from '../pane/key-state'
import {
  isTerminalLeafIntoTabRequest,
  isTerminalLeafMoveRequest,
  terminalLeafMovePaneKeys,
  type TerminalLeafIntoTabRequest,
  type TerminalLeafIntoTabResult,
  type TerminalLeafMoveRequest,
  type TerminalLeafMoveResult,
  type TerminalPaneKeyMove
} from '../../../../shared/terminal-leaf-move'

type LeafMoveDeps = { store?: Store; runtime?: OrcaRuntimeService }

/** Re-keys main's in-memory pane identity after a committed move: status, PTY lookups, runtime, orchestration. */
function rekeyMainIdentity(
  deps: LeafMoveDeps,
  move: TerminalPaneKeyMove,
  ptyId: string | null
): void {
  const { from: fromPaneKey, to: toPaneKey } = terminalLeafMovePaneKeys(move)
  try {
    // The process keeps the pane key baked into its env, so status must alias old to new.
    agentHookServer.transferPaneAuthority(fromPaneKey, toPaneKey, ptyId ?? undefined, Date.now(), {
      authorityVerified: true
    })
  } catch (error) {
    console.warn('[pty] moved pane kept its old agent-status key:', error)
  }
  if (ptyId) {
    try {
      // Why: the PTY keeps its spawn-time key in its env; every main-side pane-key lookup must see the new owner.
      rememberPaneKeyForPty(ptyId, toPaneKey)
      rekeyMigrationUnsupportedPtyPaneKey(ptyId, toPaneKey)
      deps.runtime?.restampMovedPtySurface(ptyId, move.targetTabId, toPaneKey)
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
}

/** Durable move first; agent-status and orchestration keys follow only a committed move. */
export async function commitLeafMoveAndRekey(
  deps: LeafMoveDeps,
  request: TerminalLeafMoveRequest
): Promise<TerminalLeafMoveResult> {
  if (!deps.store) {
    return { status: 'not_held' }
  }
  const result = await deps.store.moveTerminalLeafToNewTab(request)
  if (result.status === 'moved') {
    rekeyMainIdentity(deps, request, result.ptyId)
  }
  return result
}

/** The join into an existing tab: the same ordering, and nothing is re-keyed for a refusal or not_held. */
export async function commitLeafIntoTabAndRekey(
  deps: LeafMoveDeps,
  request: TerminalLeafIntoTabRequest
): Promise<TerminalLeafIntoTabResult> {
  if (!deps.store) {
    return { status: 'not_held' }
  }
  const result = await deps.store.moveTerminalLeafIntoTab(request)
  if (result.status === 'moved') {
    rekeyMainIdentity(deps, request, result.ptyId)
  }
  return result
}

export function installPtyLeafMoveIpcHandler(deps: LeafMoveDeps): void {
  getPtyIpc().handle('pty:moveLeafToNewTab', async (_event, args: unknown) => {
    if (!isTerminalLeafMoveRequest(args)) {
      return { status: 'refused', reason: 'invalid_request' } satisfies TerminalLeafMoveResult
    }
    return commitLeafMoveAndRekey(deps, args)
  })
  getPtyIpc().handle('pty:moveLeafIntoTab', async (_event, args: unknown) => {
    if (!isTerminalLeafIntoTabRequest(args)) {
      return { status: 'refused', reason: 'invalid_request' } satisfies TerminalLeafIntoTabResult
    }
    return commitLeafIntoTabAndRekey(deps, args)
  })
}
