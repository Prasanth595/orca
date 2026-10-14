import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlaneErrorKind } from '@/components/plane/plane-error-copy'
import {
  isPlaneRuntimeUpdateRequiredError,
  planeListStatesForTarget,
  planeListWorkItemsForTarget
} from '@/runtime/runtime-plane-client'
import {
  PLANE_API_ERROR_KINDS,
  type PlaneApiErrorKind,
  type PlaneListError,
  type PlaneState,
  type PlaneWorkItem
} from '../../../../../shared/plane-types'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import { mergePlaneWorkItems } from './plane-work-item-filters'

/** Focus refreshes are spaced so tab switching never spends the host's Plane rate budget. */
export const PLANE_FOCUS_REFRESH_MIN_MS = 60_000

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

function toListErrorKind(kind: string): PlaneApiErrorKind {
  return PLANE_API_ERROR_KINDS.find((known) => known === kind) ?? 'network'
}

const INITIAL_STATE: PlaneWorkItemsState = {
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

function clientErrorKind(error: unknown): PlaneErrorKind {
  return isPlaneRuntimeUpdateRequiredError(error) ? 'update_required' : 'runtime_error'
}

/**
 * Loads one listWorkItems page per project. A new target, scope or project choice aborts the
 * request in flight; nothing polls — refresh is manual or on window focus at most once a minute.
 */
export function usePlaneWorkItems(args: {
  target: RuntimeClientTarget
  /** Changes whenever the host, connection or saved scope changes. */
  sourceKey: string
  projectId: string | null
}): {
  state: PlaneWorkItemsState
  refresh: () => void
  loadMore: (projectId: string) => void
} {
  const { target, sourceKey, projectId } = args
  const [state, setState] = useState<PlaneWorkItemsState>(INITIAL_STATE)
  const controllerRef = useRef<AbortController | null>(null)
  const lastRequestAtRef = useRef(0)

  const load = useCallback(
    (refresh: boolean) => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      lastRequestAtRef.current = Date.now()
      setState((previous) =>
        refresh && previous.status === 'ready'
          ? { ...previous, refreshing: true }
          : { ...INITIAL_STATE }
      )
      const params = {
        ...(projectId ? { projectIds: [projectId] } : {}),
        ...(refresh ? { refresh: true } : {})
      }
      planeListWorkItemsForTarget(target, params).then(
        (result) => {
          if (controller.signal.aborted) {
            return
          }
          setState(
            result.ok
              ? {
                  ...INITIAL_STATE,
                  status: 'ready',
                  items: result.value.items,
                  errors: result.value.errors,
                  missingProjectIds: result.value.missingProjectIds,
                  truncatedProjectIds: result.value.truncatedProjectIds,
                  nextCursorByProject: result.value.nextCursorByProject ?? {},
                  totalCapped: result.value.totalCapped,
                  needsScope: result.value.needsScope === true
                }
              : { ...INITIAL_STATE, status: 'error', error: result.error.kind }
          )
        },
        (error: unknown) => {
          if (!controller.signal.aborted) {
            setState({ ...INITIAL_STATE, status: 'error', error: clientErrorKind(error) })
          }
        }
      )
    },
    [projectId, target]
  )

  useEffect(() => {
    load(false)
    return () => controllerRef.current?.abort()
  }, [load, sourceKey])

  useEffect(() => {
    const onFocus = (): void => {
      if (Date.now() - lastRequestAtRef.current >= PLANE_FOCUS_REFRESH_MIN_MS) {
        load(true)
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  const loadMore = useCallback(
    (moreProjectId: string) => {
      const cursor = state.nextCursorByProject[moreProjectId]
      const controller = controllerRef.current
      if (!cursor || !controller || state.loadingMoreProjectId) {
        return
      }
      setState((previous) => ({ ...previous, loadingMoreProjectId: moreProjectId }))
      const params = { projectIds: [moreProjectId], cursorByProject: { [moreProjectId]: cursor } }
      const settle = (patch: (previous: PlaneWorkItemsState) => PlaneWorkItemsState): void => {
        if (!controller.signal.aborted) {
          setState((previous) => ({ ...patch(previous), loadingMoreProjectId: null }))
        }
      }
      planeListWorkItemsForTarget(target, params).then(
        (result) =>
          settle((previous) => {
            if (!result.ok) {
              const error = { projectId: moreProjectId, kind: toListErrorKind(result.error.kind) }
              const known = previous.errors.some(
                (entry) => entry.projectId === error.projectId && entry.kind === error.kind
              )
              return known ? previous : { ...previous, errors: [...previous.errors, error] }
            }
            const nextCursorByProject = { ...previous.nextCursorByProject }
            delete nextCursorByProject[moreProjectId]
            Object.assign(nextCursorByProject, result.value.nextCursorByProject ?? {})
            const stillTruncated = result.value.truncatedProjectIds.includes(moreProjectId)
            return {
              ...previous,
              items: mergePlaneWorkItems(previous.items, result.value.items),
              nextCursorByProject,
              truncatedProjectIds: stillTruncated
                ? previous.truncatedProjectIds
                : previous.truncatedProjectIds.filter((id) => id !== moreProjectId)
            }
          }),
        () => settle((previous) => previous)
      )
    },
    [state.loadingMoreProjectId, state.nextCursorByProject, target]
  )

  return { state, refresh: useCallback(() => load(true), [load]), loadMore }
}

/** States are fetched only for the one chosen project, so the exact-state filter costs one call. */
export function usePlaneProjectStates(
  target: RuntimeClientTarget,
  projectId: string | null
): PlaneState[] {
  const [statesByProject, setStatesByProject] = useState<Record<string, PlaneState[]>>({})
  const loaded = projectId ? statesByProject[projectId] : undefined

  useEffect(() => {
    if (!projectId || loaded) {
      return
    }
    let cancelled = false
    planeListStatesForTarget(target, projectId).then(
      (result) => {
        if (!cancelled && result.ok) {
          setStatesByProject((previous) => ({ ...previous, [projectId]: result.value }))
        }
      },
      () => {}
    )
    return () => {
      cancelled = true
    }
  }, [loaded, projectId, target])

  return loaded ?? []
}
