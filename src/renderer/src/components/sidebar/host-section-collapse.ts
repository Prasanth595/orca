import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { HostSectionRow } from './host-section-rows'
import { PINNED_GROUP_KEY } from './worktree-list/grouping/group-keys'

export function isHostLaneSectionKey(key: string): boolean {
  return (
    key === PINNED_GROUP_KEY ||
    key === 'all' ||
    key.startsWith('pr:') ||
    key.startsWith('workspace-status:')
  )
}

export function getHostSectionCollapseKey(key: string, hostId: ExecutionHostId): string {
  return hostId === 'local' || !isHostLaneSectionKey(key) ? key : `${key}:host:${hostId}`
}

export function deferHostSectionCollapse(collapsedGroups: Set<string>): Set<string> {
  if (![...collapsedGroups].some(isHostLaneSectionKey)) {
    return collapsedGroups
  }
  return new Set([...collapsedGroups].filter((key) => !isHostLaneSectionKey(key)))
}

export function scopeHostSectionCollapse(args: {
  rows: readonly HostSectionRow[]
  collapsedGroups: ReadonlySet<string>
}): HostSectionRow[] {
  let sectionCollapsed = false
  return args.rows.flatMap((row): HostSectionRow[] => {
    if (row.type === 'host-header') {
      sectionCollapsed = false
    }
    if (row.type === 'header') {
      sectionCollapsed = false
      if (!isHostLaneSectionKey(row.key)) {
        return [row]
      }
      const hostId =
        row.hostId ??
        (row.hostWorktreeCounts?.size === 1
          ? row.hostWorktreeCounts.keys().next().value
          : undefined)
      const collapseKey = hostId ? getHostSectionCollapseKey(row.key, hostId) : row.key
      sectionCollapsed = args.collapsedGroups.has(collapseKey)
      return [{ ...row, collapseKey }]
    }
    return sectionCollapsed ? [] : [row]
  })
}


/**
 * Drop persisted `project-group:<id>` collapse keys whose groups no longer exist.
 * Stale keys survive Cloud/Local parent renames and flat-squad reshuffles; the
 * TanStack sidebar virtualizer then measures ghost rows and overlaps headers
 * (see stablyai/orca#13945 / project UI sidebar corruption).
 */
export function sanitizeCollapsedGroupsAgainstProjectGroups(
  collapsedGroups: Iterable<string>,
  projectGroups: ReadonlyArray<{ id: string }>
): string[] {
  const valid = new Set(projectGroups.map((group) => group.id))
  const next: string[] = []
  for (const key of collapsedGroups) {
    if (key.startsWith('project-group:')) {
      const groupId = key.slice('project-group:'.length)
      if (!valid.has(groupId)) {
        continue
      }
    }
    next.push(key)
  }
  return next
}
