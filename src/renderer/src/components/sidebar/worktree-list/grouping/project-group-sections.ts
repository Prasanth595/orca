import type { OccurrenceSectionPath } from '../../../../../../shared/worktree-occurrence-plan'
import {
  compareFolderWorkspacesForDisplay,
  type RenderableFolderWorkspace
} from './folder-workspace-lanes'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { ProjectOrderBy } from '../../../../../../shared/ui-chrome-types'
import { getProjectGroupHeaderKey } from '../../../../../../shared/project-groups'
import { planProjectGroupSections } from '../../../../../../shared/project-group-section-plan'
import { PROJECT_GROUP_META } from './group-keys'
import { appendOrderedGroups } from './group-sections'
import type { SectionAppendContext } from './group-sections'
import type { OrderedGroupEntry } from './worktree-group-entry'
import { buildFolderWorkspaceRow } from './row-builders'

export function appendProjectGroupSections(
  ctx: SectionAppendContext,
  args: {
    orderedGroups: OrderedGroupEntry[]
    projectGroups: readonly ProjectGroup[]
    folderWorkspaces: readonly RenderableFolderWorkspace[]
    projectOrderBy: ProjectOrderBy
    repoOrder: Map<string, number> | undefined
  }
): void {
  const { orderedGroups, projectGroups, folderWorkspaces, projectOrderBy, repoOrder } = args
  const { result, collapsedGroups } = ctx

  // Membership already decided by getRenderableFolderWorkspaces in buildRows, so
  // repo grouping no longer owns the filter — it only groups and orders (#15362).
  const folderWorkspacesByProjectGroupId = new Map<string, RenderableFolderWorkspace[]>()
  for (const pair of folderWorkspaces) {
    const groupId = pair.folderWorkspace.projectGroupId
    const list = folderWorkspacesByProjectGroupId.get(groupId) ?? []
    list.push(pair)
    folderWorkspacesByProjectGroupId.set(groupId, list)
  }
  for (const list of folderWorkspacesByProjectGroupId.values()) {
    list.sort((left, right) =>
      compareFolderWorkspacesForDisplay(left.folderWorkspace, right.folderWorkspace)
    )
  }

  const steps = planProjectGroupSections({
    entries: orderedGroups,
    projectGroups,
    projectOrderBy,
    repoOrder,
    directRowCountOf: (groupId) => folderWorkspacesByProjectGroupId.get(groupId)?.length ?? 0
  })
  for (const step of steps) {
    if (step.ancestorKeys.some((key) => collapsedGroups.has(key))) {
      continue
    }
    if (step.kind === 'section') {
      appendOrderedGroups(ctx, [step.entry], step.depth)
      continue
    }
    result.push({
      type: 'header',
      key: step.key,
      label: step.group.name,
      count: step.count,
      tone: PROJECT_GROUP_META.tone,
      icon: PROJECT_GROUP_META.icon,
      projectGroup: step.group,
      projectGroupDepth: step.depth
    })
    if (!collapsedGroups.has(step.key)) {
      for (const pair of folderWorkspacesByProjectGroupId.get(step.group.id) ?? []) {
        result.push(buildFolderWorkspaceRow(pair, step.depth + 1))
      }
    }
  }
}

/** The same group parents used by section emission, including missing-parent roots. */
export function getProjectGroupOccurrencePaths(projectGroups: readonly ProjectGroup[]) {
  const groupsById = new Map(projectGroups.map((group) => [group.id, group]))
  const paths = new Map<string, OccurrenceSectionPath>()
  for (const group of projectGroups) {
    const pending: ProjectGroup[] = []
    const seen = new Set<string>()
    let current: ProjectGroup | undefined = group
    while (current && !paths.has(current.id) && !seen.has(current.id)) {
      seen.add(current.id)
      pending.push(current)
      current = current.parentGroupId ? groupsById.get(current.parentGroupId) : undefined
    }
    let parent = current ? paths.get(current.id) : undefined
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const entry = pending[index]
      const path: OccurrenceSectionPath = { key: getProjectGroupHeaderKey(entry.id), parent }
      paths.set(entry.id, path)
      parent = path
    }
  }
  return paths
}
