import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexAccountService } from '../codex-accounts/service'

const state = vi.hoisted(() => {
  const deps: { current: object | null } = { current: null }
  return {
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
    deps,
    keepWithConversations: vi.fn(),
    keepRegistryOnly: vi.fn((_ptyIds: readonly string[]): string[] => [])
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      state.handlers.set(channel, handler)
    }
  }
}))
vi.mock('../agent-accounts/agent-account-keep-wiring', () => ({
  installedAgentKeepDeps: () => state.deps.current
}))
vi.mock('../agent-accounts/agent-account-keep', () => ({
  keepStaleCodexPanesAndConversations: state.keepWithConversations
}))
vi.mock('../codex/codex-stale-pane-accounts', () => ({
  keepStaleCodexPanes: state.keepRegistryOnly,
  listStaleCodexPanes: vi.fn(() => [])
}))

import { readKeepStalePanes, registerCodexAccountHandlers } from './codex-accounts'

function keepStalePanes(args: unknown): unknown {
  return state.handlers.get('codexAccounts:keepStalePanes')!({}, args)
}

beforeEach(() => {
  state.handlers.clear()
  state.deps.current = null
  state.keepWithConversations.mockReset()
  state.keepRegistryOnly.mockReset()
  const service = { onPendingLoginUrlChanged: vi.fn() }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: registration only subscribes to pending login URLs; no other service method runs here.
  registerCodexAccountHandlers(service as unknown as CodexAccountService)
})

describe('codexAccounts:keepStalePanes', () => {
  it('keeps panes and their conversations through the host producer when it runs', () => {
    state.deps.current = { marker: true }
    keepStalePanes({ panes: [{ ptyId: 'pty-1', paneKey: 'tab:leaf' }] })
    expect(state.keepWithConversations).toHaveBeenCalledWith(state.deps.current, [
      { ptyId: 'pty-1', paneKey: 'tab:leaf' }
    ])
    expect(state.keepRegistryOnly).not.toHaveBeenCalled()
  })

  it('keeps the panes alone where no producer runs', () => {
    keepStalePanes({ panes: [{ ptyId: 'pty-1' }] })
    expect(state.keepRegistryOnly).toHaveBeenCalledWith(['pty-1'])
    expect(state.keepWithConversations).not.toHaveBeenCalled()
  })

  it('ignores a request with nothing valid in it', () => {
    keepStalePanes({ ptyIds: ['pty-1'] })
    expect(state.keepRegistryOnly).not.toHaveBeenCalled()
    expect(state.keepWithConversations).not.toHaveBeenCalled()
  })
})

describe('readKeepStalePanes', () => {
  it('keeps well-formed panes and drops the rest', () => {
    expect(
      readKeepStalePanes([
        { ptyId: 'pty-1', paneKey: 'tab:leaf' },
        { ptyId: 'pty-2', paneKey: 7 },
        { ptyId: '' },
        { ptyId: 'x'.repeat(513) },
        null,
        'pty-3'
      ])
    ).toEqual([{ ptyId: 'pty-1', paneKey: 'tab:leaf' }, { ptyId: 'pty-2' }])
    expect(readKeepStalePanes(undefined)).toEqual([])
  })
})
