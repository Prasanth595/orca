import { beforeEach, describe, expect, it, vi } from 'vitest'
import { syncPaneTerminalTitle } from './pane-terminal-title-sync'

const mocks = vi.hoisted(() => ({
  callRuntimeRpc: vi.fn(),
  getRuntimeEnvironmentIdForWorktree: vi.fn()
}))

vi.mock('./runtime-rpc-client', () => ({ callRuntimeRpc: mocks.callRuntimeRpc }))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getRuntimeEnvironmentIdForWorktree: mocks.getRuntimeEnvironmentIdForWorktree
}))
vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))

const args = { worktreeId: 'wt', tabId: 'tab', leafId: 'leaf', title: 'DRI' }

beforeEach(() => {
  mocks.callRuntimeRpc.mockReset()
  mocks.getRuntimeEnvironmentIdForWorktree.mockReset()
  mocks.getRuntimeEnvironmentIdForWorktree.mockReturnValue(null)
})

describe('syncPaneTerminalTitle', () => {
  it('resolves the pane and renames it on the local runtime', async () => {
    mocks.callRuntimeRpc
      .mockResolvedValueOnce({ terminal: { handle: 'term_1' } })
      .mockResolvedValueOnce({ rename: { handle: 'term_1', title: 'DRI' } })

    await syncPaneTerminalTitle(args)

    expect(mocks.callRuntimeRpc.mock.calls).toEqual([
      [{ kind: 'local' }, 'terminal.resolvePane', { paneKey: 'tab:leaf', worktreeId: 'wt' }],
      [{ kind: 'local' }, 'terminal.rename', { terminal: 'term_1', title: 'DRI' }]
    ])
  })

  it('routes the mirror to the owning remote runtime', async () => {
    mocks.getRuntimeEnvironmentIdForWorktree.mockReturnValue('env-1')
    mocks.callRuntimeRpc
      .mockResolvedValueOnce({ terminal: { handle: 'term_1' } })
      .mockResolvedValueOnce({ rename: { handle: 'term_1', title: 'DRI' } })

    await syncPaneTerminalTitle(args)

    expect(mocks.callRuntimeRpc.mock.calls.map(([target]) => target)).toEqual([
      { kind: 'environment', environmentId: 'env-1' },
      { kind: 'environment', environmentId: 'env-1' }
    ])
  })

  it('does nothing when the host has no terminal for the pane', async () => {
    mocks.callRuntimeRpc.mockResolvedValueOnce({ terminal: null })

    await syncPaneTerminalTitle(args)

    expect(mocks.callRuntimeRpc).toHaveBeenCalledTimes(1)
  })

  it('forwards a null title to clear the host title', async () => {
    mocks.callRuntimeRpc
      .mockResolvedValueOnce({ terminal: { handle: 'term_1' } })
      .mockResolvedValueOnce({ rename: { handle: 'term_1', title: null } })

    await syncPaneTerminalTitle({ ...args, title: null })

    expect(mocks.callRuntimeRpc.mock.calls[1]).toEqual([
      { kind: 'local' },
      'terminal.rename',
      { terminal: 'term_1', title: null }
    ])
  })

  it('serializes rapid renames for the same pane', async () => {
    let resolveFirst!: (value: unknown) => void
    mocks.callRuntimeRpc
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          })
      )
      .mockResolvedValueOnce({ rename: { handle: 'term_1', title: 'one' } })
      .mockResolvedValueOnce({ terminal: { handle: 'term_1' } })
      .mockResolvedValueOnce({ rename: { handle: 'term_1', title: 'two' } })

    const first = syncPaneTerminalTitle({ ...args, title: 'one' })
    const second = syncPaneTerminalTitle({ ...args, title: 'two' })

    await vi.waitFor(() => expect(mocks.callRuntimeRpc).toHaveBeenCalledTimes(1))
    resolveFirst({ terminal: { handle: 'term_1' } })
    await Promise.all([first, second])

    const renameTitles = mocks.callRuntimeRpc.mock.calls
      .filter(([, method]) => method === 'terminal.rename')
      .map(([, , params]) => params.title)
    expect(renameTitles).toEqual(['one', 'two'])
  })
})
