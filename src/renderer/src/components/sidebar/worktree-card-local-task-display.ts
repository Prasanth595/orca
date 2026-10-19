import type { Worktree } from '../../../../shared/worktree/types'

export type WorktreeCardLocalTaskDisplay = {
  identifier: string
  title: string
  url: string
}

export function getWorktreeCardLocalTaskDisplay(
  worktree: Pick<Worktree, 'linkedWorkItem'>
): WorktreeCardLocalTaskDisplay | null {
  const item = worktree.linkedWorkItem
  if (item?.provider !== 'local' || item.type !== 'issue') {
    return null
  }
  return { identifier: String(item.number), title: item.title, url: item.url }
}

export function getConfiguredWorktreeCardLocalTaskDisplay(
  worktree: Pick<Worktree, 'linkedWorkItem'>,
  properties: readonly string[]
): WorktreeCardLocalTaskDisplay | null {
  return properties.includes('local-task') ? getWorktreeCardLocalTaskDisplay(worktree) : null
}
