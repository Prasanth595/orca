import type {
  FeishuBitableTableDiscoveryArgs,
  FeishuBitableTableDiscoveryResult
} from '../../shared/feishu-bitable-table-discovery'
import type {
  FeishuBitableConnectResult,
  FeishuBitableCompleteArgs,
  FeishuBitableCompleteResult,
  FeishuBitableField,
  FeishuBitableConnectionStatus,
  FeishuBitableFieldMapping,
  FeishuBitableReadResult,
  FeishuBitableRecordResult
} from '../../shared/feishu-bitable-types'

export type FeishuBitableApi = {
  completeRecord: (args: FeishuBitableCompleteArgs) => Promise<FeishuBitableCompleteResult>
  discoverTables: (
    args: FeishuBitableTableDiscoveryArgs
  ) => Promise<FeishuBitableTableDiscoveryResult>
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
  }) => Promise<{ ok: true; fields: FeishuBitableField[] } | { ok: false; error: string }>
  updateFieldMapping: (args: {
    connectionId: string
    fieldMapping: FeishuBitableFieldMapping
  }) => Promise<
    | { ok: true; connection: FeishuBitableConnectionStatus['connections'][number] }
    | { ok: false; error: string }
  >
}
