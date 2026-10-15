import type { PlaneListWorkItemsParams } from '../../shared/rpc-contract/plane-params'
import type {
  PlaneApiFlavor,
  PlaneListError,
  PlaneProject,
  PlaneWorkItem,
  PlaneWorkItemList
} from '../../shared/plane-types'
import { isPlaneApiError } from './plane-api-error'
import { resolvePlaneApiFlavor } from './plane-api-flavor'
import { planeApiPath, planeRequest } from './plane-http'
import { parsePlanePage, planePageQuery } from './plane-pagination'
import { getPlaneMembers, getPlaneProjectStates, toIdMap } from './plane-project-metadata'
import { resolvePlaneProjectScope } from './plane-project-scope'
import { getPlaneProjects } from './plane-projects'
import { workspaceSegments, type PlaneSession } from './plane-session'
import { mapPlaneWorkItem, planeWorkItemLookups } from './plane-work-item-mapping'

// Why a total cap: the list crosses the remote runtime's WebSocket, whose frames cap at 1 MiB.
export const PLANE_WORK_ITEMS_TOTAL_CAP = 500
// Why so few: when no project answers, the flavor stays unknown and every list would fail.
const MAX_FLAVOR_PROBES = 3
export const PLANE_WORK_ITEM_EXPAND = 'state,assignees,labels'

type ProjectPage = {
  project: PlaneProject
  items: PlaneWorkItem[]
  nextCursor: string | null
}

async function resolveFlavor(
  session: PlaneSession,
  projects: readonly PlaneProject[],
  signal?: AbortSignal
): Promise<PlaneApiFlavor> {
  let lastError: unknown
  for (const project of projects.slice(0, MAX_FLAVOR_PROBES)) {
    try {
      return await resolvePlaneApiFlavor(
        session.connection.id,
        session.target,
        session.connection.workspaceSlug,
        project.id,
        signal
      )
    } catch (error) {
      if (!isPlaneApiError(error)) {
        throw error
      }
      lastError = error
    }
  }
  throw lastError
}

/** Maps a page, loading states or members only when the server did not expand them. */
export async function mapPlaneWorkItemPage(
  session: PlaneSession,
  project: PlaneProject,
  rawItems: readonly unknown[],
  signal?: AbortSignal
): Promise<PlaneWorkItem[]> {
  const needs = rawItems.map(planeWorkItemLookups)
  const optional = <T>(load: () => Promise<T[]>) => load().catch((): T[] => [])
  const [states, members] = await Promise.all([
    needs.some((need) => need.states)
      ? optional(() => getPlaneProjectStates(session, project.id, { signal }))
      : [],
    needs.some((need) => need.members)
      ? optional(() => getPlaneMembers(session, project.id, { signal }))
      : []
  ])
  const context = {
    connection: session.connection,
    project,
    states: toIdMap(states),
    members: toIdMap(members)
  }
  return rawItems
    .map((raw) => mapPlaneWorkItem(raw, context))
    .filter((item): item is PlaneWorkItem => item !== null)
}

async function fetchProjectPage(
  session: PlaneSession,
  flavor: PlaneApiFlavor,
  project: PlaneProject,
  cursor: string | undefined,
  signal?: AbortSignal
): Promise<ProjectPage> {
  const path = planeApiPath(...workspaceSegments(session, 'projects', project.id, flavor))
  const body = await planeRequest(session.target, path, {
    query: { ...planePageQuery(cursor), order_by: '-updated_at', expand: PLANE_WORK_ITEM_EXPAND },
    signal
  })
  const page = parsePlanePage(body)
  return {
    project,
    items: await mapPlaneWorkItemPage(session, project, page.results, signal),
    nextCursor: page.nextCursor
  }
}

function emptyList(extra: Partial<PlaneWorkItemList> = {}): PlaneWorkItemList {
  return {
    items: [],
    errors: [],
    missingProjectIds: [],
    truncatedProjectIds: [],
    totalCapped: false,
    ...extra
  }
}

/**
 * One page per project in scope, newest first. A failing project lands in `errors` and the
 * others still load; the caller's abort rejects the whole call.
 */
export async function listPlaneWorkItems(
  session: PlaneSession,
  params: PlaneListWorkItemsParams = undefined,
  signal?: AbortSignal
): Promise<PlaneWorkItemList> {
  const { connection } = session
  const live = await getPlaneProjects(connection.id, session.target, connection.workspaceSlug, {
    refresh: params?.refresh === true,
    signal
  })
  const scope = resolvePlaneProjectScope(connection.projectScope, live)
  if (scope.needsScope) {
    return emptyList({ needsScope: true })
  }
  const requested = params?.projectIds ? new Set(params.projectIds) : null
  const projects = requested ? scope.projects.filter((p) => requested.has(p.id)) : scope.projects
  // Why report ids outside the scope as missing: a client must not widen the saved scope.
  const outside = requested ? [...requested].filter((id) => !projects.some((p) => p.id === id)) : []
  const missingProjectIds = [...new Set([...scope.missingProjectIds, ...outside])]
  if (projects.length === 0) {
    return emptyList({ missingProjectIds })
  }

  let flavor: PlaneApiFlavor
  try {
    flavor = await resolveFlavor(session, projects, signal)
  } catch (error) {
    if (!isPlaneApiError(error)) {
      throw error
    }
    const errors = projects.map((p) => ({ projectId: p.id, kind: error.kind }))
    return emptyList({ errors, missingProjectIds })
  }

  // The request lane's gate keeps this to two requests in flight per key.
  const results = await Promise.all(
    projects.map((project) =>
      fetchProjectPage(
        session,
        flavor,
        project,
        params?.cursorByProject?.[project.id],
        signal
      ).catch((error: unknown): PlaneListError => {
        if (signal?.aborted || !isPlaneApiError(error)) {
          throw error
        }
        return { projectId: project.id, kind: error.kind }
      })
    )
  )

  const errors: PlaneListError[] = []
  const truncatedProjectIds: string[] = []
  const nextCursorByProject: Record<string, string> = {}
  const items: PlaneWorkItem[] = []
  for (const result of results) {
    if ('kind' in result) {
      errors.push(result)
      continue
    }
    items.push(...result.items)
    if (result.nextCursor) {
      truncatedProjectIds.push(result.project.id)
      nextCursorByProject[result.project.id] = result.nextCursor
    }
  }
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return {
    items: items.slice(0, PLANE_WORK_ITEMS_TOTAL_CAP),
    errors,
    missingProjectIds,
    truncatedProjectIds,
    ...(truncatedProjectIds.length > 0 ? { nextCursorByProject } : {}),
    totalCapped: items.length > PLANE_WORK_ITEMS_TOTAL_CAP
  }
}
