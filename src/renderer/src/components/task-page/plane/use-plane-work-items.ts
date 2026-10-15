import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PlaneErrorKind } from '@/components/plane/plane-error-copy'
import {
  isPlaneRuntimeUpdateRequiredError,
  planeListStatesForTarget,
  planeListWorkItemsForTarget
} from '@/runtime/runtime-plane-client'
import type { PlaneState, PlaneWorkItem } from '../../../../../shared/plane-types'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import { runtimeTargetEnvironmentId } from '@/runtime/runtime-client-target'
import { getPlaneWorkItemKey } from './plane-work-item-filters'
import {
  INITIAL_PLANE_WORK_ITEMS_STATE,
  planeWorkItemsFailed,
  planeWorkItemsLoaded,
  planeWorkItemsWithMore,
  type PlaneWorkItemsState
} from './plane-work-item-pages'

export type { PlaneWorkItemsState } from './plane-work-item-pages'

/** Focus refreshes are spaced so tab switching never spends the host's Plane rate budget. */
export const PLANE_FOCUS_REFRESH_MIN_MS = 60_000

/** One workspace connection to list, optionally narrowed to one of its projects. */
export type PlaneWorkItemSource = { connectionId: string; projectId: string | null }

type StatesByConnection = Record<string, PlaneWorkItemsState>

function clientErrorKind(error: unknown): PlaneErrorKind {
  return isPlaneRuntimeUpdateRequiredError(error) ? 'update_required' : 'runtime_error'
}

function initialStates(sources: readonly PlaneWorkItemSource[]): StatesByConnection {
  return Object.fromEntries(
    sources.map((source) => [source.connectionId, INITIAL_PLANE_WORK_ITEMS_STATE])
  )
}

/**
 * Loads one listWorkItems page per project of each source connection; every connection is one
 * request through the host's own Plane gate. A new target, scope or project choice aborts what is
 * in flight; nothing polls — refresh is manual or on window focus at most once a minute.
 */
export function usePlaneWorkItems(args: {
  target: RuntimeClientTarget
  /** Changes whenever the host, connections or saved scopes change. */
  sourceKey: string
  sources: readonly PlaneWorkItemSource[]
}): {
  states: StatesByConnection
  items: PlaneWorkItem[]
  refresh: () => void
  loadMore: (connectionId: string, projectId: string) => void
  replaceItem: (item: PlaneWorkItem) => void
} {
  const { target, sourceKey, sources } = args
  const sourcesKey = JSON.stringify(sources)
  const [states, setStates] = useState<StatesByConnection>(() => initialStates(sources))
  const controllerRef = useRef<AbortController | null>(null)
  const lastRequestAtRef = useRef(0)
  const loadingMoreRef = useRef(false)

  const load = useCallback(
    (refresh: boolean) => {
      controllerRef.current?.abort()
      // Why: the aborted load-more never settles into this state, so it must not keep blocking.
      loadingMoreRef.current = false
      const controller = new AbortController()
      controllerRef.current = controller
      lastRequestAtRef.current = Date.now()
      const current: readonly PlaneWorkItemSource[] = JSON.parse(sourcesKey)
      setStates((previous) =>
        Object.fromEntries(
          current.map(({ connectionId }) => {
            const before = previous[connectionId]
            return [
              connectionId,
              refresh && before?.status === 'ready'
                ? { ...before, refreshing: true }
                : INITIAL_PLANE_WORK_ITEMS_STATE
            ]
          })
        )
      )
      for (const { connectionId, projectId } of current) {
        const params = {
          connectionId,
          ...(projectId ? { projectIds: [projectId] } : {}),
          ...(refresh ? { refresh: true } : {})
        }
        const settle = (next: PlaneWorkItemsState): void => {
          if (!controller.signal.aborted) {
            setStates((previous) => ({ ...previous, [connectionId]: next }))
          }
        }
        planeListWorkItemsForTarget(target, params).then(
          (result) => settle(planeWorkItemsLoaded(result)),
          (error: unknown) => settle(planeWorkItemsFailed(clientErrorKind(error)))
        )
      }
    },
    [sourcesKey, target]
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
    (connectionId: string, projectId: string) => {
      const cursor = states[connectionId]?.nextCursorByProject[projectId]
      const controller = controllerRef.current
      if (!cursor || !controller || loadingMoreRef.current) {
        return
      }
      loadingMoreRef.current = true
      const patch = (update: (previous: PlaneWorkItemsState) => PlaneWorkItemsState): void => {
        setStates((previous) => {
          const before = previous[connectionId]
          return before ? { ...previous, [connectionId]: update(before) } : previous
        })
      }
      patch((previous) => ({ ...previous, loadingMoreProjectId: projectId }))
      const settle = (update: (previous: PlaneWorkItemsState) => PlaneWorkItemsState): void => {
        // Why: after a reload the flag belongs to the new load, possibly to a newer load-more.
        if (controller.signal.aborted) {
          return
        }
        loadingMoreRef.current = false
        patch((previous) => ({ ...update(previous), loadingMoreProjectId: null }))
      }
      const params = {
        connectionId,
        projectIds: [projectId],
        cursorByProject: { [projectId]: cursor }
      }
      planeListWorkItemsForTarget(target, params).then(
        (result) => settle((previous) => planeWorkItemsWithMore(previous, projectId, result)),
        () => settle((previous) => previous)
      )
    },
    [states, target]
  )

  // Why by key: ids repeat across workspaces, so a change targets one connection's item only.
  const replaceItem = useCallback((next: PlaneWorkItem) => {
    const key = getPlaneWorkItemKey(next)
    setStates((previous) => {
      const before = previous[next.connectionId]
      if (!before) {
        return previous
      }
      const items = before.items.map((entry) => (getPlaneWorkItemKey(entry) === key ? next : entry))
      return { ...previous, [next.connectionId]: { ...before, items } }
    })
  }, [])

  const items = useMemo(() => Object.values(states).flatMap((state) => state.items), [states])
  const refresh = useCallback(() => load(true), [load])
  return { states, items, refresh, loadMore, replaceItem }
}

/** States are fetched only for one chosen project, so the exact-state filter costs one call. */
export function usePlaneProjectStates(
  target: RuntimeClientTarget,
  connectionId: string,
  projectId: string | null
): PlaneState[] {
  const [statesByProject, setStatesByProject] = useState<Record<string, PlaneState[]>>({})
  // Why the host: a base URL like localhost or a private IP names a different server per host.
  const hostKey = runtimeTargetEnvironmentId(target) ?? 'local'
  const key = projectId ? `${hostKey}:${connectionId}:${projectId}` : null
  const loaded = key ? statesByProject[key] : undefined

  useEffect(() => {
    if (!key || !projectId || loaded) {
      return
    }
    let cancelled = false
    planeListStatesForTarget(target, projectId, connectionId).then(
      (result) => {
        if (!cancelled && result.ok) {
          setStatesByProject((previous) => ({ ...previous, [key]: result.value }))
        }
      },
      () => {}
    )
    return () => {
      cancelled = true
    }
  }, [connectionId, key, loaded, projectId, target])

  return loaded ?? []
}
