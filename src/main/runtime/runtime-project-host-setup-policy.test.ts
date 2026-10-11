import { describe, expect, it, vi } from 'vitest'
import { getDefaultRepoHookSettings } from '../../shared/constants'
import type { Repo } from '../../shared/repo-types'
import type { WorkspaceSetupProfile } from '../../shared/workspace-setup-profile'
import type { RuntimeStore } from './runtime-store-contract'
import { RuntimeProjectHostSetupController } from './runtime-project-host-setup-controller'

const remoteRepo: Repo = {
  id: 'repo-remote',
  path: '/srv/app',
  displayName: 'app',
  badgeColor: 'blue',
  addedAt: 1,
  kind: 'git',
  connectionId: 'builder',
  hookSettings: {
    ...getDefaultRepoHookSettings(),
    setupRunPolicy: 'ask',
    commandSourcePolicy: 'local-only',
    scripts: { setup: 'pnpm install', archive: '' }
  }
}

describe('RuntimeProjectHostSetupController setup policy', () => {
  it('reads the selected host row and reports inherited policy without mutation', () => {
    const parentId = 'repo-remote::/srv/app-parent'
    const childId = 'repo-remote::/srv/app-child'
    const setupProfile: WorkspaceSetupProfile = {
      name: 'customer-default',
      setupDecision: 'run'
    }
    const remoteMeta = {
      [parentId]: {
        instanceId: 'parent-instance',
        hostId: 'ssh:builder',
        setupProfile
      },
      [childId]: { instanceId: 'child-instance', hostId: 'ssh:builder' }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: policy readback only uses the metadata and setup reads stubbed here.
    const store = {
      getAllWorktreeMeta: () => ({}),
      getAllWorktreeMetaForHost: (hostId: string) => (hostId === 'ssh:builder' ? remoteMeta : {}),
      getWorktreeMeta: () => undefined,
      getAllWorktreeLineage: () => ({
        [childId]: {
          worktreeId: childId,
          worktreeInstanceId: 'child-instance',
          parentWorktreeId: parentId,
          parentWorktreeInstanceId: 'parent-instance',
          origin: 'cli',
          capture: { source: 'explicit-cli-flag', confidence: 'explicit' },
          createdAt: 1
        }
      }),
      getProjectHostSetups: () => []
    } as unknown as RuntimeStore
    const controller = new RuntimeProjectHostSetupController({
      getStore: () => store,
      listRepos: () => [remoteRepo],
      addRepo: vi.fn(),
      addRemoteRepo: vi.fn(),
      cloneRepo: vi.fn(),
      invalidateResolvedWorktrees: vi.fn(),
      invalidateWorktreeScan: vi.fn(),
      notifyReposChanged: vi.fn(),
      countLiveTerminalsForRepo: () => 0
    })

    expect(controller.readSetupPolicy(childId, true, 'ssh:builder')).toMatchObject({
      requestedProfile: null,
      effectiveProfile: { name: 'customer-default', setupDecision: 'run' },
      profileSource: 'inherited',
      sourceWorktreeId: parentId,
      hooks: { requestedDecision: 'inherit', effectiveDecision: 'run' },
      dryRun: { mutated: false, wouldRunSetup: true }
    })
  })
})
