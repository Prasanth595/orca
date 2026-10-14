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
import type { PlaneConnectionStatus } from '../../../../shared/plane-types'
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

function statusPatch(contextKey: string, status: PlaneConnectionStatus): Partial<PlaneSlice> {
  return {
    planeStatus: status,
    planeStatusChecked: true,
    planeStatusContextKey: contextKey,
    planeStatusIssue: null,
    ...(status.connected ? {} : { planeProjects: [], planeProjectsContextKey: null })
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
    planeProjects: [],
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
          set(statusPatch(contextKey, status))
        }
      } catch (error) {
        if (isCurrent(generation, contextKey)) {
          set({
            ...statusPatch(contextKey, DISCONNECTED),
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
            ...statusPatch(contextKey, result.status),
            planeProjects: result.projects,
            planeProjectsContextKey: contextKey
          })
          showPlaneInTasks(get)
        }
        return result
      } catch (error) {
        return { ok: false, error: clientErrorKind(error), message: clientErrorMessage(error) }
      }
    },

    disconnectPlane: async () => {
      const generation = ++planeRequestGeneration
      const { target, contextKey } = currentTarget(get)
      const status = await planeDisconnectForTarget(target)
      if (isCurrent(generation, contextKey)) {
        set(statusPatch(contextKey, status))
      }
    },

    setPlaneProjectScope: async (scope) => {
      const generation = ++planeRequestGeneration
      const { target, contextKey } = currentTarget(get)
      try {
        const result = await planeSetProjectScopeForTarget(target, scope)
        if (result.ok && isCurrent(generation, contextKey)) {
          set(statusPatch(contextKey, result.value))
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
        if (result.ok && getProviderRuntimeContextKey(get().settings) === contextKey) {
          set({ planeProjects: result.value, planeProjectsContextKey: contextKey })
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
