import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const feishuBitableApi = {
  connect: (args: {
    label?: string
    appId: string
    appSecret: string
    appToken: string
    tableId: string
    viewId?: string
    fieldMapping?: {
      titleField: string | null
      descriptionField: string | null
      acceptanceCriteriaField: string | null
      urlField: string | null
    }
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

  updateFieldMapping: (args: {
    connectionId: string
    fieldMapping: {
      titleField: string | null
      descriptionField: string | null
      acceptanceCriteriaField: string | null
      urlField: string | null
    }
  }) => ipcRenderer.invoke('feishuBitable:updateFieldMapping', args)
} satisfies PreloadApi['feishuBitable']
