import { useMemo } from 'react'
import {
  buildMobileSourceControlPrimaryAction,
  type MobileSourceControlPrimaryAction,
  type MobileSourceControlPrimaryActionArgs,
  type MobileSourceControlPrimaryActionHandlers
} from './mobile-source-control-primary-action'

type Args = Omit<MobileSourceControlPrimaryActionArgs, 'handlers'> & {
  runners: MobileSourceControlPrimaryActionHandlers
}

// Memoized primary commit-area action; split from the state hook to keep it under the line limit.
export function useMobileSourceControlPrimaryAction(args: Args): MobileSourceControlPrimaryAction {
  const { runners, ...rest } = args
  const {
    status,
    hasUnresolvedConflicts,
    stageablePaths,
    stagedCount,
    unstagedCount,
    commitMessage,
    busyAction,
    generatingMessage,
    openingPath,
    openingBranchPath,
    branchCompareResult
  } = rest
  const { commit, stageAll, runActionSheetGitSequence, runActionSheetGitSync } = runners
  return useMemo(
    () =>
      buildMobileSourceControlPrimaryAction({
        status,
        hasUnresolvedConflicts,
        stageablePaths,
        stagedCount,
        unstagedCount,
        commitMessage,
        busyAction,
        generatingMessage,
        openingPath,
        openingBranchPath,
        branchCompareResult,
        handlers: { commit, stageAll, runActionSheetGitSequence, runActionSheetGitSync }
      }),
    [
      branchCompareResult,
      busyAction,
      commit,
      commitMessage,
      generatingMessage,
      hasUnresolvedConflicts,
      openingBranchPath,
      openingPath,
      runActionSheetGitSequence,
      runActionSheetGitSync,
      stageAll,
      stageablePaths,
      stagedCount,
      status,
      unstagedCount
    ]
  )
}
