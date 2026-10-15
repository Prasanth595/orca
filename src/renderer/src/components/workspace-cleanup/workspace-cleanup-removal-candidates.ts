import type { WorkspaceCleanupCandidate } from '../../../../shared/workspace-cleanup'
import type { WorktreeDeleteState } from '@/store/slices/worktrees'
import { composeWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import { resolveWorkspaceCleanupRemovalHostId } from '../../../../shared/workspace-cleanup-host-identity'

type DeletionFlagState = Pick<WorktreeDeleteState, 'isDeleting' | 'executionHostId'>

export function filterWorkspaceCleanupRemovalCandidates(
  candidates: readonly WorkspaceCleanupCandidate[],
  deleteStateByWorktreeId: Record<string, DeletionFlagState | undefined>,
  concealedRepoIds: ReadonlySet<string> = new Set()
): WorkspaceCleanupCandidate[] {
  return candidates.filter((candidate) => {
    // Why: a project relocked after the confirm opened must not be removed unseen.
    if (concealedRepoIds.has(candidate.repoId)) {
      return false
    }
    const hostId = resolveWorkspaceCleanupRemovalHostId(candidate)
    const qualifiedState = hostId
      ? deleteStateByWorktreeId[composeWorktreeHostIdentity(hostId, candidate.worktreeId)]
      : undefined
    const legacyState = deleteStateByWorktreeId[candidate.worktreeId]
    const legacyStateMatchesHost =
      legacyState?.executionHostId === undefined ||
      legacyState.executionHostId === null ||
      hostId === null ||
      legacyState.executionHostId === hostId
    return (
      qualifiedState?.isDeleting !== true &&
      !(legacyState?.isDeleting === true && legacyStateMatchesHost)
    )
  })
}
