import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectGroup } from '../../shared/project-group-types'
import type { Repo } from '../../shared/repo-types'
import type * as RepoModule from '../git/repo'

const { detectRepoIconAndUpstreamMock } = vi.hoisted(() => ({
  detectRepoIconAndUpstreamMock: vi.fn()
}))

// Why: the tree holds empty `.git` folders, so real git would not call them repositories.
vi.mock('../git/repo', async (importOriginal) => ({
  ...(await importOriginal<typeof RepoModule>()),
  isGitRepo: (path: string) => path.endsWith('service'),
  isGitRepoAsync: async (path: string) => path.endsWith('service')
}))
vi.mock('../git/runner', () => ({
  awaitWindowsHostGitEnvironmentReady: vi.fn(async () => undefined)
}))
vi.mock('../git/worktree', () => ({
  listWorktreeGraph: vi.fn(async () => [])
}))
vi.mock('../repo-icon-autodetect', () => ({
  detectRepoIconAndUpstream: detectRepoIconAndUpstreamMock
}))

import { RuntimeNestedRepoImport } from './runtime-nested-repo-import'

const ICON = {
  type: 'image',
  src: 'https://github.com/acme.png?size=64',
  source: 'github',
  label: 'acme/service'
} as const

const group: ProjectGroup = {
  id: 'group-1',
  name: 'Platform',
  parentPath: '/srv/platform',
  parentGroupId: null,
  createdFrom: 'folder-scan',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 1
}

describe('RuntimeNestedRepoImport', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orca-runtime-nested-import-'))
    await mkdir(join(root, 'service', '.git'), { recursive: true })
    detectRepoIconAndUpstreamMock.mockReset()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function createImport(added: Repo[]): RuntimeNestedRepoImport {
    const store = {
      getRepos: () => [...added],
      addRepo: (repo: Repo) => {
        added.push(repo)
      },
      createProjectGroup: () => group,
      moveProjectToGroup: vi.fn(),
      deleteProjectGroup: vi.fn()
    }
    return new RuntimeNestedRepoImport({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub covers every store method the nested import calls.
      getStore: () => store as never,
      invalidateResolvedWorktrees: vi.fn(),
      invalidateWorktreeScan: vi.fn(),
      notifyReposChanged: vi.fn()
    })
  }

  it('gives an imported repo the detected icon and fork marker', async () => {
    detectRepoIconAndUpstreamMock.mockResolvedValue({ repoIcon: ICON, upstream: null })
    const added: Repo[] = []
    const repoPath = join(root, 'service')

    const result = await createImport(added).import({
      parentPath: root,
      groupName: 'Platform',
      projectPaths: [repoPath],
      mode: 'group'
    })

    expect(result).toMatchObject({ importedCount: 1, failedCount: 0 })
    expect(detectRepoIconAndUpstreamMock).toHaveBeenCalledWith({
      repoPath,
      kind: 'git',
      executionHostId: 'local'
    })
    expect(added).toEqual([
      expect.objectContaining({ path: repoPath, repoIcon: ICON, upstream: null })
    ])
  })

  it('still imports a repo when nothing is detected', async () => {
    detectRepoIconAndUpstreamMock.mockResolvedValue({})
    const added: Repo[] = []
    const repoPath = join(root, 'service')

    const result = await createImport(added).import({
      parentPath: root,
      groupName: 'Platform',
      projectPaths: [repoPath],
      mode: 'group'
    })

    expect(result).toMatchObject({ importedCount: 1, failedCount: 0 })
    expect(added).toEqual([expect.objectContaining({ path: repoPath, kind: 'git' })])
    expect(added[0]).not.toHaveProperty('repoIcon')
  })
})
