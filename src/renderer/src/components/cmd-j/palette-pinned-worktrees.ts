import { getWorktreePaletteSearchScope } from '@/lib/worktree-palette-search'
import { encodePaletteIdentity } from '@/lib/palette-match/palette-ranking'
import { getPaletteWorktreeIdentity } from '@/lib/palette-repo-resolution'
import type { Worktree } from '../../../../shared/worktree/types'

export function includePinnedWorktrees(
  visible: Worktree[],
  {
    all,
    pinnedIds,
    matchesFilter
  }: {
    all: Worktree[]
    pinnedIds: readonly string[]
    matchesFilter?: (worktree: Worktree) => boolean
  }
): Worktree[] {
  if (pinnedIds.length === 0) {
    return visible
  }
  const visibleIds = new Set(visible.map(getPaletteWorktreeIdentity))
  return [
    ...visible,
    ...all.filter(
      (worktree) =>
        !worktree.isArchived &&
        !visibleIds.has(getPaletteWorktreeIdentity(worktree)) &&
        (!matchesFilter || matchesFilter(worktree)) &&
        pinnedIds.includes(
          encodePaletteIdentity(['worktree', getPaletteWorktreeIdentity(worktree)])
        )
    )
  ]
}

export function getPinnedWorktreeSearchScope({
  hasQuery,
  allWorktrees,
  visibleWorktrees,
  pinnedIds,
  matchesFilter
}: {
  hasQuery: boolean
  allWorktrees: Worktree[]
  visibleWorktrees: Worktree[]
  pinnedIds: readonly string[]
  matchesFilter?: (worktree: Worktree) => boolean
}): Worktree[] {
  const scope = getWorktreePaletteSearchScope({
    hasQuery,
    allWorktrees,
    emptyQueryWorktrees: includePinnedWorktrees(visibleWorktrees, {
      all: allWorktrees,
      pinnedIds,
      matchesFilter
    })
  })
  return hasQuery && matchesFilter ? scope.filter(matchesFilter) : scope
}
