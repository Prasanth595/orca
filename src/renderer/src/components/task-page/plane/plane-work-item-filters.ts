import { parsePlaneWorkItemIdentifier } from '../../../../../shared/plane-ids'
import type {
  PlaneMember,
  PlaneProject,
  PlaneProjectScope,
  PlaneStateGroup,
  PlaneWorkItem
} from '../../../../../shared/plane-types'
import type { PlaneWorkItemFilters } from '@/store/slices/plane-slice-contract'

export const OPEN_PLANE_STATE_GROUPS: readonly PlaneStateGroup[] = [
  'backlog',
  'unstarted',
  'started'
]

/** An item without a state, or with a group Plane added later, still counts as open work. */
export function getPlaneStateGroup(item: PlaneWorkItem): PlaneStateGroup {
  return item.state?.group ?? 'started'
}

export function isOpenPlaneStateSelection(groups: readonly PlaneStateGroup[]): boolean {
  return (
    groups.length === OPEN_PLANE_STATE_GROUPS.length &&
    OPEN_PLANE_STATE_GROUPS.every((group) => groups.includes(group))
  )
}

function matchesAssignee(item: PlaneWorkItem, assignee: string, viewerId: string): boolean {
  switch (assignee) {
    case 'anyone':
      return true
    case 'unassigned':
      return item.assignees.length === 0
    case 'me':
      return item.assignees.some((member) => member.id === viewerId)
    default:
      return item.assignees.some((member) => member.id === assignee)
  }
}

function matchesText(item: PlaneWorkItem, text: string): boolean {
  const needle = text.trim().toLowerCase()
  return (
    !needle ||
    item.name.toLowerCase().includes(needle) ||
    item.identifier.toLowerCase().includes(needle)
  )
}

function matchesState(item: PlaneWorkItem, filters: PlaneWorkItemFilters): boolean {
  // Why: state ids belong to one project, so an exact state only applies with one project chosen.
  if (filters.projectId && filters.stateId) {
    return item.state?.id === filters.stateId
  }
  return filters.stateGroups.length === 0 || filters.stateGroups.includes(getPlaneStateGroup(item))
}

/** Local filters over the loaded pages; only the project choice changes what the host returns. */
export function filterPlaneWorkItems(
  items: readonly PlaneWorkItem[],
  filters: PlaneWorkItemFilters,
  viewerId: string
): PlaneWorkItem[] {
  return items
    .filter(
      (item) =>
        (!filters.projectId || item.projectId === filters.projectId) &&
        matchesState(item, filters) &&
        matchesAssignee(item, filters.assignee, viewerId) &&
        (filters.priority === 'any' || item.priority === filters.priority) &&
        matchesText(item, filters.text)
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Assignee choices come from the loaded items, so the filter costs no extra request. */
export function getPlaneAssigneeOptions(items: readonly PlaneWorkItem[]): PlaneMember[] {
  const byId = new Map<string, PlaneMember>()
  for (const item of items) {
    for (const member of item.assignees) {
      byId.set(member.id, member)
    }
  }
  return [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName))
}

/** A typed `WEB-12` names one work item; anything else is a text filter. */
export function getPlaneIdentifierQuery(text: string): string | null {
  return parsePlaneWorkItemIdentifier(text)?.identifier ?? null
}

export function getScopedPlaneProjects(
  projects: readonly PlaneProject[],
  scope: PlaneProjectScope | null
): PlaneProject[] {
  if (!scope) {
    return []
  }
  if (scope.mode === 'all') {
    return [...projects]
  }
  const selected = new Set(scope.projectIds)
  return projects.filter((project) => selected.has(project.id))
}

export function hasActivePlaneFilters(filters: PlaneWorkItemFilters): boolean {
  return (
    filters.projectId !== null ||
    filters.stateId !== null ||
    !isOpenPlaneStateSelection(filters.stateGroups) ||
    filters.assignee !== 'anyone' ||
    filters.priority !== 'any' ||
    filters.text.trim() !== ''
  )
}

/** Ids are unique only within one connection, so identity always carries the connection. */
export function getPlaneWorkItemKey(item: Pick<PlaneWorkItem, 'connectionId' | 'id'>): string {
  return `${item.connectionId}:${item.id}`
}

/** Appends a "load more" page without duplicating items already shown. */
export function mergePlaneWorkItems(
  existing: readonly PlaneWorkItem[],
  more: readonly PlaneWorkItem[]
): PlaneWorkItem[] {
  const seen = new Set(existing.map(getPlaneWorkItemKey))
  return [...existing, ...more.filter((item) => !seen.has(getPlaneWorkItemKey(item)))]
}
