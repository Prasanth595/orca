import { isPlaneProjectIdentifier, isPlaneUuid } from '../../shared/plane-ids'
import type { PlaneProject } from '../../shared/plane-types'
import { planeApiPath, planeRequest, type PlaneHttpTarget } from './plane-http'
import { collectPlanePages, planePageQuery } from './plane-pagination'

export const PLANE_PROJECTS_TTL_MS = 5 * 60_000
const MAX_PROJECT_PAGES = 10
const MAX_PROJECTS = 1_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Archived projects and ones the viewer is not a member of are skipped; both can't be listed. */
export function mapPlaneProject(raw: unknown): PlaneProject | null {
  if (!isRecord(raw) || !isPlaneUuid(raw.id)) {
    return null
  }
  if ((raw.archived_at !== null && raw.archived_at !== undefined) || raw.is_member === false) {
    return null
  }
  const identifier = typeof raw.identifier === 'string' ? raw.identifier.trim().toUpperCase() : ''
  if (!isPlaneProjectIdentifier(identifier)) {
    return null
  }
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : identifier
  return { id: raw.id.toLowerCase(), name, identifier }
}

export async function fetchPlaneProjects(
  target: PlaneHttpTarget,
  workspaceSlug: string,
  signal?: AbortSignal
): Promise<PlaneProject[]> {
  const path = planeApiPath('workspaces', workspaceSlug, 'projects')
  const { items } = await collectPlanePages(
    (cursor) => planeRequest(target, path, { query: planePageQuery(cursor), signal }),
    { maxPages: MAX_PROJECT_PAGES, maxItems: MAX_PROJECTS }
  )
  return items
    .map(mapPlaneProject)
    .filter((project): project is PlaneProject => project !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

type CacheEntry = { at: number; projects: PlaneProject[] }
const cache = new Map<string, CacheEntry>()

/** Live project list per connection, reused for five minutes unless `refresh` is set. */
export async function getPlaneProjects(
  connectionId: string,
  target: PlaneHttpTarget,
  workspaceSlug: string,
  options: { refresh?: boolean; signal?: AbortSignal } = {}
): Promise<PlaneProject[]> {
  const entry = cache.get(connectionId)
  if (!options.refresh && entry && Date.now() - entry.at < PLANE_PROJECTS_TTL_MS) {
    return entry.projects
  }
  const projects = await fetchPlaneProjects(target, workspaceSlug, options.signal)
  cache.set(connectionId, { at: Date.now(), projects })
  return projects
}

export function primePlaneProjects(connectionId: string, projects: PlaneProject[]): void {
  cache.set(connectionId, { at: Date.now(), projects })
}

export function forgetPlaneProjects(connectionId?: string): void {
  if (connectionId) {
    cache.delete(connectionId)
  } else {
    cache.clear()
  }
}
