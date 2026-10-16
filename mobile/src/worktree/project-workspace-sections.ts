import { projectGroupIdFromRepoId } from '../../../src/shared/folder-workspace-worktree'
import { planProjectGroupSections } from '../../../src/shared/project-group-section-plan'
import {
  buildProjectSections,
  type ProjectGroupingIndex
} from '../../../src/shared/project-section-grouping'
import { withRepoSectionDisplayLabels } from '../../../src/shared/project-section-order'
import type { FilterState, Section, SectionRepo, Worktree } from './workspace-list-types'
import type { ProjectSectionCatalog } from './workspace-list-sections'
import { getWorktreeRowIdentity } from './worktree-host-row-identity'

export function makeSection(
  key: string,
  title: string,
  data: readonly Worktree[],
  decoration: Pick<Section, 'icon' | 'repo' | 'depth' | 'count'> = {}
): Section {
  return {
    key,
    title,
    ...(decoration.icon ? { icon: decoration.icon } : {}),
    ...(decoration.repo ? { repo: decoration.repo } : {}),
    ...(decoration.depth ? { depth: decoration.depth } : {}),
    ...(decoration.count !== undefined ? { count: decoration.count } : {}),
    data: [...data]
  }
}

function orderMainWorktreeFirst(worktrees: Worktree[]): Worktree[] {
  const mainWorktrees = worktrees.filter((worktree) => worktree.isMainWorktree)
  if (mainWorktrees.length === 0) {
    return worktrees
  }
  return [...mainWorktrees, ...worktrees.filter((worktree) => !worktree.isMainWorktree)]
}

/**
 * Project grouping's sections, nested under the desktop sidebar's Project Groups when it serves
 * them. Each nested section names the group headers whose collapse hides it.
 */
export function buildProjectWorkspaceSections(args: {
  /** Rows the sections hold: natural placement, pinned rows already removed. */
  rows: readonly Worktree[]
  /** Every row on the host, so a repo with any row never opens an empty placeholder section. */
  allRows: readonly Worktree[]
  displayRootByIdentity: ReadonlyMap<string, Worktree>
  repoMap: ReadonlyMap<string, SectionRepo>
  projectIndex: ProjectGroupingIndex | null
  projectCatalog: ProjectSectionCatalog
  filters: FilterState
  search: string
}): { sections: Section[]; ancestorKeysBySection: Map<string, readonly string[]> } {
  const { projectCatalog, filters } = args
  const representedRepoIds = new Set(args.allRows.map((w) => w.repoId))
  const query = args.search.trim().toLowerCase()
  const placeholderRepoIds = projectCatalog.repos
    .filter(
      (repo) =>
        !representedRepoIds.has(repo.id) &&
        (filters.filterRepoIds.length === 0 || filters.filterRepoIds.includes(repo.id)) &&
        (!query || repo.displayName.toLowerCase().includes(query))
    )
    .map((repo) => repo.id)
  const { projectGroups } = projectCatalog
  const groupIds = new Set(projectGroups.map((group) => group.id))
  // Why: a folder workspace row sits directly under its Project Group header, as on the desktop.
  const folderRowsByGroupId = new Map<string, Worktree[]>()
  const projectItems: Worktree[] = []
  for (const w of args.rows) {
    const groupId = projectGroupIdFromRepoId(w.repoId)
    if (groupId && groupIds.has(groupId)) {
      folderRowsByGroupId.set(groupId, [...(folderRowsByGroupId.get(groupId) ?? []), w])
    } else {
      projectItems.push(w)
    }
  }
  const projectSections = buildProjectSections({
    items: projectItems,
    repoIdOf: (w) => w.repoId,
    displayRepoIdOf: (w) => (args.displayRootByIdentity.get(getWorktreeRowIdentity(w)) ?? w).repoId,
    repoMap: args.repoMap,
    projectIndex: args.projectIndex,
    placeholderRepoIds,
    repoOrder: projectCatalog.repoOrder,
    projectOrderBy: projectCatalog.projectOrderBy
  })
  // Why: like the desktop, an ungrouped catalog keeps buildProjectSections' order and labels.
  const steps =
    projectGroups.length > 0
      ? planProjectGroupSections({
          entries: projectSections,
          projectGroups,
          projectOrderBy: projectCatalog.projectOrderBy,
          repoOrder: projectCatalog.repoOrder,
          directRowCountOf: (groupId) => folderRowsByGroupId.get(groupId)?.length ?? 0
        })
      : withRepoSectionDisplayLabels(projectSections).map((entry) => ({
          kind: 'section' as const,
          entry,
          depth: 0,
          ancestorKeys: []
        }))

  const sections: Section[] = []
  const ancestorKeysBySection = new Map<string, readonly string[]>()
  for (const step of steps) {
    if (step.kind === 'section') {
      const [key, section] = step.entry
      sections.push(
        makeSection(key, section.label, orderMainWorktreeFirst(section.items), {
          repo: section.repo,
          depth: step.depth
        })
      )
      ancestorKeysBySection.set(key, step.ancestorKeys)
      continue
    }
    // Why: under a search, a group with nothing matching would only hide the empty state.
    if (query && step.count === 0) {
      continue
    }
    sections.push(
      makeSection(step.key, step.group.name, folderRowsByGroupId.get(step.group.id) ?? [], {
        icon: 'project-group',
        depth: step.depth,
        count: step.count
      })
    )
    ancestorKeysBySection.set(step.key, step.ancestorKeys)
  }
  return { sections, ancestorKeysBySection }
}
