import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type {
  FeishuBitableConnectResult,
  FeishuBitableConnectionStatus,
  FeishuBitableField,
  FeishuBitableFieldMapping,
  FeishuBitableReadResult,
  FeishuBitableRecordResult,
  FeishuBitableTask
} from '../../../../shared/feishu-bitable-types'

export type FeishuBitableSlice = {
  feishuBitableStatus: FeishuBitableConnectionStatus
  feishuBitableStatusChecked: boolean
  feishuBitableStatusContextKey: string | null
  feishuBitableTasks: FeishuBitableTask[]
  feishuBitableNextPageToken: string | null
  feishuBitableLoading: boolean
  feishuBitableError: string | null
  feishuBitableConnectOpen: boolean
  selectedFeishuBitableTask: FeishuBitableTask | null

  setFeishuBitableConnectOpen: (open: boolean) => void
  setSelectedFeishuBitableTask: (task: FeishuBitableTask | null) => void
  checkFeishuBitableConnection: () => Promise<void>
  connectFeishuBitable: (args: {
    label?: string
    appId: string
    appSecret: string
    appToken: string
    tableId: string
    viewId?: string
    fieldMapping?: FeishuBitableFieldMapping
  }) => Promise<FeishuBitableConnectResult>
  disconnectFeishuBitable: (connectionId?: string | null) => Promise<void>
  selectFeishuBitableConnection: (connectionId: string | null) => Promise<void>
  fetchFeishuBitableRecords: (args?: {
    connectionId?: string | null
    pageToken?: string | null
    append?: boolean
  }) => Promise<FeishuBitableReadResult>
  fetchFeishuBitableRecord: (args: {
    connectionId?: string | null
    recordId: string
  }) => Promise<FeishuBitableRecordResult>
  fetchFeishuBitableFields: (
    connectionId?: string | null
  ) => Promise<{ ok: true; fields: FeishuBitableField[] } | { ok: false; error: string }>
  updateFeishuBitableFieldMapping: (args: {
    connectionId: string
    fieldMapping: FeishuBitableFieldMapping
  }) => Promise<{ ok: true } | { ok: false; error: string }>
}

type FeishuBitableStateCreator = StateCreator<AppState, [], [], FeishuBitableSlice>

export type FeishuBitableSliceSet = Parameters<FeishuBitableStateCreator>[0]
export type FeishuBitableSliceGet = Parameters<FeishuBitableStateCreator>[1]
