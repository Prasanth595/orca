import { isPlaneUuid, parsePlaneWorkItemIdentifier } from '../../shared/plane-ids'
import type { PlaneWorkItemRefParams } from '../../shared/rpc-contract/plane-params'
import type {
  PlaneApiFlavor,
  PlaneComment,
  PlaneProject,
  PlaneWorkItemDetail
} from '../../shared/plane-types'
import { PlaneApiError } from './plane-api-error'
import { resolvePlaneApiFlavor } from './plane-api-flavor'
import { planeApiPath, planeRequest } from './plane-http'
import { collectPlanePages, planePageQuery } from './plane-pagination'
import { getPlaneMembers, getPlaneProjectStates, toIdMap } from './plane-project-metadata'
import { getPlaneProjects } from './plane-projects'
import { workspaceSegments, type PlaneSession } from './plane-session'
import {
  mapPlaneComment,
  mapPlaneWorkItemDetail,
  planeCommentNeedsMembers,
  planeWorkItemLookups,
  type PlaneMappingContext
} from './plane-work-item-mapping'
import { PLANE_WORK_ITEM_EXPAND } from './plane-work-items'

const MAX_COMMENT_PAGES = 3
const MAX_COMMENTS = 300

export type PlaneProjectContext = { project: PlaneProject; flavor: PlaneApiFlavor }

function findProject(
  projects: readonly PlaneProject[],
  match: (project: PlaneProject) => boolean
): PlaneProject {
  const project = projects.find(match)
  if (!project) {
    throw new PlaneApiError('not_found')
  }
  return project
}

/** The live project and API flavor for an item, from caches when they are warm. */
export async function planeProjectContext(
  session: PlaneSession,
  match: (project: PlaneProject) => boolean,
  signal?: AbortSignal
): Promise<PlaneProjectContext> {
  const { connection } = session
  const projects = await getPlaneProjects(connection.id, session.target, connection.workspaceSlug, {
    signal
  })
  const project = findProject(projects, match)
  const flavor = await resolvePlaneApiFlavor(
    connection.id,
    session.target,
    connection.workspaceSlug,
    project.id,
    signal
  )
  return { project, flavor }
}

export function workItemPath(
  session: PlaneSession,
  context: PlaneProjectContext,
  workItemId: string,
  ...rest: string[]
): string {
  const { project, flavor } = context
  return planeApiPath(
    ...workspaceSegments(session, 'projects', project.id, flavor, workItemId, ...rest)
  )
}

/** Maps one raw item, loading states or members only when the server did not expand them. */
export async function mapPlaneRawWorkItem<T>(
  session: PlaneSession,
  project: PlaneProject,
  raw: unknown,
  map: (raw: unknown, context: PlaneMappingContext) => T | null,
  signal?: AbortSignal
): Promise<T> {
  const needs = planeWorkItemLookups(raw)
  const [states, members] = await Promise.all([
    needs.states ? getPlaneProjectStates(session, project.id, { signal }) : [],
    needs.members ? getPlaneMembers(session, project.id, { signal }) : []
  ])
  const mapped = map(raw, {
    connection: session.connection,
    project,
    states: toIdMap(states),
    members: toIdMap(members)
  })
  if (mapped === null) {
    throw new PlaneApiError('invalid_response')
  }
  return mapped
}

export function fetchPlaneWorkItemRaw(
  session: PlaneSession,
  context: PlaneProjectContext,
  workItemId: string,
  signal?: AbortSignal
): Promise<unknown> {
  return planeRequest(session.target, workItemPath(session, context, workItemId), {
    query: { expand: PLANE_WORK_ITEM_EXPAND },
    signal
  })
}

export async function getPlaneWorkItem(
  session: PlaneSession,
  ref: PlaneWorkItemRefParams,
  signal?: AbortSignal
): Promise<PlaneWorkItemDetail> {
  const context = await planeProjectContext(session, (p) => p.id === ref.projectId, signal)
  const raw = await fetchPlaneWorkItemRaw(session, context, ref.workItemId, signal)
  return mapPlaneRawWorkItem(session, context.project, raw, mapPlaneWorkItemDetail, signal)
}

/** Resolves `WEB-12` through the workspace-wide identifier route. */
export async function lookupPlaneWorkItem(
  session: PlaneSession,
  identifier: string,
  signal?: AbortSignal
): Promise<PlaneWorkItemDetail> {
  const parsed = parsePlaneWorkItemIdentifier(identifier)
  if (!parsed) {
    throw new PlaneApiError('not_found')
  }
  const context = await planeProjectContext(
    session,
    (p) => p.identifier === parsed.projectIdentifier,
    signal
  )
  const path = planeApiPath(...workspaceSegments(session, context.flavor, parsed.identifier))
  const raw = await planeRequest(session.target, path, {
    query: { expand: PLANE_WORK_ITEM_EXPAND },
    signal
  })
  // Why check: the identifier route is workspace-wide, so the answer must match the project.
  const project = typeof raw === 'object' && raw !== null && 'project' in raw ? raw.project : null
  if (isPlaneUuid(project) && project.toLowerCase() !== context.project.id) {
    throw new PlaneApiError('invalid_response')
  }
  return mapPlaneRawWorkItem(session, context.project, raw, mapPlaneWorkItemDetail, signal)
}

export async function listPlaneComments(
  session: PlaneSession,
  ref: PlaneWorkItemRefParams,
  signal?: AbortSignal
): Promise<PlaneComment[]> {
  const context = await planeProjectContext(session, (p) => p.id === ref.projectId, signal)
  const path = workItemPath(session, context, ref.workItemId, 'comments')
  const { items } = await collectPlanePages(
    (cursor) => planeRequest(session.target, path, { query: planePageQuery(cursor), signal }),
    { maxPages: MAX_COMMENT_PAGES, maxItems: MAX_COMMENTS }
  )
  const members = items.some(planeCommentNeedsMembers)
    ? await getPlaneMembers(session, context.project.id, { signal }).catch(() => [])
    : []
  const memberMap = toIdMap(members)
  return items
    .map((raw) => mapPlaneComment(raw, memberMap))
    .filter((comment): comment is PlaneComment => comment !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}
