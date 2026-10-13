import { ipcMain } from 'electron'
import type {
  FeishuBitableConnectArgs,
  FeishuBitableFieldMapping,
  FeishuBitableFieldMappingUpdate
} from '../../shared/feishu-bitable-types'
import {
  connect,
  disconnect,
  getTask,
  listFields,
  listRecords,
  selectActive,
  status,
  updateMapping
} from '../feishu-bitable/service'

function normalizeConnectionId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeFieldMapping(value: unknown): FeishuBitableFieldMapping | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const raw: Record<string, unknown> = Object.fromEntries(Object.entries(value))
  const mapping: FeishuBitableFieldMapping = {
    titleField: normalizeOptionalFieldName(raw.titleField),
    descriptionField: normalizeOptionalFieldName(raw.descriptionField),
    acceptanceCriteriaField: normalizeOptionalFieldName(raw.acceptanceCriteriaField),
    urlField: normalizeOptionalFieldName(raw.urlField)
  }
  return mapping
}

function normalizeOptionalFieldName(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Narrows untrusted connect payloads to the fields the host accepts. */
function normalizeConnectArgs(value: unknown): FeishuBitableConnectArgs | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw: Record<string, unknown> = Object.fromEntries(Object.entries(value))
  if (
    typeof raw.appId !== 'string' ||
    typeof raw.appSecret !== 'string' ||
    typeof raw.appToken !== 'string' ||
    typeof raw.tableId !== 'string'
  ) {
    return null
  }
  return {
    label: typeof raw.label === 'string' ? raw.label : 'Feishu Bitable',
    appId: raw.appId,
    appSecret: raw.appSecret,
    appToken: raw.appToken,
    tableId: raw.tableId,
    viewId: typeof raw.viewId === 'string' && raw.viewId.trim() ? raw.viewId : undefined,
    fieldMapping: normalizeFieldMapping(raw.fieldMapping)
  }
}

function normalizeMappingUpdate(value: unknown): FeishuBitableFieldMappingUpdate | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw: Record<string, unknown> = Object.fromEntries(Object.entries(value))
  const connectionId = normalizeConnectionId(raw.connectionId)
  const fieldMapping = normalizeFieldMapping(raw.fieldMapping)
  if (!connectionId || !fieldMapping) {
    return null
  }
  return { connectionId, fieldMapping }
}

/** Registers every `feishuBitable:*` IPC handler on the main process. */
export function registerFeishuBitableHandlers(): void {
  ipcMain.handle('feishuBitable:connect', async (_event, args: unknown) => {
    const normalized = normalizeConnectArgs(args)
    if (!normalized) {
      return {
        ok: false as const,
        error: 'App ID, app secret, app token, and table ID are required.'
      }
    }
    return connect(normalized)
  })

  ipcMain.handle('feishuBitable:disconnect', async (_event, args?: { connectionId?: string }) => {
    disconnect(normalizeConnectionId(args?.connectionId))
    return { ok: true as const }
  })

  ipcMain.handle('feishuBitable:status', async () => status())

  ipcMain.handle('feishuBitable:readStatus', async () => status())

  ipcMain.handle(
    'feishuBitable:selectConnection',
    async (_event, args: { connectionId: string | null }) => {
      if (args && typeof args === 'object' && 'connectionId' in args) {
        return selectActive(typeof args.connectionId === 'string' ? args.connectionId : null)
      }
      return status()
    }
  )

  ipcMain.handle(
    'feishuBitable:listRecords',
    async (
      _event,
      args?: { connectionId?: string; pageToken?: string; pageSize?: number; requestId?: string }
    ) => {
      if (!args || typeof args !== 'object') {
        return listRecords({})
      }
      const pageSize =
        typeof args.pageSize === 'number' && Number.isFinite(args.pageSize)
          ? Math.min(Math.max(Math.trunc(args.pageSize), 1), 200)
          : undefined
      return listRecords({
        connectionId: normalizeConnectionId(args.connectionId) ?? null,
        pageToken: typeof args.pageToken === 'string' && args.pageToken ? args.pageToken : null,
        pageSize
      })
    }
  )

  ipcMain.handle(
    'feishuBitable:getRecord',
    async (_event, args: { connectionId?: string; recordId: string }) => {
      const recordId = typeof args?.recordId === 'string' ? args.recordId : ''
      if (!recordId.trim()) {
        return { ok: false as const, error: 'A record ID is required.' }
      }
      return getTask({
        connectionId: normalizeConnectionId(args?.connectionId) ?? null,
        recordId
      })
    }
  )

  ipcMain.handle('feishuBitable:listFields', async (_event, args?: { connectionId?: string }) =>
    listFields({ connectionId: normalizeConnectionId(args?.connectionId) ?? null })
  )

  ipcMain.handle('feishuBitable:updateFieldMapping', async (_event, args: unknown) => {
    const normalized = normalizeMappingUpdate(args)
    if (!normalized) {
      return { ok: false as const, error: 'A connection ID and field mapping are required.' }
    }
    return updateMapping(normalized)
  })
}
