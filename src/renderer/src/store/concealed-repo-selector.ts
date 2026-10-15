import { getConcealedRepoIds, withoutConcealedRepos } from '../../../shared/incognito-projects'
import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { Repo } from '../../../shared/repo-types'
import type { AppState } from './types'

type ConcealedRepoState = Pick<AppState, 'repos' | 'incognitoProjectsUnlocked'>

const lockedCache = new WeakMap<AppState['repos'], ReadonlySet<string>>()
const shownReposCache = new WeakMap<AppState['repos'], AppState['repos']>()

/** Stable per `repos` identity so selectors and memos keyed on it don't churn. */
export function getConcealedRepoIdsFromState(state: ConcealedRepoState): ReadonlySet<string> {
  if (state.incognitoProjectsUnlocked) {
    return getConcealedRepoIds(state.repos, true)
  }
  let concealed = lockedCache.get(state.repos)
  if (!concealed) {
    concealed = getConcealedRepoIds(state.repos, false)
    lockedCache.set(state.repos, concealed)
  }
  return concealed
}

/** `state.repos` minus locked incognito repos; the same array when nothing is concealed. */
export function getShownReposFromState(state: ConcealedRepoState): AppState['repos'] {
  const concealed = getConcealedRepoIdsFromState(state)
  if (concealed.size === 0) {
    return state.repos
  }
  let shown = shownReposCache.get(state.repos)
  if (!shown) {
    shown = withoutConcealedRepos(state.repos, concealed)
    shownReposCache.set(state.repos, shown)
  }
  return shown
}

/** Groups whose only direct members are concealed repos would leak as empty headers. */
export function withoutConcealedOnlyProjectGroups(
  groups: readonly ProjectGroup[],
  repos: readonly Pick<Repo, 'id' | 'projectGroupId'>[],
  folderWorkspaces: readonly Pick<FolderWorkspace, 'projectGroupId'>[],
  concealedRepoIds: ReadonlySet<string>
): readonly ProjectGroup[] {
  if (concealedRepoIds.size === 0) {
    return groups
  }
  const groupsWithConcealed = new Set<string>()
  const groupsWithShown = new Set<string>()
  for (const repo of repos) {
    if (!repo.projectGroupId) {
      continue
    }
    if (concealedRepoIds.has(repo.id)) {
      groupsWithConcealed.add(repo.projectGroupId)
    } else {
      groupsWithShown.add(repo.projectGroupId)
    }
  }
  if (groupsWithConcealed.size === 0) {
    return groups
  }
  for (const folder of folderWorkspaces) {
    groupsWithShown.add(folder.projectGroupId)
  }
  for (const group of groups) {
    if (group.parentGroupId) {
      groupsWithShown.add(group.parentGroupId)
    }
  }
  const hidden = [...groupsWithConcealed].filter((id) => !groupsWithShown.has(id))
  if (hidden.length === 0) {
    return groups
  }
  const hiddenIds = new Set(hidden)
  return groups.filter((group) => !hiddenIds.has(group.id))
}

/** Drops concealed repo keys from a repo-keyed record; the same record when nothing changes. */
export function omitConcealedRepoKeys<T>(
  byRepo: Record<string, T>,
  concealedRepoIds: ReadonlySet<string>
): Record<string, T> {
  if (concealedRepoIds.size === 0 || ![...concealedRepoIds].some((id) => id in byRepo)) {
    return byRepo
  }
  return Object.fromEntries(
    Object.entries(byRepo).filter(([repoId]) => !concealedRepoIds.has(repoId))
  )
}
