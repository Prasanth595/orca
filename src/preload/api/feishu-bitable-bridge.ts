import type {
  FeishuBitableCompleteArgs,
  FeishuBitableFieldMapping
} from '../../shared/feishu-bitable-types'
import type {
  FeishuBitableTableDiscoveryArgs,
  FeishuBitableTableDiscoveryResult
} from '../../shared/feishu-bitable-table-discovery'
import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const feishuBitableApi = {
  completeRecord: (args: FeishuBitableCompleteArgs) =>
    ipcRenderer.invoke('feishuBitable:completeRecord', args),
  discoverTables: (
    args: FeishuBitableTableDiscoveryArgs
  ): Promise<FeishuBitableTableDiscoveryResult> =>
    ipcRenderer.invoke('feishuBitable:discoverTables', args),
  connect: (args: {
    label?: string
    appId: string
    appSecret: string
    appToken: string
    tableId: string
    viewId?: string
    fieldMapping?: FeishuBitableFieldMapping
  }) => ipcRenderer.invoke('feishuBitable:connect', args),

  disconnect: (args?: { connectionId?: string }): Promise<{ ok: true }> =>
    ipcRenderer.invoke('feishuBitable:disconnect', args),

  status: () => ipcRenderer.invoke('feishuBitable:status'),

  readStatus: () => ipcRenderer.invoke('feishuBitable:readStatus'),

  selectConnection: (args: { connectionId: string | null }) =>
    ipcRenderer.invoke('feishuBitable:selectConnection', args),

  listRecords: (args?: { connectionId?: string; pageToken?: string; pageSize?: number }) =>
    ipcRenderer.invoke('feishuBitable:listRecords', args),

  getRecord: (args: { connectionId?: string; recordId: string }) =>
    ipcRenderer.invoke('feishuBitable:getRecord', args),

  listFields: (args?: { connectionId?: string }) =>
    ipcRenderer.invoke('feishuBitable:listFields', args),

  updateFieldMapping: (args: { connectionId: string; fieldMapping: FeishuBitableFieldMapping }) =>
    ipcRenderer.invoke('feishuBitable:updateFieldMapping', args)
} satisfies PreloadApi['feishuBitable']
