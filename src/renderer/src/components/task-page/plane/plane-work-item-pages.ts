import type { PlaneErrorKind } from '@/components/plane/plane-error-copy'
import {
  PLANE_API_ERROR_KINDS,
  type PlaneApiErrorKind,
  type PlaneListError,
  type PlaneResult,
  type PlaneWorkItem,
  type PlaneWorkItemList
} from '../../../../../shared/plane-types'
import { mergePlaneWorkItems } from './plane-work-item-filters'

/** What one workspace connection's list looks like; the "all workspaces" view holds one each. */
export type PlaneWorkItemsState = {
  status: 'loading' | 'ready' | 'error'
  error: PlaneErrorKind | null
  items: PlaneWorkItem[]
  errors: PlaneListError[]
  missingProjectIds: string[]
  truncatedProjectIds: string[]
  nextCursorByProject: Record<string, string>
  totalCapped: boolean
  needsScope: boolean
  refreshing: boolean
  loadingMoreProjectId: string | null
}

export const INITIAL_PLANE_WORK_ITEMS_STATE: PlaneWorkItemsState = {
  status: 'loading',
  error: null,
  items: [],
  errors: [],
  missingProjectIds: [],
  truncatedProjectIds: [],
  nextCursorByProject: {},
  totalCapped: false,
  needsScope: false,
  refreshing: false,
  loadingMoreProjectId: null
}

function toListErrorKind(kind: string): PlaneApiErrorKind {
  return PLANE_API_ERROR_KINDS.find((known) => known === kind) ?? 'network'
}

export function planeWorkItemsLoaded(result: PlaneResult<PlaneWorkItemList>): PlaneWorkItemsState {
  if (!result.ok) {
    return { ...INITIAL_PLANE_WORK_ITEMS_STATE, status: 'error', error: result.error.kind }
  }
  const list = result.value
  return {
    ...INITIAL_PLANE_WORK_ITEMS_STATE,
    status: 'ready',
    items: list.items,
    errors: list.errors,
    missingProjectIds: list.missingProjectIds,
    truncatedProjectIds: list.truncatedProjectIds,
    nextCursorByProject: list.nextCursorByProject ?? {},
    totalCapped: list.totalCapped,
    needsScope: list.needsScope === true
  }
}

export function planeWorkItemsFailed(kind: PlaneErrorKind): PlaneWorkItemsState {
  return { ...INITIAL_PLANE_WORK_ITEMS_STATE, status: 'error', error: kind }
}

/** Appends one project's next page, or records why it could not load, without a retry. */
export function planeWorkItemsWithMore(
  previous: PlaneWorkItemsState,
  projectId: string,
  result: PlaneResult<PlaneWorkItemList>
): PlaneWorkItemsState {
  if (!result.ok) {
    const error = { projectId, kind: toListErrorKind(result.error.kind) }
    const known = previous.errors.some(
      (entry) => entry.projectId === error.projectId && entry.kind === error.kind
    )
    return known ? previous : { ...previous, errors: [...previous.errors, error] }
  }
  const nextCursorByProject = { ...previous.nextCursorByProject }
  delete nextCursorByProject[projectId]
  Object.assign(nextCursorByProject, result.value.nextCursorByProject ?? {})
  const stillTruncated = result.value.truncatedProjectIds.includes(projectId)
  return {
    ...previous,
    items: mergePlaneWorkItems(previous.items, result.value.items),
    nextCursorByProject,
    truncatedProjectIds: stillTruncated
      ? previous.truncatedProjectIds
      : previous.truncatedProjectIds.filter((id) => id !== projectId)
  }
}

/**
 * One list state over several workspaces: ready once any has loaded, an error only when all
 * failed; per-workspace problems are shown as banners, not here.
 */
export function combinePlaneWorkItemsStates(
  states: readonly PlaneWorkItemsState[]
): PlaneWorkItemsState {
  const items = states.flatMap((state) => state.items)
  const refreshing = states.some((state) => state.refreshing)
  if (states.some((state) => state.status === 'ready')) {
    return { ...INITIAL_PLANE_WORK_ITEMS_STATE, status: 'ready', items, refreshing }
  }
  const failed = states.find((state) => state.status === 'error')
  if (states.length > 0 && states.every((state) => state.status === 'error') && failed) {
    return { ...INITIAL_PLANE_WORK_ITEMS_STATE, status: 'error', error: failed.error }
  }
  return INITIAL_PLANE_WORK_ITEMS_STATE
}
