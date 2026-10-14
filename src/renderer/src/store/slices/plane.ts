import type { StateCreator } from 'zustand'
import { defaultScopeSource } from '@/lib/default-creation-host'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import {
  isPlaneRuntimeUpdateRequiredError,
  planeConnectForTarget,
  planeDisconnectForTarget,
  planeListProjectsForTarget,
  planeSetProjectScopeForTarget,
  planeStatusForTarget
} from '@/runtime/runtime-plane-client'
import { getPlaneRuntimeTarget } from '@/runtime/runtime-plane-target'
import type { PlaneConnectionStatus, PlaneProject } from '../../../../shared/plane-types'
import { normalizeVisibleTaskProviders } from '../../../../shared/task-providers'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { AppState } from '../types'
import {
  DEFAULT_PLANE_WORK_ITEM_FILTERS,
  type PlaneClientErrorKind,
  type PlaneSlice,
  type PlaneSliceGet
} from './plane-slice-contract'

export type {
  PlaneClientResult,
  PlaneConnectAttempt,
  PlaneSlice,
  PlaneWorkItemFilters
} from './plane-slice-contract'
export { DEFAULT_PLANE_WORK_ITEM_FILTERS } from './plane-slice-contract'

const DISCONNECTED: PlaneConnectionStatus = { connected: false }

// Why: a slower answer from an earlier request must not overwrite a newer connect/disconnect.
let planeRequestGeneration = 0

function clientErrorKind(error: unknown): PlaneClientErrorKind {
  return isPlaneRuntimeUpdateRequiredError(error) ? 'update_required' : 'runtime_error'
}

function clientErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function currentTarget(get: PlaneSliceGet): { target: RuntimeClientTarget; contextKey: string } {
  const settings = get().settings
  return {
    target: getPlaneRuntimeTarget(defaultScopeSource(settings)),
    contextKey: getProviderRuntimeContextKey(settings)
  }
}

// Why: connecting is an explicit ask to use Plane, so it re-shows a tab hidden earlier; a
// profile that never connects keeps whatever the one-time load migration and the user chose.
function showPlaneInTasks(get: PlaneSliceGet): void {
  const settings = get().settings
  const visible = normalizeVisibleTaskProviders(settings?.visibleTaskProviders)
  if (settings && !visible.includes('plane')) {
    void get().updateSettings({ visibleTaskProviders: [...visible, 'plane'] })
  }
}

// Why prune: a removed workspace's projects must not linger for a later one to read.
function keepLiveProjects(
  projects: Record<string, PlaneProject[]>,
  status: PlaneConnectionStatus
): Record<string, PlaneProject[]> {
  const live = new Set(status.connected ? status.connections.map((e) => e.connection.id) : [])
  return Object.fromEntries(Object.entries(projects).filter(([id]) => live.has(id)))
}

function statusPatch(
  get: PlaneSliceGet,
  contextKey: string,
  status: PlaneConnectionStatus
): Partial<PlaneSlice> {
  return {
    planeStatus: status,
    planeStatusChecked: true,
    planeStatusContextKey: contextKey,
    planeStatusIssue: null,
    ...(status.connected
      ? { planeProjectsByConnection: keepLiveProjects(get().planeProjectsByConnection, status) }
      : { planeProjectsByConnection: {}, planeProjectsContextKey: null })
  }
}

function withProjects(
  get: PlaneSliceGet,
  contextKey: string,
  connectionId: string,
  projects: PlaneProject[]
): Partial<PlaneSlice> {
  const current =
    get().planeProjectsContextKey === contextKey ? get().planeProjectsByConnection : {}
  return {
    planeProjectsByConnection: { ...current, [connectionId]: projects },
    planeProjectsContextKey: contextKey
  }
}

export const createPlaneSlice: StateCreator<AppState, [], [], PlaneSlice> = (set, get) => {
  const isCurrent = (generation: number, contextKey: string): boolean =>
    generation === planeRequestGeneration &&
    getProviderRuntimeContextKey(get().settings) === contextKey

  return {
    planeStatus: DISCONNECTED,
    planeStatusChecked: false,
    planeStatusContextKey: null,
    planeStatusIssue: null,
    planeProjectsByConnection: {},
    planeProjectsContextKey: null,
    planeWorkItemFiltersByConnection: {},

    checkPlaneConnection: async () => {
      const generation = planeRequestGeneration
      const { target, contextKey } = currentTarget(get)
      if (get().planeStatusContextKey !== contextKey) {
        set({ planeStatusChecked: false })
      }
      try {
        const status = await planeStatusForTarget(target)
        if (isCurrent(generation, contextKey)) {
          set(statusPatch(get, contextKey, status))
        }
      } catch (error) {
        if (isCurrent(generation, contextKey)) {
          set({
            ...statusPatch(get, contextKey, DISCONNECTED),
            planeStatusIssue: clientErrorKind(error)
          })
        }
      }
    },

    connectPlane: async (args) => {
      const generation = ++planeRequestGeneration
      const { target, contextKey } = currentTarget(get)
      try {
        const result = await planeConnectForTarget(target, args)
        if (result.ok && isCurrent(generation, contextKey)) {
          set({
            ...statusPatch(get, contextKey, result.status),
            ...withProjects(get, contextKey, result.connection.id, result.projects)
          })
          showPlaneInTasks(get)
        }
        return result
      } catch (error) {
        return { ok: false, error: clientErrorKind(error), message: clientErrorMessage(error) }
      }
    },

    disconnectPlane: async (connectionId) => {
      const generation = ++planeRequestGeneration
      const { target, contextKey } = currentTarget(get)
      const status = await planeDisconnectForTarget(target, connectionId)
      if (isCurrent(generation, contextKey)) {
        set(statusPatch(get, contextKey, status))
      }
    },

    setPlaneProjectScope: async (scope, connectionId) => {
      const generation = ++planeRequestGeneration
      const { target, contextKey } = currentTarget(get)
      try {
        const result = await planeSetProjectScopeForTarget(target, scope, connectionId)
        if (result.ok && isCurrent(generation, contextKey)) {
          set(statusPatch(get, contextKey, result.value))
        }
        return result
      } catch (error) {
        return {
          ok: false,
          error: { kind: clientErrorKind(error), message: clientErrorMessage(error) }
        }
      }
    },

    loadPlaneProjects: async (options) => {
      const { target, contextKey } = currentTarget(get)
      try {
        const result = await planeListProjectsForTarget(target, options)
        const status = get().planeStatus
        const connectionId =
          options?.connectionId ?? (status.connected ? status.connection.id : null)
        if (
          result.ok &&
          connectionId &&
          getProviderRuntimeContextKey(get().settings) === contextKey
        ) {
          set(withProjects(get, contextKey, connectionId, result.value))
        }
        return result
      } catch (error) {
        return {
          ok: false,
          error: { kind: clientErrorKind(error), message: clientErrorMessage(error) }
        }
      }
    },

    setPlaneWorkItemFilters: (connectionId, patch) =>
      set((state) => ({
        planeWorkItemFiltersByConnection: {
          ...state.planeWorkItemFiltersByConnection,
          [connectionId]: {
            ...(state.planeWorkItemFiltersByConnection[connectionId] ??
              DEFAULT_PLANE_WORK_ITEM_FILTERS),
            ...patch
          }
        }
      }))
  }
}
