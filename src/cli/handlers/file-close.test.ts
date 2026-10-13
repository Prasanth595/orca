import { beforeEach, describe, expect, it, vi } from 'vitest'

const callMock = vi.fn()

vi.mock('../runtime-client', () => {
  class RuntimeClient {
    readonly isRemote: boolean
    call = callMock
    getCliStatus = vi.fn()
    openOrca = vi.fn()

    constructor(
      _userDataPath?: string,
      _requestTimeoutMs?: number,
      remotePairingCode?: string | null,
      environmentSelector?: string | null
    ) {
      this.isRemote = Boolean(remotePairingCode || environmentSelector)
    }
  }

  class RuntimeClientError extends Error {
    readonly code: string

    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  }

  class RuntimeRpcFailureError extends RuntimeClientError {
    readonly response: unknown

    constructor(response: unknown) {
      super('runtime_error', 'runtime_error')
      this.response = response
    }
  }

  return {
    RuntimeClient,
    RuntimeClientError,
    RuntimeRpcFailureError
  }
})

import { main } from '../index'
import { buildWorktree, okFixture, queueFixtures, worktreeListFixture } from '../test-fixtures'

describe('orca file close', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    callMock.mockReset()
    process.exitCode = undefined
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('closes a positional path in the inferred worktree', async () => {
    queueFixtures(
      callMock,
      worktreeListFixture([buildWorktree('/tmp/repo', 'main')]),
      okFixture('close', { worktree: 'wt-1', closed: ['a.ts'] })
    )
    await main(['file', 'close', 'a.ts'], '/tmp/repo')
    expect(callMock).toHaveBeenLastCalledWith('files.close', {
      worktree: 'id:repo::/tmp/repo',
      relativePath: 'a.ts',
      all: false,
      force: false
    })
    expect(console.log).toHaveBeenCalledWith('Closed 1 file tab.')
  })

  it('closes all files with explicit discard permission and JSON output', async () => {
    const response = okFixture('close', { worktree: 'wt-1', closed: ['a.ts', 'b.ts'] })
    queueFixtures(callMock, response)
    await main(['file', 'close', '--all', '--force', '--worktree', 'id:wt-1', '--json'], '/tmp')
    expect(callMock).toHaveBeenCalledWith('files.close', {
      worktree: 'id:wt-1',
      all: true,
      force: true
    })
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0])).toEqual(response)
  })

  it.each([[], ['a.ts', '--all'], ['--path'], ['--all', '--worktree']])(
    'rejects invalid targets %j before RPC',
    async (...args) => {
      await main(['file', 'close', ...args], '/tmp')
      expect(process.exitCode).toBe(1)
      expect(callMock).not.toHaveBeenCalled()
    }
  )

  it('relativizes an absolute path with the same worktree resolver as open', async () => {
    queueFixtures(
      callMock,
      okFixture('show', { worktree: buildWorktree('/tmp/repo', 'main') }),
      okFixture('close', { worktree: 'wt-1', closed: ['a.ts'] })
    )
    await main(['file', 'close', '/tmp/repo/a.ts', '--worktree', 'id:wt-1'], '/tmp')
    expect(callMock).toHaveBeenLastCalledWith('files.close', {
      worktree: 'id:wt-1',
      relativePath: 'a.ts',
      all: false,
      force: false
    })
  })

  it.each(['File tab not found: missing.ts', 'Unsaved changes: a.ts. Use --force to discard.'])(
    'reports runtime refusal: %s',
    async (message) => {
      callMock.mockRejectedValue(new Error(message))
      await main(['file', 'close', 'a.ts', '--worktree', 'id:wt-1'], '/tmp')
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining(message))
      expect(process.exitCode).toBe(1)
    }
  )

  it('requires a selector for remote calls', async () => {
    await main(['file', 'close', 'a.ts', '--pairing-code', 'pair-code'], '/tmp')
    expect(callMock).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('require --worktree'))
  })

  it('documents close and its discard flag', async () => {
    await main(['file', 'close', '--help'], '/tmp')
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('discard unsaved'))
  })
})
