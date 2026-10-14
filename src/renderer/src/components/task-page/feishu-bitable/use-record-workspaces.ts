import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { folderWorkspaceToWorktree } from '../../../../../shared/folder-workspace-worktree'
import type { Worktree } from '../../../../../shared/worktree/types'

export function useFeishuBitableRecordWorkspaces(worktrees: readonly Worktree[]): Worktree[] {
  const folders = useAppStore((state) => state.folderWorkspaces)
  return useMemo(
    () => [...worktrees, ...folders.map(folderWorkspaceToWorktree)],
    [worktrees, folders]
  )
}
