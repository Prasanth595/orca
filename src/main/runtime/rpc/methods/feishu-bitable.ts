import { defineMethod } from '../core'
import {
  Connect,
  CompleteRecord,
  DiscoverTables,
  ConnectionSelection,
  GetRecord,
  ListFields,
  ListRecords,
  SelectConnection,
  UpdateFieldMapping
} from '../../../../shared/rpc-contract/feishu-bitable-params'
import {
  normalizeFeishuBitableFieldMapping,
  type FeishuBitableFieldMapping
} from '../../../../shared/feishu-bitable-types'

function toFieldMapping(value: unknown): FeishuBitableFieldMapping {
  return normalizeFeishuBitableFieldMapping(value)
}

export const FEISHU_BITABLE_METHODS = [
  defineMethod({
    name: 'feishuBitable.completeRecord',
    permission: 'workspace',
    params: CompleteRecord,
    handler: async (params, { runtime }) => runtime.feishuBitableCompleteRecord(params)
  }),
  defineMethod({
    name: 'feishuBitable.discoverTables',
    permission: 'accounts-admin',
    params: DiscoverTables,
    handler: async (params, { runtime }) => runtime.feishuBitableDiscoverTables(params)
  }),
  defineMethod({
    name: 'feishuBitable.connect',
    permission: 'accounts-admin',
    params: Connect,
    handler: async (params, { runtime }) =>
      runtime.feishuBitableConnect({
        label: params.label?.trim() || 'Feishu Bitable',
        appId: params.appId.trim(),
        appSecret: params.appSecret.trim(),
        appToken: params.appToken.trim(),
        tableId: params.tableId.trim(),
        viewId: params.viewId?.trim() || undefined,
        fieldMapping: params.fieldMapping ? toFieldMapping(params.fieldMapping) : undefined
      })
  }),
  defineMethod({
    name: 'feishuBitable.disconnect',
    permission: 'accounts-admin',
    params: ConnectionSelection,
    handler: async (params, { runtime }) => runtime.feishuBitableDisconnect(params?.connectionId)
  }),
  defineMethod({
    name: 'feishuBitable.status',
    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime }) => runtime.feishuBitableStatus()
  }),
  defineMethod({
    name: 'feishuBitable.readStatus',
    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime }) => runtime.feishuBitableReadStatus()
  }),
  defineMethod({
    name: 'feishuBitable.selectConnection',
    permission: 'accounts-admin',
    params: SelectConnection,
    handler: async (params, { runtime }) =>
      runtime.feishuBitableSelectConnection(params.connectionId?.trim() || null)
  }),
  defineMethod({
    name: 'feishuBitable.listRecords',
    permission: 'workspace',
    params: ListRecords,
    handler: async (params, { runtime }) =>
      runtime.feishuBitableListRecords(params?.connectionId, params?.pageToken, params?.pageSize)
  }),
  defineMethod({
    name: 'feishuBitable.getRecord',
    permission: 'workspace',
    params: GetRecord,
    handler: async (params, { runtime }) =>
      runtime.feishuBitableGetRecord(params.connectionId, params.recordId.trim())
  }),
  defineMethod({
    name: 'feishuBitable.listFields',
    permission: 'workspace',
    params: ListFields,
    handler: async (params, { runtime }) => runtime.feishuBitableListFields(params?.connectionId)
  }),
  defineMethod({
    name: 'feishuBitable.updateFieldMapping',
    permission: 'accounts-admin',
    params: UpdateFieldMapping,
    handler: async (params, { runtime }) =>
      runtime.feishuBitableUpdateFieldMapping({
        connectionId: params.connectionId.trim(),
        fieldMapping: toFieldMapping(params.fieldMapping)
      })
  })
]
