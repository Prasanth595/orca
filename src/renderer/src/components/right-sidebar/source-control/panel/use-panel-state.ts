import { useCallback } from 'react'
import { useSourceControlDiffCommentNotes } from '../notes/use-diff-comment-notes'
import { useNestedFolderScope } from '../nested/use-nested-folder-scope'
import { useSourceControlStoreActions } from '../listing/use-store-actions'
import { useSourceControlWorktreeContext } from '../listing/use-worktree-context'
import { useSourceControlBranchLineTotalGate } from '../sync/use-branch-line-total-gate'
import { useSourceControlStatusRefresh } from '../sync/use-status-refresh'
import { useSourceControlPanelViewState } from './use-panel-view-state'
import { useSourceControlWorktreeOperationState } from './use-worktree-operation-state'

/**
 * The panel's ground floor: what worktree/repo is active, the store actions it drives, and the
 * state it owns itself. Everything else in the panel is derived from this.
 */
export function useSourceControlPanelState() {
  const context = useSourceControlWorktreeContext()
  const storeActions = useSourceControlStoreActions()
  const {
    activeConnectionId,
    activeRepoTarget,
    activeWorktree,
    activeWorktreeId,
    activeWorktreeInstanceId,
    branchSummary,
    conflictOperationsByWorktree,
    isBranchVisible,
    isFolder,
    repositoryHuge,
    settings,
    worktreeMap,
    worktreePath
  } = context

  const notes = useSourceControlDiffCommentNotes({
    activeWorktreeId,
    clearDiffComments: storeActions.clearDiffComments,
    clearDiffCommentsForFile: storeActions.clearDiffCommentsForFile
  })
  const viewState = useSourceControlPanelViewState({
    activeWorktreeId,
    settings,
    updateSettings: storeActions.updateSettings
  })
  const operationState = useSourceControlWorktreeOperationState({
    activeWorktreeId,
    conflictOperationsByWorktree,
    worktreeMap
  })
  const nestedFolderScope = useNestedFolderScope({
    worktreeId: activeWorktreeId,
    worktreePath,
    connectionId: activeConnectionId
  })
  useSourceControlBranchLineTotalGate({
    activeWorktreeId,
    branchSummary,
    isBranchVisible,
    isFolder
  })
  const statusRefresh = useSourceControlStatusRefresh({
    activeRepoTarget,
    activeWorktreeId,
    worktreePath,
    activePushTarget: activeWorktree?.pushTarget,
    isFolder,
    repositoryHuge,
    activeConnectionId,
    activeWorktreeInstanceId,
    worktreeMap
  })
  const nestedGitTarget = nestedFolderScope.gitTargetPath
  const refreshNestedFolder = nestedFolderScope.refreshAll
  const refreshParentGitStatus = statusRefresh.refreshActiveGitStatusAfterMutation
  const refreshActiveGitStatusAfterMutation = useCallback(async (): Promise<void> => {
    await Promise.all([refreshParentGitStatus(), refreshNestedFolder()])
  }, [refreshNestedFolder, refreshParentGitStatus])

  return {
    ...context,
    ...storeActions,
    ...notes,
    ...viewState,
    ...operationState,
    ...statusRefresh,
    refreshActiveGitStatusAfterMutation,
    nestedFolderScope,
    sourceControlWorkspacePath: worktreePath,
    worktreePath: nestedGitTarget ?? worktreePath,
    entries: nestedFolderScope.gitTargetEntries ?? context.entries,
    branchName: nestedFolderScope.gitTargetBranch ?? context.branchName,
    hasUncommittedEntries: nestedGitTarget
      ? (nestedFolderScope.gitTargetEntries?.length ?? 0) > 0
      : context.hasUncommittedEntries,
    branchEntries: nestedGitTarget ? [] : context.branchEntries,
    branchSummary: nestedGitTarget ? null : context.branchSummary,
    branchLineTotal: nestedGitTarget ? null : context.branchLineTotal
  }
}

export type SourceControlPanelState = ReturnType<typeof useSourceControlPanelState>
