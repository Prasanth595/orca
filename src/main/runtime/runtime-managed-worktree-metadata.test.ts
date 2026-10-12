import { describe, expect, it, vi } from 'vitest'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import type { Worktree } from '../../shared/worktree/types'
import { updateRuntimeManagedWorktreeMetadata } from './runtime-managed-worktree-metadata'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'
import type { RuntimeStore } from './runtime-store-contract'

describe('updateRuntimeManagedWorktreeMetadata', () => {
  it('writes metadata through the resolved worktree execution host', async () => {
    const worktree = {
      id: 'repo-1::/workspace/app',
      repoId: 'repo-1',
      hostId: 'ssh:build-box',
      path: '/workspace/app',
      instanceId: 'instance-1'
    } as unknown as ResolvedWorktree
    const setWorktreeMeta = vi.fn()
    const setWorktreeMetaForHost = vi.fn()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the update only reads these store members.
    const store = {
      getRepos: () => [],
      getWorktreeMeta: () => undefined,
      setWorktreeMeta,
      setWorktreeMetaForHost
    } as unknown as RuntimeStore
    const ports = {
      resolveWorktree: vi.fn(async () => worktree),
      validateParent: vi.fn(),
      invalidateResolved: vi.fn(),
      invalidateScan: vi.fn(),
      notifyChanged: vi.fn(),
      showWorktree: vi.fn(async () => worktree as unknown as Worktree)
    }

    await updateRuntimeManagedWorktreeMetadata({
      selector: `id:${worktree.id}`,
      updates: { comment: 'remote row only' },
      store,
      ports
    })

    expect(setWorktreeMetaForHost).toHaveBeenCalledWith(worktree.id, 'ssh:build-box', {
      comment: 'remote row only'
    })
    expect(setWorktreeMeta).not.toHaveBeenCalled()
  })

  it('allows first attachment but confirms replacement or removal of a direct setup profile', async () => {
    const worktree = {
      id: 'repo-1::/workspace/app',
      repoId: 'repo-1',
      hostId: 'local',
      path: '/workspace/app',
      instanceId: 'instance-1'
    } as unknown as ResolvedWorktree
    let meta: Partial<WorktreeMeta> = { instanceId: 'instance-1' }
    const setWorktreeMetaForHost = vi.fn(
      (_id: string, _hostId: string, updates: Partial<WorktreeMeta>) => {
        meta = { ...meta, ...updates }
      }
    )
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the update only reads and writes the metadata members stubbed here.
    const store = {
      getRepos: () => [],
      getWorktreeMeta: () => meta,
      getWorktreeMetaForHost: () => meta,
      setWorktreeMeta: vi.fn(),
      setWorktreeMetaForHost
    } as unknown as RuntimeStore
    const ports = {
      resolveWorktree: vi.fn(async () => worktree),
      validateParent: vi.fn(),
      invalidateResolved: vi.fn(),
      invalidateScan: vi.fn(),
      notifyChanged: vi.fn(),
      showWorktree: vi.fn(async () => worktree as unknown as Worktree)
    }

    await updateRuntimeManagedWorktreeMetadata({
      selector: `id:${worktree.id}`,
      updates: { setupProfile: { name: 'customer-default', setupDecision: 'run' } },
      store,
      ports
    })
    expect(meta.setupProfile).toEqual({ name: 'customer-default', setupDecision: 'run' })

    await expect(
      updateRuntimeManagedWorktreeMetadata({
        selector: `id:${worktree.id}`,
        updates: { setupProfile: { name: 'customer-safe', setupDecision: 'skip' } },
        store,
        ports
      })
    ).rejects.toThrow('--confirm-shared-profile-change')

    await updateRuntimeManagedWorktreeMetadata({
      selector: `id:${worktree.id}`,
      updates: {
        setupProfile: { name: 'customer-safe', setupDecision: 'skip' },
        confirmSharedSetupProfileChange: true
      },
      store,
      ports
    })
    expect(meta.setupProfile).toEqual({ name: 'customer-safe', setupDecision: 'skip' })

    await expect(
      updateRuntimeManagedWorktreeMetadata({
        selector: `id:${worktree.id}`,
        updates: { setupProfile: null },
        store,
        ports
      })
    ).rejects.toThrow('--confirm-shared-profile-change')
  })

  describe('a folder workspace removed while its resolution was in flight (#22712)', () => {
    const folderRepo = { id: 'repo-1', path: '/workspace/app', displayName: 'app', kind: 'folder' }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the update only reads id, repoId, hostId and instanceId.
    const worktree = {
      id: 'repo-1::/workspace/app::workspace:0b6f6d2e-1c1d-4c55-9a51-3f1c0f4f2a10',
      repoId: 'repo-1',
      hostId: 'local',
      path: '/workspace/app',
      instanceId: 'instance-1'
    } as unknown as ResolvedWorktree

    function run(meta: Partial<WorktreeMeta> | undefined) {
      const setWorktreeMeta = vi.fn()
      const setWorktreeMetaForHost = vi.fn()
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the update only reads these store members.
      const store = {
        getRepos: () => [folderRepo],
        getWorktreeMeta: () => meta,
        getWorktreeMetaForHost: () => meta,
        setWorktreeMeta,
        setWorktreeMetaForHost
      } as unknown as RuntimeStore
      const result = updateRuntimeManagedWorktreeMetadata({
        selector: `id:${worktree.id}`,
        updates: { lastActivityAt: 2 },
        store,
        ports: {
          resolveWorktree: vi.fn(async () => worktree),
          validateParent: vi.fn(),
          invalidateResolved: vi.fn(),
          invalidateScan: vi.fn(),
          notifyChanged: vi.fn(),
          showWorktree: vi.fn(async () => worktree as unknown as Worktree)
        }
      })
      return { result, setWorktreeMeta, setWorktreeMetaForHost }
    }

    it('refuses to recreate the removed workspace as a blank row', async () => {
      const { result, setWorktreeMeta, setWorktreeMetaForHost } = run(undefined)

      await expect(result).rejects.toThrow('selector_not_found')
      expect(setWorktreeMeta).not.toHaveBeenCalled()
      expect(setWorktreeMetaForHost).not.toHaveBeenCalled()
    })

    it('still writes to a folder workspace that exists', async () => {
      const { result, setWorktreeMetaForHost } = run({ instanceId: 'instance-1' })

      await result
      expect(setWorktreeMetaForHost).toHaveBeenCalledWith(worktree.id, 'local', {
        lastActivityAt: 2
      })
    })
  })
})
