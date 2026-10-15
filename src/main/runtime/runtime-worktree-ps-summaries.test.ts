import { describe, expect, it } from 'vitest'
import { buildRuntimeWorktreePsSummaries } from './runtime-worktree-ps-summaries'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'
import type { RuntimeStore } from './runtime-store-contract'

describe('buildRuntimeWorktreePsSummaries', () => {
  it('preserves persisted host ownership over the resolved row fallback', () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the summary builder reads only these worktree fields.
    const worktree = {
      id: 'repo-1::/workspace/app',
      repoId: 'repo-1',
      hostId: 'ssh:resolved-host',
      path: '/workspace/app',
      branch: 'feature',
      isArchived: false,
      isMainWorktree: false,
      parentWorktreeId: null,
      childWorktreeIds: [],
      lineage: null,
      lastActivityAt: 0
    } as unknown as ResolvedWorktree
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the summary builder reads only these store methods.
    const store = {
      getRepos: () => [],
      getWorktreeMeta: () => ({
        hostId: 'ssh:persisted-host',
        linkedPR: 42,
        linkedItems: [{ provider: 'github', type: 'pr', number: 57 }]
      }),
      getAllWorktreeMeta: () => ({}),
      getFolderWorkspaces: () => [],
      getProjectGroups: () => []
    } as unknown as RuntimeStore

    const summary = buildRuntimeWorktreePsSummaries({
      store,
      resolvedWorktrees: [worktree],
      platformByRepoId: new Map()
    }).get(worktree.id)

    expect(summary?.hostId).toBe('ssh:persisted-host')
    expect(summary?.linkedItems).toEqual([
      { provider: 'github', type: 'pr', number: 57 },
      { provider: 'github', type: 'pr', number: 42 }
    ])
  })

  it('carries the error of a failed delete the host still lists', () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the builder reads only these fields for a git row.
    const worktree = {
      id: 'repo-1::/workspace/app',
      repoId: 'repo-1',
      path: '/workspace/app',
      branch: 'feature',
      isArchived: false,
      isMainWorktree: false,
      parentWorktreeId: null,
      childWorktreeIds: [],
      lineage: null,
      lastActivityAt: 0,
      removalError: 'Operation not permitted'
    } as unknown as ResolvedWorktree
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the builder reads only these store members.
    const store = {
      getRepos: () => [],
      getWorktreeMeta: () => undefined,
      getAllWorktreeMeta: () => ({}),
      getFolderWorkspaces: () => [],
      getProjectGroups: () => []
    } as unknown as RuntimeStore

    const summary = buildRuntimeWorktreePsSummaries({
      store,
      resolvedWorktrees: [worktree],
      platformByRepoId: new Map()
    }).get(worktree.id)

    expect(summary?.removalError).toBe('Operation not permitted')
  })

  it('marks only rows whose project is incognito, so older clients see no new field otherwise', () => {
    const row = (repoId: string) => ({
      id: `${repoId}::/workspace/${repoId}`,
      repoId,
      path: `/workspace/${repoId}`,
      branch: 'feature',
      isArchived: false,
      isMainWorktree: false,
      parentWorktreeId: null,
      childWorktreeIds: [],
      lineage: null,
      lastActivityAt: 0
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the builder reads only these fields for a git row.
    const worktrees = [row('secret'), row('open')] as unknown as ResolvedWorktree[]
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the builder reads only these store members.
    const store = {
      getRepos: () => [
        { id: 'secret', displayName: 'Secret', incognito: true },
        { id: 'open', displayName: 'Open', incognito: false }
      ],
      getWorktreeMeta: () => undefined,
      getAllWorktreeMeta: () => ({}),
      getFolderWorkspaces: () => [],
      getProjectGroups: () => []
    } as unknown as RuntimeStore

    const summaries = buildRuntimeWorktreePsSummaries({
      store,
      resolvedWorktrees: worktrees,
      platformByRepoId: new Map()
    })

    expect(summaries.get('secret::/workspace/secret')?.repoIncognito).toBe(true)
    expect(summaries.get('open::/workspace/open')).not.toHaveProperty('repoIncognito')
  })
})
