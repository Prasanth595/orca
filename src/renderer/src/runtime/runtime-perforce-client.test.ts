import { beforeEach, describe, expect, it, vi } from 'vitest'

const { callRuntimeRpc, hostByWorktree, ipc } = vi.hoisted(() => ({
  callRuntimeRpc: vi.fn(),
  hostByWorktree: new Map<string, string>(),
  ipc: {
    detect: vi.fn(),
    status: vi.fn(),
    open: vi.fn(),
    generateDescription: vi.fn()
  }
}))

vi.mock('./runtime-rpc-client', () => ({ callRuntimeRpc }))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ settings: { perforce: { p4Port: 'ssl:p4:1666' } } }) }
}))
vi.mock('@/store/slices/worktrees/listing/worktree-owner-target', () => ({
  tryRuntimeTargetForWorktreeOwner: (_state: unknown, worktreeId: string) => {
    const environmentId = hostByWorktree.get(worktreeId)
    return environmentId ? { kind: 'environment', environmentId } : { kind: 'local' }
  }
}))

import { RuntimeRpcCallError } from './runtime-rpc-result'
import { PERFORCE_SERVER_TOO_OLD_MESSAGE, perforceClient } from './runtime-perforce-client'

const local = { worktreeId: 'repo-1::/work/local', worktreePath: '/work/local' }
const hosted = { worktreeId: 'repo-2::/srv/p4', worktreePath: '/srv/p4' }

function methodNotFound(): RuntimeRpcCallError {
  return new RuntimeRpcCallError({
    id: 'r',
    ok: false,
    error: { code: 'method_not_found', message: 'Unknown method' },
    _meta: { runtimeId: 'remote' }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  hostByWorktree.clear()
  hostByWorktree.set(hosted.worktreeId, 'env-1')
  vi.stubGlobal('window', { api: { perforce: ipc } })
})

describe('perforceClient routing', () => {
  it('keeps local workspaces on IPC without leaking the worktree id', async () => {
    ipc.status.mockResolvedValue({ entries: [] })
    await perforceClient.status(local)
    expect(ipc.status).toHaveBeenCalledWith({ worktreePath: '/work/local' })
    expect(callRuntimeRpc).not.toHaveBeenCalled()
  })

  it('keeps calls without a worktree id on IPC (direct SSH and settings probes)', async () => {
    await perforceClient.open({ worktreePath: '/x', connectionId: 'ssh-1', filePaths: ['a'] })
    expect(ipc.open).toHaveBeenCalledWith({
      worktreePath: '/x',
      connectionId: 'ssh-1',
      filePaths: ['a']
    })
  })

  it('sends runtime-hosted workspaces to the hosting orcad with the user p4 settings', async () => {
    callRuntimeRpc.mockResolvedValue({ success: true, output: '' })
    await perforceClient.open({ ...hosted, filePaths: ['src/a.ts'] })
    expect(ipc.open).not.toHaveBeenCalled()
    const [target, method, params] = callRuntimeRpc.mock.calls[0]!
    expect(target).toEqual({ kind: 'environment', environmentId: 'env-1' })
    expect(method).toBe('perforce.open')
    expect(params).toMatchObject({
      filePaths: ['src/a.ts'],
      worktree: expect.stringContaining('repo-2::/srv/p4'),
      settings: expect.objectContaining({ p4Port: 'ssl:p4:1666' })
    })
    expect(params).not.toHaveProperty('worktreePath')
  })

  it('treats a server without perforce methods as "not Perforce" for detection', async () => {
    callRuntimeRpc.mockRejectedValue(methodNotFound())
    await expect(perforceClient.detect(hosted)).resolves.toEqual({
      isWorkspace: false,
      reason: 'error',
      message: PERFORCE_SERVER_TOO_OLD_MESSAGE
    })
  })

  it('explains an outdated server for other operations', async () => {
    callRuntimeRpc.mockRejectedValue(methodNotFound())
    await expect(perforceClient.status(hosted)).rejects.toThrow(PERFORCE_SERVER_TOO_OLD_MESSAGE)
  })

  it('reads the changelist diff on the host and generates the description locally', async () => {
    callRuntimeRpc.mockResolvedValue('--- a\n+++ b\n+change')
    ipc.generateDescription.mockResolvedValue({ success: true, message: 'Describe' })
    await perforceClient.generateDescription({
      ...hosted,
      changelist: 4,
      filePaths: ['src/a.ts']
    })
    expect(callRuntimeRpc.mock.calls[0]![1]).toBe('perforce.diffText')
    expect(ipc.generateDescription).toHaveBeenCalledWith({
      worktreePath: '/srv/p4',
      connectionId: undefined,
      changelist: 4,
      filePaths: ['src/a.ts'],
      patch: '--- a\n+++ b\n+change'
    })
  })

  it('probes read-only files only on hosted workspaces', async () => {
    expect(await perforceClient.isReadOnlyFile({ ...local, filePath: 'a' })).toBe(false)
    expect(callRuntimeRpc).not.toHaveBeenCalled()
    callRuntimeRpc.mockResolvedValue(true)
    expect(await perforceClient.isReadOnlyFile({ ...hosted, filePath: 'a' })).toBe(true)
    expect(callRuntimeRpc.mock.calls[0]![1]).toBe('perforce.isReadOnlyFile')
  })
})
