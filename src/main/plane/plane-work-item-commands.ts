import type {
  PlaneAddCommentParams,
  PlaneListWorkItemsParams,
  PlaneLookupIdentifierParams,
  PlaneProjectRefParams,
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
import { getPlaneSession } from './plane-session'
import {
  getPlaneWorkItem,
  listPlaneComments,
  lookupPlaneWorkItem,
  planeProjectContext
} from './plane-work-item-read'
import { addPlaneWorkItemComment, updatePlaneWorkItemState } from './plane-work-item-mutations'
import { listPlaneWorkItems } from './plane-work-items'

// Work item commands on one connection (the active one without a connectionId), shared by IPC
// and runtime RPC like plane-commands.ts. Params arrive validated by the plane-params schemas.

export function planeListWorkItems(
  params?: PlaneListWorkItemsParams,
  signal?: AbortSignal
): Promise<PlaneWorkItemList> {
  return listPlaneWorkItems(getPlaneSession(params?.connectionId), params, signal)
}

export function planeGetWorkItem(
  params: PlaneWorkItemRefParams,
  signal?: AbortSignal
): Promise<PlaneWorkItemDetail> {
  return getPlaneWorkItem(getPlaneSession(params.connectionId), params, signal)
}

export function planeLookupWorkItem(
  params: PlaneLookupIdentifierParams,
  signal?: AbortSignal
): Promise<PlaneWorkItemDetail> {
  return lookupPlaneWorkItem(getPlaneSession(params.connectionId), params.identifier, signal)
}

export function planeListComments(
  params: PlaneWorkItemRefParams,
  signal?: AbortSignal
): Promise<PlaneComment[]> {
  return listPlaneComments(getPlaneSession(params.connectionId), params, signal)
}

/** States of a live project; a project outside the workspace is a not_found. */
export async function planeListStates(
  params: PlaneProjectRefParams,
  signal?: AbortSignal
): Promise<PlaneState[]> {
  const session = getPlaneSession(params.connectionId)
  await planeProjectContext(session, (p) => p.id === params.projectId, signal)
  return getPlaneProjectStates(session, params.projectId, { signal })
}

export async function planeListMembers(
  params: PlaneProjectRefParams,
  signal?: AbortSignal
): Promise<PlaneMember[]> {
  const session = getPlaneSession(params.connectionId)
  await planeProjectContext(session, (p) => p.id === params.projectId, signal)
  return getPlaneMembers(session, params.projectId, { signal })
}

export function planeUpdateState(
  params: PlaneUpdateStateParams,
  signal?: AbortSignal
): Promise<PlaneWorkItem> {
  return updatePlaneWorkItemState(getPlaneSession(params.connectionId), params, signal)
}

export function planeAddComment(
  params: PlaneAddCommentParams,
  signal?: AbortSignal
): Promise<PlaneComment> {
  return addPlaneWorkItemComment(getPlaneSession(params.connectionId), params, signal)
}
