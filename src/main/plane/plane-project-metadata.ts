import type { PlaneMember, PlaneState } from '../../shared/plane-types'
import { isPlaneApiError } from './plane-api-error'
import { planeApiPath, planeRequest } from './plane-http'
import { collectPlanePages, planePageQuery } from './plane-pagination'
import { workspaceSegments, type PlaneSession } from './plane-session'
import { mapPlaneMember, mapPlaneState } from './plane-work-item-mapping'

export const PLANE_METADATA_TTL_MS = 10 * 60_000
const MAX_METADATA_PAGES = 5
const MAX_METADATA_ITEMS = 2_000

type Entry<T> = { at: number; value: T }
const states = new Map<string, Entry<PlaneState[]>>()
const members = new Map<string, Entry<PlaneMember[]>>()
// Connections whose server does not serve the workspace member list to this token.
const projectMembersOnly = new Set<string>()

type MetadataOptions = { refresh?: boolean; signal?: AbortSignal }

async function cached<T>(
  cache: Map<string, Entry<T>>,
  key: string,
  options: MetadataOptions,
  load: () => Promise<T>
): Promise<T> {
  const entry = cache.get(key)
  if (!options.refresh && entry && Date.now() - entry.at < PLANE_METADATA_TTL_MS) {
    return entry.value
  }
  const value = await load()
  cache.set(key, { at: Date.now(), value })
  return value
}

async function fetchList<T>(
  session: PlaneSession,
  segments: string[],
  map: (raw: unknown) => T | null,
  signal?: AbortSignal
): Promise<T[]> {
  const path = planeApiPath(...segments)
  const { items } = await collectPlanePages(
    (cursor) => planeRequest(session.target, path, { query: planePageQuery(cursor), signal }),
    { maxPages: MAX_METADATA_PAGES, maxItems: MAX_METADATA_ITEMS }
  )
  return items.map(map).filter((value): value is T => value !== null)
}

export function getPlaneProjectStates(
  session: PlaneSession,
  projectId: string,
  options: MetadataOptions = {}
): Promise<PlaneState[]> {
  return cached(states, `${session.connection.id}\n${projectId}`, options, async () =>
    (
      await fetchList(
        session,
        workspaceSegments(session, 'projects', projectId, 'states'),
        mapPlaneState,
        options.signal
      )
    ).sort((a, b) => a.sequence - b.sequence)
  )
}

/**
 * Workspace members, or the project's members when the workspace list is not served
 * (older servers, or a token without workspace-level access).
 */
export async function getPlaneMembers(
  session: PlaneSession,
  projectId: string,
  options: MetadataOptions = {}
): Promise<PlaneMember[]> {
  const connectionId = session.connection.id
  if (!projectMembersOnly.has(connectionId)) {
    try {
      return await cached(members, connectionId, options, () =>
        fetchList(session, workspaceSegments(session, 'members'), mapPlaneMember, options.signal)
      )
    } catch (error) {
      if (!isPlaneApiError(error) || (error.kind !== 'not_found' && error.kind !== 'forbidden')) {
        throw error
      }
      projectMembersOnly.add(connectionId)
    }
  }
  return cached(members, `${connectionId}\n${projectId}`, options, () =>
    fetchList(
      session,
      workspaceSegments(session, 'projects', projectId, 'members'),
      mapPlaneMember,
      options.signal
    )
  )
}

export function forgetPlaneProjectMetadata(connectionId?: string): void {
  if (connectionId) {
    projectMembersOnly.delete(connectionId)
  } else {
    projectMembersOnly.clear()
  }
  for (const cache of [states, members]) {
    for (const key of cache.keys()) {
      if (!connectionId || key === connectionId || key.startsWith(`${connectionId}\n`)) {
        cache.delete(key)
      }
    }
  }
}

export function toIdMap<T extends { id: string }>(values: readonly T[]): Map<string, T> {
  return new Map(values.map((value) => [value.id, value]))
}
