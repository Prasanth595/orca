import type {
  PlaneAddCommentParams,
  PlaneUpdateStateParams
} from '../../shared/rpc-contract/plane-params'
import type { PlaneComment, PlaneWorkItem } from '../../shared/plane-types'
import { isPlaneApiError, PlaneApiError } from './plane-api-error'
import { planeCommentHtml } from './plane-comment-html'
import { planeRequest } from './plane-http'
import { getPlaneMembers, toIdMap } from './plane-project-metadata'
import type { PlaneSession } from './plane-session'
import {
  mapPlaneComment,
  mapPlaneWorkItem,
  planeCommentNeedsMembers
} from './plane-work-item-mapping'
import {
  fetchPlaneWorkItemRaw,
  mapPlaneRawWorkItem,
  planeProjectContext,
  workItemPath
} from './plane-work-item-read'

// Why no retry anywhere here: a write may have landed before the failure surfaced, and
// planeRequest never repeats a PATCH or POST either.

function asWriteError(error: unknown): never {
  if (isPlaneApiError(error) && error.kind === 'forbidden') {
    throw new PlaneApiError('forbidden', { status: error.status, write: true })
  }
  throw error
}

export async function updatePlaneWorkItemState(
  session: PlaneSession,
  params: PlaneUpdateStateParams,
  signal?: AbortSignal
): Promise<PlaneWorkItem> {
  const context = await planeProjectContext(session, (p) => p.id === params.projectId, signal)
  const raw = await planeRequest(
    session.target,
    workItemPath(session, context, params.workItemId),
    {
      method: 'PATCH',
      body: { state: params.stateId },
      signal
    }
  ).catch(asWriteError)
  // The PATCH reply may be partial; reread the item when it cannot be mapped on its own.
  try {
    return await mapPlaneRawWorkItem(session, context.project, raw, mapPlaneWorkItem, signal)
  } catch (error) {
    if (signal?.aborted || !isPlaneApiError(error) || error.kind !== 'invalid_response') {
      throw error
    }
  }
  const fresh = await fetchPlaneWorkItemRaw(session, context, params.workItemId, signal)
  return mapPlaneRawWorkItem(session, context.project, fresh, mapPlaneWorkItem, signal)
}

export async function addPlaneWorkItemComment(
  session: PlaneSession,
  params: PlaneAddCommentParams,
  signal?: AbortSignal
): Promise<PlaneComment> {
  const context = await planeProjectContext(session, (p) => p.id === params.projectId, signal)
  const raw = await planeRequest(
    session.target,
    workItemPath(session, context, params.workItemId, 'comments'),
    { method: 'POST', body: { comment_html: planeCommentHtml(params.text) }, signal }
  ).catch(asWriteError)
  const members = planeCommentNeedsMembers(raw)
    ? await getPlaneMembers(session, context.project.id, { signal }).catch(() => [])
    : []
  const comment = mapPlaneComment(raw, toIdMap(members))
  if (!comment) {
    throw new PlaneApiError('invalid_response')
  }
  // Echo what the user wrote when the server's reply omits the stripped text.
  return comment.text ? comment : { ...comment, text: params.text }
}
