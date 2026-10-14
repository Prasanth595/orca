import { isPlaneUuid } from '../../shared/plane-ids'
import {
  PLANE_PRIORITIES,
  PLANE_STATE_GROUPS,
  type PlaneComment,
  type PlaneLabel,
  type PlaneMember,
  type PlanePriority,
  type PlaneProject,
  type PlaneState,
  type PlaneStateGroup,
  type PlaneWorkItem,
  type PlaneWorkItemDetail
} from '../../shared/plane-types'
import { buildPlaneWorkItemUrl } from '../../shared/plane-url'
import { planeHtmlToText } from './plane-comment-html'

// Why every reader here is defensive: field names and expansion differ between Plane
// Cloud and self-hosted releases, so unknown fields are ignored and missing ones default.

export const PLANE_DESCRIPTION_MAX_CHARS = 20_000

export type PlaneMappingContext = {
  connection: { id: string; webBaseUrl: string; workspaceSlug: string }
  project: PlaneProject
  states?: ReadonlyMap<string, PlaneState>
  members?: ReadonlyMap<string, PlaneMember>
}

type RawRecord = Record<string, unknown>

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function firstName(...values: unknown[]): string | null {
  const found = values.find((v): v is string => typeof v === 'string' && v.trim().length > 0)
  return found?.trim() ?? null
}

function isStateGroup(value: unknown): value is PlaneStateGroup {
  return PLANE_STATE_GROUPS.some((group) => group === value)
}

function isPriority(value: unknown): value is PlanePriority {
  return PLANE_PRIORITIES.some((priority) => priority === value)
}

export function mapPlaneState(raw: unknown): PlaneState | null {
  if (!isRecord(raw) || !isPlaneUuid(raw.id)) {
    return null
  }
  return {
    id: raw.id.toLowerCase(),
    name: firstName(raw.name) ?? 'Unnamed state',
    // An unknown group counts as in progress, so the default "open" filter still shows it.
    group: isStateGroup(raw.group) ? raw.group : 'started',
    color: text(raw.color),
    sequence: typeof raw.sequence === 'number' && Number.isFinite(raw.sequence) ? raw.sequence : 0
  }
}

/** Accepts a user, or a membership row that nests the user under `member`. */
export function mapPlaneMember(raw: unknown): PlaneMember | null {
  const user = isRecord(raw) && isRecord(raw.member) ? raw.member : raw
  if (!isRecord(user) || !isPlaneUuid(user.id)) {
    return null
  }
  const id = user.id.toLowerCase()
  return { id, displayName: firstName(user.display_name, user.first_name, user.email) ?? id }
}

function mapLabel(raw: unknown): PlaneLabel | null {
  if (!isRecord(raw) || !isPlaneUuid(raw.id)) {
    return null
  }
  return { id: raw.id.toLowerCase(), name: firstName(raw.name) ?? '', color: text(raw.color) }
}

function resolveState(raw: RawRecord, states?: ReadonlyMap<string, PlaneState>): PlaneState | null {
  const value = isRecord(raw.state)
    ? raw.state
    : isRecord(raw.state_detail)
      ? raw.state_detail
      : raw.state
  if (typeof value === 'string') {
    return states?.get(value.toLowerCase()) ?? null
  }
  return mapPlaneState(value)
}

function rawList(raw: RawRecord, key: string, detailKey: string): unknown[] {
  const expanded = raw[detailKey]
  if (Array.isArray(expanded) && expanded.length > 0) {
    return expanded
  }
  return Array.isArray(raw[key]) ? raw[key] : []
}

function resolveMembers(raw: RawRecord, members?: ReadonlyMap<string, PlaneMember>): PlaneMember[] {
  return rawList(raw, 'assignees', 'assignee_details').flatMap((entry) => {
    const member =
      typeof entry === 'string' ? members?.get(entry.toLowerCase()) : mapPlaneMember(entry)
    return member ? [member] : []
  })
}

/** Which lookups an item needs because the server did not expand it. */
export function planeWorkItemLookups(raw: unknown): { states: boolean; members: boolean } {
  if (!isRecord(raw)) {
    return { states: false, members: false }
  }
  return {
    states: typeof raw.state === 'string' && !isRecord(raw.state_detail),
    members: rawList(raw, 'assignees', 'assignee_details').some(
      (entry) => typeof entry === 'string'
    )
  }
}

export function mapPlaneWorkItem(raw: unknown, context: PlaneMappingContext): PlaneWorkItem | null {
  if (!isRecord(raw) || !isPlaneUuid(raw.id)) {
    return null
  }
  const sequenceId = raw.sequence_id
  if (typeof sequenceId !== 'number' || !Number.isSafeInteger(sequenceId) || sequenceId < 1) {
    return null
  }
  const id = raw.id.toLowerCase()
  const { project, connection } = context
  return {
    connectionId: connection.id,
    id,
    projectId: project.id,
    projectIdentifier: project.identifier,
    sequenceId,
    identifier: `${project.identifier}-${sequenceId}`,
    name: text(raw.name),
    state: resolveState(raw, context.states),
    priority: isPriority(raw.priority) ? raw.priority : 'none',
    assignees: resolveMembers(raw, context.members),
    labels: rawList(raw, 'labels', 'label_details').flatMap((entry) => {
      const label = mapLabel(entry)
      return label ? [label] : []
    }),
    createdAt: text(raw.created_at),
    updatedAt: text(raw.updated_at),
    url: buildPlaneWorkItemUrl(connection, { projectId: project.id, id })
  }
}

export function mapPlaneWorkItemDetail(
  raw: unknown,
  context: PlaneMappingContext
): PlaneWorkItemDetail | null {
  const item = mapPlaneWorkItem(raw, context)
  if (!item || !isRecord(raw)) {
    return null
  }
  const full =
    typeof raw.description_stripped === 'string'
      ? raw.description_stripped.trim()
      : planeHtmlToText(text(raw.description_html))
  const truncated = full.length > PLANE_DESCRIPTION_MAX_CHARS
  return {
    ...item,
    descriptionText: truncated ? full.slice(0, PLANE_DESCRIPTION_MAX_CHARS) : full,
    truncated
  }
}

/** The author's id when only an id came back, so the caller can look the member up. */
export function planeCommentAuthorId(raw: unknown): string | null {
  if (!isRecord(raw)) {
    return null
  }
  const id = [raw.actor, raw.created_by].find(isPlaneUuid)
  return id ? id.toLowerCase() : null
}

export function planeCommentNeedsMembers(raw: unknown): boolean {
  return planeCommentAuthorId(raw) !== null && !(isRecord(raw) && isRecord(raw.actor_detail))
}

export function mapPlaneComment(
  raw: unknown,
  members?: ReadonlyMap<string, PlaneMember>
): PlaneComment | null {
  if (!isRecord(raw) || !isPlaneUuid(raw.id)) {
    return null
  }
  const actor = isRecord(raw.actor_detail) ? mapPlaneMember(raw.actor_detail) : null
  const authorId = planeCommentAuthorId(raw)
  return {
    id: raw.id.toLowerCase(),
    authorName:
      actor?.displayName ?? (authorId ? members?.get(authorId)?.displayName : null) ?? 'Unknown',
    text:
      typeof raw.comment_stripped === 'string'
        ? raw.comment_stripped.trim()
        : planeHtmlToText(text(raw.comment_html)),
    createdAt: text(raw.created_at)
  }
}
