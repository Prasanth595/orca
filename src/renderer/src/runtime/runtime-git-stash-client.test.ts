import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stashRuntimeGit, listRuntimeGitStashes } from './runtime-git-stash-client'
import { clearRuntimeCompatibilityCacheForTests } from './runtime-rpc-client'
import {
  createCompatibleRuntimeStatusResponseIfNeeded,
  type RuntimeEnvironmentCallRequest
} from './runtime-compatibility-test-fixture'

const stash = vi.fn()
const stashList = vi.fn()
const remote = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  clearRuntimeCompatibilityCacheForTests()
  vi.stubGlobal('window', {
    api: {
      git: { stash, stashList },
      runtimeEnvironments: {
        call: (args: RuntimeEnvironmentCallRequest) =>
          createCompatibleRuntimeStatusResponseIfNeeded(args) ?? remote(args)
      }
    }
  })
})

describe('stash runtime client', () => {
  it('uses registered folder paths on the local host without requiring a worktree ID', async () => {
    stash.mockResolvedValue({ output: 'saved' })
    await expect(
      stashRuntimeGit(
        { target: { kind: 'local' }, worktreeId: null, worktreePath: '/folder' },
        { action: 'push' }
      )
    ).resolves.toEqual({ output: 'saved' })
    expect(stash).toHaveBeenCalledWith({
      worktreePath: '/folder',
      connectionId: undefined,
      action: 'push'
    })
    expect(remote).not.toHaveBeenCalled()
  })
  it('sends the selected stash to its owner runtime', async () => {
    const selected = { ref: 'stash@{1}', oid: 'a'.repeat(40), subject: 'work' }
    remote.mockResolvedValue({ ok: true, result: { output: 'popped' } })
    await stashRuntimeGit(
      {
        target: { kind: 'environment', environmentId: 'owner' },
        worktreeId: 'wt-1',
        worktreePath: '/remote'
      },
      { action: 'pop', stash: selected }
    )
    expect(remote).toHaveBeenCalledWith({
      selector: 'owner',
      method: 'git.stash',
      params: { worktree: 'id:wt-1', action: 'pop', stash: selected },
      timeoutMs: 30_000
    })
    expect(stash).not.toHaveBeenCalled()
  })
  it('fetches stash lists from the owner runtime', async () => {
    remote.mockResolvedValue({ ok: true, result: { entries: [], truncated: false } })
    await expect(
      listRuntimeGitStashes({
        target: { kind: 'environment', environmentId: 'owner' },
        worktreeId: 'wt-1',
        worktreePath: '/remote'
      })
    ).resolves.toEqual({ entries: [], truncated: false })
    expect(stashList).not.toHaveBeenCalled()
  })
  it('reports older hosts without falling back to local mutations', async () => {
    remote.mockResolvedValue({
      ok: false,
      error: { code: 'method_not_found', message: 'Unknown method' }
    })
    const context = {
      target: { kind: 'environment', environmentId: 'old' } as const,
      worktreeId: 'wt-1',
      worktreePath: '/remote'
    }
    await expect(stashRuntimeGit(context, { action: 'push' })).rejects.toThrow('Update Orca')
    await expect(listRuntimeGitStashes(context)).rejects.toThrow('Update Orca')
    expect(stash).not.toHaveBeenCalled()
    expect(stashList).not.toHaveBeenCalled()
  })
  it('refuses unresolved remote workspaces before dispatch', async () => {
    await expect(
      stashRuntimeGit(
        {
          target: { kind: 'environment', environmentId: 'remote' },
          worktreePath: '/remote',
          worktreeId: null
        },
        { action: 'pop' }
      )
    ).rejects.toThrow('Missing workspace')
    expect(remote).not.toHaveBeenCalled()
    expect(stash).not.toHaveBeenCalled()
  })
})
