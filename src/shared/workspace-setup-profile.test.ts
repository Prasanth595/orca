import { describe, expect, it } from 'vitest'
import type { WorktreeMeta } from './worktree/meta-types'
import type { WorktreeLineage } from './worktree/lineage-types'
import {
  resolveWorkspaceSetupProfile,
  setupDecisionWithWorkspaceProfile
} from './workspace-setup-profile'

const meta = (instanceId: string, setupProfile?: WorktreeMeta['setupProfile']): WorktreeMeta => ({
  instanceId,
  displayName: '',
  comment: '',
  linkedIssue: null,
  linkedPR: null,
  linkedLinearIssue: null,
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 0,
  ...(setupProfile ? { setupProfile } : {})
})

const lineage = (child: string, parent: string): WorktreeLineage => ({
  worktreeId: child,
  worktreeInstanceId: `${child}-instance`,
  parentWorktreeId: parent,
  parentWorktreeInstanceId: `${parent}-instance`,
  origin: 'cli',
  capture: { source: 'explicit-cli-flag', confidence: 'explicit' },
  createdAt: 1
})

describe('workspace setup profile resolution', () => {
  it('inherits the nearest ancestor profile', () => {
    const result = resolveWorkspaceSetupProfile(
      'child',
      {
        child: meta('child-instance'),
        parent: meta('parent-instance', { name: 'customer', setupDecision: 'run' })
      },
      { child: lineage('child', 'parent') }
    )

    expect(result).toEqual({
      profile: { name: 'customer', setupDecision: 'run' },
      source: 'inherited',
      sourceWorktreeId: 'parent'
    })
    expect(setupDecisionWithWorkspaceProfile('inherit', result)).toBe('run')
  })

  it('lets a child override its parent profile', () => {
    expect(
      resolveWorkspaceSetupProfile(
        'child',
        {
          child: meta('child-instance', { name: 'lightweight', setupDecision: 'skip' }),
          parent: meta('parent-instance', { name: 'customer', setupDecision: 'run' })
        },
        { child: lineage('child', 'parent') }
      )
    ).toMatchObject({
      profile: { name: 'lightweight', setupDecision: 'skip' },
      source: 'direct',
      sourceWorktreeId: 'child'
    })
  })

  it('fails closed for stale lineage', () => {
    expect(
      resolveWorkspaceSetupProfile(
        'child',
        {
          child: meta('replacement-instance'),
          parent: meta('parent-instance', { name: 'customer' })
        },
        { child: lineage('child', 'parent') }
      )
    ).toBeNull()
  })

  it('keeps an explicit create decision ahead of an inherited profile', () => {
    const resolution = {
      profile: { name: 'customer', setupDecision: 'run' as const },
      source: 'inherited' as const,
      sourceWorktreeId: 'parent'
    }
    expect(setupDecisionWithWorkspaceProfile('skip', resolution)).toBe('skip')
  })
})
