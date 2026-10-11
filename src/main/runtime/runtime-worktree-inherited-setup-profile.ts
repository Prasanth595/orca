import type { RuntimeManagedWorktreeCreateArgs } from './runtime-managed-worktree-create-types'
import type { RuntimeStore } from './runtime-store-contract'
import type { WorktreeLineageResolution } from './runtime-worktree-lineage-resolution'
import { resolveRuntimeSetupDecision } from './runtime-local-worktree-setup'
import {
  resolveWorkspaceSetupProfile,
  setupDecisionWithWorkspaceProfile
} from '../../shared/workspace-setup-profile'

export function withInheritedSetupProfile(
  args: RuntimeManagedWorktreeCreateArgs,
  lineageResolution: WorktreeLineageResolution | null,
  store: RuntimeStore
): RuntimeManagedWorktreeCreateArgs {
  const parentWorktree =
    lineageResolution?.kind === 'lineage' && lineageResolution.parent.type === 'worktree'
      ? lineageResolution.parent.worktree
      : null
  const inheritedSetupProfile = parentWorktree
    ? resolveWorkspaceSetupProfile(
        parentWorktree.id,
        (parentWorktree.hostId && store.getAllWorktreeMetaForHost?.(parentWorktree.hostId)) ??
          store.getAllWorktreeMeta(),
        store.getAllWorktreeLineage?.() ?? {}
      )
    : null
  const requestedSetupDecision = resolveRuntimeSetupDecision(args)
  const effectiveSetupDecision = setupDecisionWithWorkspaceProfile(
    requestedSetupDecision,
    inheritedSetupProfile
  )
  return effectiveSetupDecision === requestedSetupDecision
    ? args
    : { ...args, setupDecision: effectiveSetupDecision }
}
