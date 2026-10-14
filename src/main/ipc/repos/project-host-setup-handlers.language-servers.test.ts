import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectHostSetupDeleteResult } from '../../../shared/project-types'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, args: unknown) => unknown>(),
  disposeForRepo: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (event: unknown, args: unknown) => unknown) =>
      mocks.handlers.set(name, handler)
  }
}))
vi.mock('./repos-changed-notification', () => ({ notifyReposChanged: vi.fn() }))
vi.mock('../../lsp/lsp-session-registry', () => ({
  getLspSessionManager: () => ({ disposeForRepo: mocks.disposeForRepo })
}))

import { registerProjectHostSetupHandlers } from './project-host-setup-handlers'

const project = { id: 'p1', name: 'App', createdAt: 1, updatedAt: 1 }
const setup = { id: 's1', projectId: 'p1', hostId: 'local', repoId: 'r1' }
const repo = { id: 'r1', path: '/app', displayName: 'App', badgeColor: '#000', addedAt: 1 }

function deleteResult(overrides: Partial<ProjectHostSetupDeleteResult> = {}) {
  return { project, setup, repo, ...overrides }
}

describe('projectHostSetups:delete stops language servers', () => {
  const store = { deleteProjectHostSetup: vi.fn() }
  const deleteSetup = () => mocks.handlers.get('projectHostSetups:delete')?.({}, { setupId: 's1' })

  beforeEach(() => {
    mocks.handlers.clear()
    mocks.disposeForRepo.mockClear()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the delete handler only calls deleteProjectHostSetup on this store.
    registerProjectHostSetupHandlers({} as never, store as never)
  })

  it('disposes the sessions of a removed local repo', () => {
    store.deleteProjectHostSetup.mockReturnValueOnce(deleteResult())

    deleteSetup()

    expect(mocks.disposeForRepo).toHaveBeenCalledWith('r1')
  })

  it('leaves sessions alone when a remote repo is removed', () => {
    store.deleteProjectHostSetup.mockReturnValueOnce(
      deleteResult({ repo: { ...repo, executionHostId: 'ssh:box' } })
    )

    deleteSetup()

    expect(mocks.disposeForRepo).not.toHaveBeenCalled()
  })

  it('does not dispose when only a stale setup was dropped', () => {
    store.deleteProjectHostSetup.mockReturnValueOnce(deleteResult({ repo: undefined }))

    deleteSetup()

    expect(mocks.disposeForRepo).not.toHaveBeenCalled()
  })
})
