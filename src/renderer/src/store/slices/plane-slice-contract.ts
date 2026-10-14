import type { StateCreator } from 'zustand'
import type { PlaneConnectArgs } from '../../../../preload/api/plane-api'
import type {
  PlaneConnectResult,
  PlaneConnectionStatus,
  PlanePriority,
  PlaneProject,
  PlaneProjectScope,
  PlaneResult,
  PlaneStateGroup
} from '../../../../shared/plane-types'
import type { AppState } from '../types'

/** Failures the renderer sees before a Plane host answers: an old host or an unreachable one. */
export type PlaneClientErrorKind = 'update_required' | 'runtime_error'

export type PlaneConnectAttempt =
  | PlaneConnectResult
  | { ok: false; error: PlaneClientErrorKind; message: string }

export type PlaneClientResult<T> =
  | PlaneResult<T>
  | { ok: false; error: { kind: PlaneClientErrorKind; message: string } }

export type PlaneWorkItemFilters = {
  /** Null = every project in the saved scope. */
  projectId: string | null
  /** 'open' = backlog + unstarted + started. */
  stateGroup: 'open' | 'all' | PlaneStateGroup
  /** Exact state, only meaningful while one project is chosen. */
  stateId: string | null
  /** 'me', 'unassigned', 'anyone', or a member id. */
  assignee: string
  priority: PlanePriority | 'any'
  text: string
}

export const DEFAULT_PLANE_WORK_ITEM_FILTERS: PlaneWorkItemFilters = {
  projectId: null,
  stateGroup: 'open',
  stateId: null,
  assignee: 'anyone',
  priority: 'any',
  text: ''
}

// Why no token here: the slice only ever holds what the host returns, which never includes it.
export type PlaneSlice = {
  planeStatus: PlaneConnectionStatus
  planeStatusChecked: boolean
  planeStatusContextKey: string | null
  planeStatusIssue: PlaneClientErrorKind | null
  planeProjects: PlaneProject[]
  planeProjectsContextKey: string | null
  /** Tasks-tab filters, keyed by connection id; never change the saved project scope. */
  planeWorkItemFiltersByConnection: Record<string, PlaneWorkItemFilters>

  checkPlaneConnection: () => Promise<void>
  connectPlane: (args: PlaneConnectArgs) => Promise<PlaneConnectAttempt>
  disconnectPlane: () => Promise<void>
  setPlaneProjectScope: (
    scope: PlaneProjectScope
  ) => Promise<PlaneClientResult<PlaneConnectionStatus>>
  loadPlaneProjects: (options?: { refresh?: boolean }) => Promise<PlaneClientResult<PlaneProject[]>>
  setPlaneWorkItemFilters: (connectionId: string, patch: Partial<PlaneWorkItemFilters>) => void
}

type PlaneStateCreator = StateCreator<AppState, [], [], PlaneSlice>
export type PlaneSliceSet = Parameters<PlaneStateCreator>[0]
export type PlaneSliceGet = Parameters<PlaneStateCreator>[1]
