import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  type ExecutionHostId
} from '../../../../../../shared/execution-host'

/**
 * The sidebar's view of project groups once same-named groups from different
 * hosts share one header.
 *
 * Why: a project group lives on the host that holds it, so one folder checked
 * out on two machines arrives as two groups with the same name. Under Group by
 * Project the user sees that folder once, with every host's projects under it;
 * the groups themselves stay separate rows on their own hosts.
 */
export type CrossHostProjectGroupMerge = {
  /** One group per header. A merged header carries its representative, with
   *  `parentGroupId` pointing at the display id of its merged parent. */
  displayGroups: readonly ProjectGroup[]
  /** Member id → the id of the header it renders under. Absent for groups that merged with nothing. */
  displayGroupIdById: ReadonlyMap<string, string>
  /** Header id → the member groups it stands for, at most one per host. Absent for unmerged headers. */
  membersByDisplayId: ReadonlyMap<string, readonly ProjectGroup[]>
}

type MergeSet = {
  members: ProjectGroup[]
  hostIds: Set<ExecutionHostId>
  parentDisplayId: string | null
}

const EMPTY_DISPLAY_IDS: ReadonlyMap<string, string> = new Map()
const EMPTY_MEMBERS: ReadonlyMap<string, readonly ProjectGroup[]> = new Map()

function normalizeProjectGroupMergeName(name: string): string {
  return name.trim().toLocaleLowerCase()
}

function pickRepresentative(
  members: readonly ProjectGroup[],
  defaultHostId: ExecutionHostId
): ProjectGroup {
  // Why: collapse state and header actions key on this id, so prefer the host the
  // user is focused on, then this computer, so the id survives host toggles.
  return (
    members.find((group) => getRepoExecutionHostId(group) === defaultHostId) ??
    members.find((group) => getRepoExecutionHostId(group) === LOCAL_EXECUTION_HOST_ID) ??
    members[0]!
  )
}

/** Section emission treats a parent that is not in the list as no parent. */
function getPresentParentId(
  group: ProjectGroup,
  groupsById: ReadonlyMap<string, ProjectGroup>
): string | null {
  return group.parentGroupId && groupsById.has(group.parentGroupId) ? group.parentGroupId : null
}

function getProjectGroupDepth(
  group: ProjectGroup,
  groupsById: ReadonlyMap<string, ProjectGroup>
): number {
  const seen = new Set<string>([group.id])
  let depth = 0
  let parentId = getPresentParentId(group, groupsById)
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    depth += 1
    parentId = getPresentParentId(groupsById.get(parentId)!, groupsById)
  }
  return depth
}

export function mergeProjectGroupsAcrossHosts(
  projectGroups: readonly ProjectGroup[],
  defaultHostId: ExecutionHostId
): CrossHostProjectGroupMerge {
  const groupsById = new Map(projectGroups.map((group) => [group.id, group]))
  // Why by depth: a child can only join its sibling on another host once both
  // parents have resolved to the same header.
  const levels: ProjectGroup[][] = []
  for (const group of projectGroups) {
    const depth = getProjectGroupDepth(group, groupsById)
    ;(levels[depth] ??= []).push(group)
  }
  const displayGroupIdById = new Map<string, string>()
  const membersByDisplayId = new Map<string, readonly ProjectGroup[]>()
  const displayGroups: ProjectGroup[] = []
  let merged = false
  for (const level of levels) {
    if (!level) {
      continue
    }
    const setsByKey = new Map<string, MergeSet[]>()
    const orderedSets: MergeSet[] = []
    for (const group of level) {
      const parentId = getPresentParentId(group, groupsById)
      const parentDisplayId = parentId ? (displayGroupIdById.get(parentId) ?? parentId) : null
      const hostId = getRepoExecutionHostId(group)
      const key = `${parentDisplayId ?? ''}\u0000${normalizeProjectGroupMergeName(group.name)}`
      const candidates = setsByKey.get(key) ?? []
      // Why one per host: two same-named groups on one host are the user's own
      // layout; only copies of that layout on other hosts fold into it.
      let set = candidates.find((candidate) => !candidate.hostIds.has(hostId))
      if (!set) {
        set = { members: [], hostIds: new Set(), parentDisplayId }
        candidates.push(set)
        setsByKey.set(key, candidates)
        orderedSets.push(set)
      }
      set.members.push(group)
      set.hostIds.add(hostId)
    }
    for (const set of orderedSets) {
      const representative = pickRepresentative(set.members, defaultHostId)
      if (set.members.length > 1) {
        merged = true
        membersByDisplayId.set(representative.id, set.members)
        for (const member of set.members) {
          displayGroupIdById.set(member.id, representative.id)
        }
      }
      displayGroups.push(
        getPresentParentId(representative, groupsById) === set.parentDisplayId
          ? representative
          : { ...representative, parentGroupId: set.parentDisplayId }
      )
    }
  }
  if (!merged) {
    // Why the same array: nothing folded, so downstream memos keyed on the list must not churn.
    return {
      displayGroups: projectGroups,
      displayGroupIdById: EMPTY_DISPLAY_IDS,
      membersByDisplayId: EMPTY_MEMBERS
    }
  }
  return { displayGroups, displayGroupIdById, membersByDisplayId }
}

/** The header id a group renders under; the group's own id when it merged with nothing. */
export function resolveDisplayProjectGroupId(
  projectGroupId: string | null | undefined,
  merge: Pick<CrossHostProjectGroupMerge, 'displayGroupIdById'> | null | undefined
): string | null {
  if (!projectGroupId) {
    return null
  }
  return merge?.displayGroupIdById.get(projectGroupId) ?? projectGroupId
}

/** Every group a header stands for; the header's own group when it merged with nothing. */
export function getProjectGroupMembersForDisplayId(
  merge: Pick<CrossHostProjectGroupMerge, 'membersByDisplayId'> | null | undefined,
  displayGroupId: string,
  fallback?: ProjectGroup
): readonly ProjectGroup[] {
  return merge?.membersByDisplayId.get(displayGroupId) ?? (fallback ? [fallback] : [])
}

/** The member of a merged header that lives on `hostId`, if that host contributed one. */
export function findProjectGroupMemberForHost(
  merge: Pick<CrossHostProjectGroupMerge, 'membersByDisplayId'> | null | undefined,
  displayGroupId: string,
  hostId: ExecutionHostId
): ProjectGroup | undefined {
  return merge?.membersByDisplayId
    .get(displayGroupId)
    ?.find((member) => getRepoExecutionHostId(member) === hostId)
}

/** The member row a folder workspace or repo actually belongs to, by its own group id. */
export function findProjectGroupMemberById(
  merge:
    | Pick<CrossHostProjectGroupMerge, 'displayGroupIdById' | 'membersByDisplayId'>
    | null
    | undefined,
  projectGroupId: string
): ProjectGroup | undefined {
  const displayGroupId = resolveDisplayProjectGroupId(projectGroupId, merge)
  return displayGroupId
    ? merge?.membersByDisplayId.get(displayGroupId)?.find((member) => member.id === projectGroupId)
    : undefined
}
