import type {
  FeishuBitableConnectArgs,
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

export class RuntimeFeishuBitableCommands {
  feishuBitableConnect(args: FeishuBitableConnectArgs): ReturnType<typeof connect> {
    return connect(args)
  }

  feishuBitableDisconnect(connectionId?: string): { ok: true } {
    disconnect(connectionId)
    return { ok: true }
  }

  feishuBitableStatus(): ReturnType<typeof status> {
    return status()
  }

  feishuBitableReadStatus(): ReturnType<typeof status> {
    return status()
  }

  feishuBitableSelectConnection(connectionId: string | null): ReturnType<typeof selectActive> {
    return selectActive(connectionId)
  }

  feishuBitableListRecords(
    connectionId?: string | null,
    pageToken?: string | null,
    pageSize?: number
  ): ReturnType<typeof listRecords> {
    return listRecords({ connectionId, pageToken, pageSize })
  }

  feishuBitableGetRecord(
    connectionId: string | null | undefined,
    recordId: string
  ): ReturnType<typeof getTask> {
    return getTask({ connectionId, recordId })
  }

  feishuBitableListFields(connectionId?: string | null): ReturnType<typeof listFields> {
    return listFields({ connectionId })
  }

  feishuBitableUpdateFieldMapping(
    update: FeishuBitableFieldMappingUpdate
  ): ReturnType<typeof updateMapping> {
    return updateMapping(update)
  }
}
