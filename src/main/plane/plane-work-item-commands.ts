import type {
  PlaneAddCommentParams,
  PlaneListWorkItemsParams,
  PlaneLookupIdentifierParams,
  PlaneUpdateStateParams,
  PlaneWorkItemRefParams
} from '../../shared/rpc-contract/plane-params'
import type {
  PlaneComment,
  PlaneMember,
  PlaneState,
  PlaneWorkItem,
  PlaneWorkItemDetail,
  PlaneWorkItemList
} from '../../shared/plane-types'
import { getPlaneMembers, getPlaneProjectStates } from './plane-project-metadata'
import { getActivePlaneSession } from './plane-session'
import {
  getPlaneWorkItem,
  listPlaneComments,
  lookupPlaneWorkItem,
  planeProjectContext
} from './plane-work-item-read'
import { addPlaneWorkItemComment, updatePlaneWorkItemState } from './plane-work-item-mutations'
import { listPlaneWorkItems } from './plane-work-items'

// Work item commands on the active connection, shared by IPC and runtime RPC like
// plane-commands.ts. Params arrive already validated by the plane-params schemas.

export function planeListWorkItems(
  params?: PlaneListWorkItemsParams,
  signal?: AbortSignal
): Promise<PlaneWorkItemList> {
  return listPlaneWorkItems(getActivePlaneSession(), params, signal)
}

export function planeGetWorkItem(
  params: PlaneWorkItemRefParams,
  signal?: AbortSignal
): Promise<PlaneWorkItemDetail> {
  return getPlaneWorkItem(getActivePlaneSession(), params, signal)
}

export function planeLookupWorkItem(
  params: PlaneLookupIdentifierParams,
  signal?: AbortSignal
): Promise<PlaneWorkItemDetail> {
  return lookupPlaneWorkItem(getActivePlaneSession(), params.identifier, signal)
}

export function planeListComments(
  params: PlaneWorkItemRefParams,
  signal?: AbortSignal
): Promise<PlaneComment[]> {
  return listPlaneComments(getActivePlaneSession(), params, signal)
}

/** States of a live project; a project outside the workspace is a not_found. */
export async function planeListStates(
  params: { projectId: string },
  signal?: AbortSignal
): Promise<PlaneState[]> {
  const session = getActivePlaneSession()
  await planeProjectContext(session, (p) => p.id === params.projectId, signal)
  return getPlaneProjectStates(session, params.projectId, { signal })
}

export async function planeListMembers(
  params: { projectId: string },
  signal?: AbortSignal
): Promise<PlaneMember[]> {
  const session = getActivePlaneSession()
  await planeProjectContext(session, (p) => p.id === params.projectId, signal)
  return getPlaneMembers(session, params.projectId, { signal })
}

export function planeUpdateState(
  params: PlaneUpdateStateParams,
  signal?: AbortSignal
): Promise<PlaneWorkItem> {
  return updatePlaneWorkItemState(getActivePlaneSession(), params, signal)
}

export function planeAddComment(
  params: PlaneAddCommentParams,
  signal?: AbortSignal
): Promise<PlaneComment> {
  return addPlaneWorkItemComment(getActivePlaneSession(), params, signal)
}
