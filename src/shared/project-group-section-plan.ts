// The desktop sidebar's Project Group nesting of project sections; the paired phone calls it too.
import { getEffectiveProjectGroupManualRank, getProjectGroupHeaderKey } from './project-groups'
import type { ProjectGroup } from './project-group-types'
import type { ProjectSectionEntry, ProjectSectionRepo } from './project-section-grouping'
import {
  compareRecentRank,
  createRecentRankLookup,
  withRepoSectionDisplayLabels,
  type ActivityItem
} from './project-section-order'
import type { ProjectOrderBy } from './ui-chrome-types'

/** The group fields nesting and header labels read. */
export type ProjectGroupSectionGroup = Pick<
  ProjectGroup,
  'id' | 'name' | 'parentGroupId' | 'tabOrder'
>

/** A section repo's Project Group membership and its manual rank inside that group. */
export type ProjectGroupSectionRepo = ProjectSectionRepo & {
  projectGroupId?: string | null
  projectGroupOrder?: number
}

export type ProjectGroupSectionStep<V, G> =
  | {
      kind: 'group'
      group: G
      key: string
      depth: number
      /** Project sections, direct rows and nested groups' contents, as the desktop header counts. */
      count: number
      /** Header keys of every enclosing group, outermost first. */
      ancestorKeys: readonly string[]
    }
  | { kind: 'section'; entry: [string, V]; depth: number; ancestorKeys: readonly string[] }

/**
 * Project sections nested under their Project Groups: each group's header, its own sections, then
 * its child groups; ungrouped sections, and those of a group not yet known, follow at the root.
 * Collapse is left to the caller: every step names the group headers that would hide it.
 */
export function planProjectGroupSections<
  V extends ProjectSectionEntry<ActivityItem, ProjectGroupSectionRepo>,
  G extends ProjectGroupSectionGroup
>(args: {
  entries: readonly [string, V][]
  projectGroups: readonly G[]
  projectOrderBy: ProjectOrderBy
  repoOrder: ReadonlyMap<string, number> | undefined
  /** Rows a group holds directly besides project sections, e.g. its folder workspaces. */
  directRowCountOf?: (groupId: string) => number
}): ProjectGroupSectionStep<V, G>[] {
  const { projectGroups, projectOrderBy, repoOrder, directRowCountOf } = args

  const entriesByGroupId = new Map<string | null, [string, V][]>()
  for (const entry of args.entries) {
    const groupId = entry[1].repo?.projectGroupId ?? null
    const list = entriesByGroupId.get(groupId) ?? []
    list.push(entry)
    entriesByGroupId.set(groupId, list)
  }

  const groupsById = new Map(projectGroups.map((group) => [group.id, group]))
  const childGroupsByParentId = new Map<string | null, G[]>()
  for (const group of projectGroups) {
    const parentId =
      group.parentGroupId && groupsById.has(group.parentGroupId) ? group.parentGroupId : null
    const children = childGroupsByParentId.get(parentId) ?? []
    children.push(group)
    childGroupsByParentId.set(parentId, children)
  }
  for (const groups of childGroupsByParentId.values()) {
    groups.sort(
      (left, right) => left.tabOrder - right.tabOrder || left.name.localeCompare(right.name)
    )
  }

  const subtreeCount = (groupId: string): number =>
    (childGroupsByParentId.get(groupId) ?? []).reduce(
      (count, child) => count + subtreeCount(child.id),
      (entriesByGroupId.get(groupId)?.length ?? 0) + (directRowCountOf?.(groupId) ?? 0)
    )

  const steps: ProjectGroupSectionStep<V, G>[] = []
  const pushSections = (
    entries: readonly [string, V][],
    depth: number,
    ancestorKeys: readonly string[]
  ): void => {
    let ordered: [string, V][]
    if (projectOrderBy === 'recent') {
      const getRecentRank = createRecentRankLookup<[string, V]>()
      ordered = [...entries].sort((left, right) =>
        compareRecentRank(getRecentRank(left), getRecentRank(right))
      )
    } else {
      // Manual: a project's per-group rank (projectGroupOrder), else its global repoOrder, so drag
      // midpoint commits and the rendered order stay aligned.
      ordered = [...entries].sort(
        (left, right) =>
          getEffectiveProjectGroupManualRank(left[1].repo, repoOrder) -
          getEffectiveProjectGroupManualRank(right[1].repo, repoOrder)
      )
    }
    for (const entry of withRepoSectionDisplayLabels(ordered)) {
      steps.push({ kind: 'section', entry, depth, ancestorKeys })
    }
  }
  // Children hang off parents reachable from a root, so a persisted parent cycle is never entered.
  const appendGroup = (group: G, depth: number, ancestorKeys: readonly string[]): void => {
    const key = getProjectGroupHeaderKey(group.id)
    steps.push({ kind: 'group', group, key, depth, count: subtreeCount(group.id), ancestorKeys })
    const innerKeys = [...ancestorKeys, key]
    pushSections(entriesByGroupId.get(group.id) ?? [], depth + 1, innerKeys)
    for (const child of childGroupsByParentId.get(group.id) ?? []) {
      appendGroup(child, depth + 1, innerKeys)
    }
  }
  for (const group of childGroupsByParentId.get(null) ?? []) {
    appendGroup(group, 0, [])
  }

  const rootEntries = [...(entriesByGroupId.get(null) ?? [])]
  for (const [groupId, entries] of entriesByGroupId) {
    // Why: startup can have repos from hosts whose project-group metadata was not fetched yet;
    // missing metadata must not make those repos disappear.
    if (groupId !== null && !groupsById.has(groupId)) {
      rootEntries.push(...entries)
    }
  }
  pushSections(rootEntries, 0, [])
  return steps
}
