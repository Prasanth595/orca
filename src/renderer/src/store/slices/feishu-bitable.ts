import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { FeishuBitableSlice } from './feishu-bitable-slice-contract'
import {
  feishuBitableConnect,
  feishuBitableDisconnect,
  feishuBitableGetRecord,
  feishuBitableListFields,
  feishuBitableListRecords,
  feishuBitableSelectConnection,
  feishuBitableStatus,
  feishuBitableUpdateFieldMapping
} from '@/runtime/runtime-feishu-bitable-client'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { defaultScopeSource } from '@/lib/default-creation-host'

export type { FeishuBitableSlice } from './feishu-bitable-slice-contract'

export const createFeishuBitableSlice: StateCreator<AppState, [], [], FeishuBitableSlice> = (
  set,
  get
) => {
  let readGeneration = 0
  let statusGeneration = 0
  return {
    feishuBitableStatus: { connected: false, connections: [], activeConnectionId: null },
    feishuBitableStatusChecked: false,
    feishuBitableStatusContextKey: null,
    feishuBitableTasks: [],
    feishuBitableNextPageToken: null,
    feishuBitableLoading: false,
    feishuBitableError: null,
    feishuBitableConnectOpen: false,
    selectedFeishuBitableTask: null,

    setFeishuBitableConnectOpen: (open) => set({ feishuBitableConnectOpen: open }),
    setSelectedFeishuBitableTask: (task) => set({ selectedFeishuBitableTask: task }),

    checkFeishuBitableConnection: async () => {
      const generation = ++statusGeneration
      const contextKey = getProviderRuntimeContextKey(get().settings)
      if (get().feishuBitableStatusContextKey !== contextKey) {
        readGeneration += 1
        set({
          feishuBitableStatusChecked: false,
          feishuBitableStatus: { connected: false, connections: [], activeConnectionId: null },
          feishuBitableTasks: [],
          selectedFeishuBitableTask: null,
          feishuBitableNextPageToken: null,
          feishuBitableError: null,
          feishuBitableLoading: false
        })
      }
      try {
        const status = await feishuBitableStatus(defaultScopeSource(get().settings))
        if (
          generation !== statusGeneration ||
          getProviderRuntimeContextKey(get().settings) !== contextKey
        ) {
          return
        }
        set({
          feishuBitableStatus: status,
          feishuBitableStatusChecked: true,
          feishuBitableStatusContextKey: contextKey
        })
      } catch (error) {
        if (
          generation !== statusGeneration ||
          getProviderRuntimeContextKey(get().settings) !== contextKey
        ) {
          return
        }
        set({
          feishuBitableError:
            error instanceof Error ? error.message : 'Feishu connection check failed.',
          feishuBitableStatus: { connected: false, connections: [], activeConnectionId: null },
          feishuBitableStatusChecked: true,
          feishuBitableStatusContextKey: contextKey
        })
      }
    },

    connectFeishuBitable: async (args) => {
      const contextKey = getProviderRuntimeContextKey(get().settings)
      const result = await feishuBitableConnect(defaultScopeSource(get().settings), args)
      if (result.ok && getProviderRuntimeContextKey(get().settings) === contextKey) {
        await get().checkFeishuBitableConnection()
      }
      return result
    },

    disconnectFeishuBitable: async (connectionId) => {
      const contextKey = getProviderRuntimeContextKey(get().settings)
      readGeneration += 1
      statusGeneration += 1
      set({ feishuBitableLoading: false })
      await feishuBitableDisconnect(defaultScopeSource(get().settings), connectionId ?? undefined)
      if (getProviderRuntimeContextKey(get().settings) !== contextKey) {
        return
      }
      set({
        feishuBitableLoading: false,
        feishuBitableTasks: [],
        feishuBitableNextPageToken: null,
        selectedFeishuBitableTask: null
      })
      await get().checkFeishuBitableConnection()
    },

    selectFeishuBitableConnection: async (connectionId) => {
      const contextKey = getProviderRuntimeContextKey(get().settings)
      const generation = ++statusGeneration
      readGeneration += 1
      set({ feishuBitableLoading: false })
      const status = await feishuBitableSelectConnection(
        defaultScopeSource(get().settings),
        connectionId
      )
      if (
        generation !== statusGeneration ||
        getProviderRuntimeContextKey(get().settings) !== contextKey
      ) {
        return
      }
      set({
        feishuBitableLoading: false,
        feishuBitableStatus: status,
        feishuBitableStatusChecked: true,
        feishuBitableStatusContextKey: getProviderRuntimeContextKey(get().settings),
        feishuBitableTasks: [],
        feishuBitableNextPageToken: null,
        feishuBitableError: null,
        selectedFeishuBitableTask: null
      })
    },

    fetchFeishuBitableRecords: async (args) => {
      const generation = ++readGeneration
      const contextKey = getProviderRuntimeContextKey(get().settings)
      const activeConnectionId = get().feishuBitableStatus.activeConnectionId
      const isCurrent = () =>
        generation === readGeneration &&
        getProviderRuntimeContextKey(get().settings) === contextKey &&
        get().feishuBitableStatus.activeConnectionId === activeConnectionId
      const append = args?.append ?? false
      set({ feishuBitableLoading: true })
      try {
        const result = await feishuBitableListRecords(defaultScopeSource(get().settings), {
          connectionId: args?.connectionId ?? null,
          pageToken: args?.pageToken ?? null
        })
        if (!isCurrent()) {
          return result
        }
        if (result.ok) {
          set((state) => ({
            feishuBitableTasks: append
              ? [...state.feishuBitableTasks, ...result.page.tasks]
              : result.page.tasks,
            feishuBitableNextPageToken: result.page.nextPageToken,
            feishuBitableError: null,
            feishuBitableLoading: false
          }))
        } else {
          set({ feishuBitableError: result.error, feishuBitableLoading: false })
        }
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Feishu Bitable read failed.'
        if (isCurrent()) {
          set({ feishuBitableError: message, feishuBitableLoading: false })
        }
        throw error
      }
    },

    fetchFeishuBitableRecord: async (args) =>
      feishuBitableGetRecord(defaultScopeSource(get().settings), args),

    fetchFeishuBitableFields: async (connectionId) =>
      feishuBitableListFields(defaultScopeSource(get().settings), connectionId ?? null),

    updateFeishuBitableFieldMapping: async (args) => {
      const contextKey = getProviderRuntimeContextKey(get().settings)
      const result = await feishuBitableUpdateFieldMapping(defaultScopeSource(get().settings), args)
      if (result.ok && getProviderRuntimeContextKey(get().settings) === contextKey) {
        await get().checkFeishuBitableConnection()
      }
      return result
    }
  }
}
