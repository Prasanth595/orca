import { describe, expect, it } from 'vitest'
import { getDefaultRepoHookSettings } from '../../shared/constants'
import type { Repo } from '../../shared/repo-types'
import { readRuntimeWorkspaceSetupPolicy } from './runtime-workspace-setup-policy'

const repo = (setupRunPolicy: 'ask' | 'run-by-default' = 'ask'): Repo => ({
  id: 'repo',
  path: '/repo',
  displayName: 'Repo',
  badgeColor: '#000000',
  addedAt: 1,
  hookSettings: {
    ...getDefaultRepoHookSettings(),
    setupRunPolicy,
    commandSourcePolicy: 'local-only',
    scripts: { setup: 'pnpm install', archive: '' }
  }
})

describe('runtime workspace setup policy readback', () => {
  it('shows inherited requested versus effective policy without exposing command text', () => {
    const result = readRuntimeWorkspaceSetupPolicy({
      worktreeId: 'repo::/repo/child',
      worktreePath: '/repo/child',
      repo: repo(),
      directProfile: undefined,
      profileResolution: {
        profile: {
          name: 'customer',
          setupDecision: 'run',
          requiredMcpCapabilities: [{ serverNames: ['linear'], capability: 'write' }]
        },
        source: 'inherited',
        sourceWorktreeId: 'repo::/repo/main'
      },
      setupRequirements: [],
      dryRun: true
    })

    expect(result).toMatchObject({
      requestedProfile: null,
      effectiveProfile: { name: 'customer', setupDecision: 'run' },
      profileSource: 'inherited',
      hooks: {
        setupConfigured: true,
        setupSource: 'local',
        requestedDecision: 'inherit',
        effectiveDecision: 'run'
      },
      tooling: {
        source: 'profile',
        requiredMcpCapabilities: [{ serverNames: ['linear'], capability: 'write' }]
      },
      dryRun: { mutated: false, wouldRunSetup: true }
    })
    expect(JSON.stringify(result)).not.toContain('pnpm install')
  })

  it('surfaces an undecided legacy ask policy without mutating', () => {
    expect(
      readRuntimeWorkspaceSetupPolicy({
        worktreeId: 'repo::/repo/main',
        worktreePath: '/repo/main',
        repo: repo(),
        directProfile: undefined,
        profileResolution: null,
        setupRequirements: [],
        dryRun: true
      })
    ).toMatchObject({
      profileSource: 'none',
      hooks: { repositoryRunPolicy: 'ask', effectiveDecision: 'inherit' },
      dryRun: {
        mutated: false,
        wouldRunSetup: null,
        blocker: 'setup-decision-required'
      }
    })
  })
})
