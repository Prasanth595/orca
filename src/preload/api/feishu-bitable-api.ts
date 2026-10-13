import type {
  FeishuBitableConnectResult,
  FeishuBitableConnectionStatus,
  FeishuBitableFieldMapping,
  FeishuBitableReadResult,
  FeishuBitableRecordResult
} from '../../shared/feishu-bitable-types'

export type FeishuBitableApi = {
  connect: (args: {
    label?: string
    appId: string
    appSecret: string
    appToken: string
    tableId: string
    viewId?: string
    fieldMapping?: FeishuBitableFieldMapping
  }) => Promise<FeishuBitableConnectResult>
  disconnect: (args?: { connectionId?: string }) => Promise<{ ok: true }>
  status: () => Promise<FeishuBitableConnectionStatus>
  readStatus: () => Promise<FeishuBitableConnectionStatus>
  selectConnection: (args: {
    connectionId: string | null
  }) => Promise<FeishuBitableConnectionStatus>
  listRecords: (args?: {
    connectionId?: string
    pageToken?: string
    pageSize?: number
  }) => Promise<FeishuBitableReadResult>
  getRecord: (args: {
    connectionId?: string
    recordId: string
  }) => Promise<FeishuBitableRecordResult>
  listFields: (args?: {
    connectionId?: string
  }) => Promise<
    | { ok: true; fields: { fieldName: string; type: number; uiType?: string | null }[] }
    | { ok: false; error: string }
  >
  updateFieldMapping: (args: {
    connectionId: string
    fieldMapping: FeishuBitableFieldMapping
  }) => Promise<
    | { ok: true; connection: FeishuBitableConnectionStatus['connections'][number] }
    | { ok: false; error: string }
  >
}
