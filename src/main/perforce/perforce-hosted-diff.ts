import type { GitDiffResult } from '../../shared/git-diff-compare-types'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../shared/execution-host'
import { localPerforceBackend } from '../../shared/perforce/perforce-backend'
import { isFolderRepo } from '../../shared/repo-kind'
import type { Repo } from '../../shared/repo-types'

/**
 * Perforce workspaces are registered as folders, so a diff request for one hosted by this process
 * (orcad serving an SSH host) comes from p4 instead of git. `null` means not Perforce.
 */
export async function getHostedPerforceFolderDiff(
  target: { repo?: Repo; executionHostId: ExecutionHostId; worktree: { path: string } },
  relativePath: string
): Promise<GitDiffResult | null> {
  if (
    target.executionHostId !== LOCAL_EXECUTION_HOST_ID ||
    !target.repo ||
    !isFolderRepo(target.repo)
  ) {
    return null
  }
  const cwd = target.worktree.path
  return (await localPerforceBackend.detect(cwd)).isWorkspace
    ? localPerforceBackend.diff(cwd, relativePath)
    : null
}
