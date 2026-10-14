import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import { OrcaRuntimeService } from './orca-runtime'

const mocks = vi.hoisted(() => ({ disposeForRepo: vi.fn() }))
vi.mock('../lsp/lsp-session-registry', () => ({
  getLspSessionManager: () => ({ disposeForRepo: mocks.disposeForRepo })
}))

function createRuntime(removeProjectForHost = vi.fn()) {
  const repos: Repo[] = [
    {
      id: 'local-repo',
      path: '/laptop/app',
      displayName: 'App',
      badgeColor: '#000',
      addedAt: 1,
      executionHostId: 'local'
    },
    {
      id: 'remote-repo',
      path: '/remote/app',
      displayName: 'Remote App',
      badgeColor: '#000',
      addedAt: 2,
      connectionId: 'ssh-1'
    }
  ]
  const store = {
    getRepos: () => [...repos],
    getRepo: (id: string) => repos.find((repo) => repo.id === id) ?? null,
    getAllWorktreeMeta: () => ({}),
    getWorktreeMeta: () => null,
    setWorktreeMeta: vi.fn(),
    removeWorktreeMeta: vi.fn(),
    getGitHubCache: () => null,
    removeProjectForHost
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: repo.rm only reads repos and calls removeProjectForHost on this store.
  return new OrcaRuntimeService(store as never)
}

describe('repo.rm stops language servers', () => {
  beforeEach(() => {
    mocks.disposeForRepo.mockClear()
  })

  it('disposes the sessions of a removed local repo', async () => {
    await createRuntime().removeProject('local-repo')

    expect(mocks.disposeForRepo).toHaveBeenCalledWith('local-repo')
  })

  it('leaves sessions alone when a remote repo is removed', async () => {
    await createRuntime().removeProject('remote-repo')

    expect(mocks.disposeForRepo).not.toHaveBeenCalled()
  })

  it('does not dispose when the removal throws', async () => {
    const runtime = createRuntime(
      vi.fn(() => {
        throw new Error('nope')
      })
    )

    await expect(runtime.removeProject('local-repo')).rejects.toThrow('nope')
    expect(mocks.disposeForRepo).not.toHaveBeenCalled()
  })
})
