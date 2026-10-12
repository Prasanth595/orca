import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentHookServer } from '../../../agent-hooks/server'
import type { Store } from '../../../persistence'
import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'
import type { TerminalLeafMoveResult } from '../../../../shared/terminal-leaf-move'
import {
  clearMigrationUnsupportedPty,
  getMigrationUnsupportedPtySnapshot,
  setMigrationUnsupportedPty
} from '../../../agent-hooks/migration-unsupported-pty-state'
import {
  getPtyIdForPaneKey,
  paneKeyPtyId,
  ptyPaneKey,
  rememberPaneKeyForPty
} from '../pane/key-state'
import { commitLeafMoveAndRekey } from './leaf-move'

const LEAF = '22222222-2222-4222-8222-222222222222'
const request = {
  worktreeId: 'repo-1::/tmp/wt',
  sourceTabId: 'tab-source',
  targetTabId: 'tab-target',
  leafId: LEAF,
  ptyId: 'pty-agent'
}

const FROM_KEY = `tab-source:${LEAF}`
const TO_KEY = `tab-target:${LEAF}`

function deps(result: TerminalLeafMoveResult) {
  const rekeyWorkerTerminalResourcePaneKey = vi.fn(() => 1)
  const restampMovedPtySurface = vi.fn()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the move reads only this Store method.
  const store = { moveTerminalLeafToNewTab: vi.fn(async () => result) } as unknown as Store
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the move reads only the orchestration DB accessor.
  const runtime = {
    getExistingOrchestrationDb: () => ({ rekeyWorkerTerminalResourcePaneKey }),
    restampMovedPtySurface
  } as unknown as OrcaRuntimeService
  return { store, runtime, rekeyWorkerTerminalResourcePaneKey, restampMovedPtySurface }
}

afterEach(() => {
  vi.restoreAllMocks()
  ptyPaneKey.clear()
  paneKeyPtyId.clear()
  clearMigrationUnsupportedPty('pty-agent')
})

describe('pty:moveLeafToNewTab', () => {
  it('aliases agent status and re-keys worker resources after a committed move', async () => {
    const transfer = vi.spyOn(agentHookServer, 'transferPaneAuthority').mockImplementation(() => {})
    const { store, runtime, rekeyWorkerTerminalResourcePaneKey } = deps({
      status: 'moved',
      ptyId: 'pty-agent'
    })

    await expect(commitLeafMoveAndRekey({ store, runtime }, request)).resolves.toEqual({
      status: 'moved',
      ptyId: 'pty-agent'
    })

    expect(transfer).toHaveBeenCalledWith(
      `tab-source:${LEAF}`,
      `tab-target:${LEAF}`,
      'pty-agent',
      expect.any(Number),
      { authorityVerified: true }
    )
    expect(rekeyWorkerTerminalResourcePaneKey).toHaveBeenCalledWith({
      fromPaneKey: `tab-source:${LEAF}`,
      toPaneKey: `tab-target:${LEAF}`
    })
  })

  it.each<TerminalLeafMoveResult>([
    { status: 'not_held' },
    { status: 'refused', reason: 'pty_mismatch' }
  ])('leaves every pane key alone when the move did not commit (%o)', async (result) => {
    const transfer = vi.spyOn(agentHookServer, 'transferPaneAuthority').mockImplementation(() => {})
    const { store, runtime, rekeyWorkerTerminalResourcePaneKey, restampMovedPtySurface } =
      deps(result)
    rememberPaneKeyForPty('pty-agent', FROM_KEY)

    await expect(commitLeafMoveAndRekey({ store, runtime }, request)).resolves.toEqual(result)

    expect(restampMovedPtySurface).not.toHaveBeenCalled()
    expect(getPtyIdForPaneKey(FROM_KEY)).toBe('pty-agent')
    expect(transfer).not.toHaveBeenCalled()
    expect(rekeyWorkerTerminalResourcePaneKey).not.toHaveBeenCalled()
  })

  it('moves the pane-key lookups to the new key, and exit cleanup then finds them', async () => {
    vi.spyOn(agentHookServer, 'transferPaneAuthority').mockImplementation(() => {})
    rememberPaneKeyForPty('pty-agent', FROM_KEY)
    const { store, runtime } = deps({ status: 'moved', ptyId: 'pty-agent' })

    await commitLeafMoveAndRekey({ store, runtime }, request)

    expect(getPtyIdForPaneKey(TO_KEY)).toBe('pty-agent')
    expect(getPtyIdForPaneKey(FROM_KEY)).toBeUndefined()
    expect(ptyPaneKey.get('pty-agent')).toBe(TO_KEY)
  })

  it('re-stamps the runtime PTY record with the new tab and pane key', async () => {
    vi.spyOn(agentHookServer, 'transferPaneAuthority').mockImplementation(() => {})
    const { store, runtime, restampMovedPtySurface } = deps({ status: 'moved', ptyId: 'pty-agent' })

    await commitLeafMoveAndRekey({ store, runtime }, request)

    expect(restampMovedPtySurface).toHaveBeenCalledWith('pty-agent', 'tab-target', TO_KEY)
  })

  it('re-keys a migration-unsupported entry so closing the source tab keeps it', async () => {
    vi.spyOn(agentHookServer, 'transferPaneAuthority').mockImplementation(() => {})
    setMigrationUnsupportedPty({
      ptyId: 'pty-agent',
      tabId: 'tab-source',
      paneKey: FROM_KEY,
      reason: 'legacy-numeric-pane-key',
      source: 'local',
      updatedAt: 1
    })
    const { store, runtime } = deps({ status: 'moved', ptyId: 'pty-agent' })

    await commitLeafMoveAndRekey({ store, runtime }, request)

    expect(getMigrationUnsupportedPtySnapshot()).toEqual([
      expect.objectContaining({ ptyId: 'pty-agent', paneKey: TO_KEY, tabId: 'tab-target' })
    ])
  })

  it('touches no PTY lookup or runtime record for a move with no PTY', async () => {
    vi.spyOn(agentHookServer, 'transferPaneAuthority').mockImplementation(() => {})
    const { store, runtime, restampMovedPtySurface } = deps({ status: 'moved', ptyId: null })

    await commitLeafMoveAndRekey({ store, runtime }, { ...request, ptyId: null })

    expect(restampMovedPtySurface).not.toHaveBeenCalled()
    expect(paneKeyPtyId.size).toBe(0)
  })
})
