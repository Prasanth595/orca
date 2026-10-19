import type { AppState } from '@/store/types'
import { getIndexedAllWorktrees } from '@/store/worktree-repo-index'
import { compareWorktreeDisplayName } from '@/lib/worktree-display-name-order'
import { sharesWorktreeLineageBoundary } from '../../../shared/resolved-worktree-lineage'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { Worktree } from '../../../shared/worktree/types'

export type ComposerWorktreeCandidateScope = {
  repoId: string
  executionHostId?: ExecutionHostId | null
}

/** Live worktrees of the composer's project on its execution host, sorted by display name. */
export function getComposerWorktreeCandidates(
  worktreesByRepo: AppState['worktreesByRepo'],
  scope: ComposerWorktreeCandidateScope
): Worktree[] {
  // Why `?? undefined`: an unresolved host is "not known yet", not "no host", and the boundary
  // check reads undefined on either side as a wildcard. A candidate in this repo with no recorded
  // hostId inherits that repo's host, so it is on the composer's host too.
  const boundary = { hostId: scope.executionHostId ?? undefined }
  return getIndexedAllWorktrees(worktreesByRepo)
    .filter(
      (candidate) =>
        candidate.repoId === scope.repoId &&
        !candidate.isArchived &&
        sharesWorktreeLineageBoundary(boundary, candidate)
    )
    .sort(compareWorktreeDisplayName)
}
