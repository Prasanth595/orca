import { FeishuBitableApiError, feishuRequest, getRecord, listAllFields } from './client'
import { getConnection, readSecret } from './connection-store'
import { mapRecordToTask } from './record-tasks'
import type {
  FeishuBitableCompleteArgs,
  FeishuBitableCompleteResult
} from '../../shared/feishu-bitable-types'

/** Only explicit completion reaches this host-owned write path; agent activity is not an input. */
export async function completeRecord({
  record: reference
}: FeishuBitableCompleteArgs): Promise<FeishuBitableCompleteResult> {
  const connection = getConnection(reference.connectionId)
  if (
    !connection ||
    connection.appToken !== reference.appToken ||
    connection.tableId !== reference.tableId ||
    !reference.recordId.trim()
  ) {
    return { ok: false, error: 'The record does not belong to this connection.' }
  }
  const { statusField, completedValue } = connection.fieldMapping
  if (!statusField || !completedValue) {
    return {
      ok: false,
      error: 'Configure a status field and completion value in Settings → Tasks.'
    }
  }
  try {
    const appSecret = readSecret(connection.id)
    if (!appSecret) {
      return {
        ok: false,
        error: 'The saved Feishu Bitable app secret is missing. Reconnect the connection.'
      }
    }
    const auth = { appId: connection.appId, appSecret }
    const fields = await listAllFields({ ...auth, reference })
    const field = fields.find((entry) => entry.fieldName === statusField)
    if (!field) {
      return { ok: false, error: 'The mapped status field no longer exists. Update the mapping.' }
    }
    if (field.type !== 1 && field.type !== 3) {
      return { ok: false, error: 'Completion requires a text or single-select status field.' }
    }
    if (field.type === 3 && !field.options?.includes(completedValue)) {
      return {
        ok: false,
        error: 'The completion value is not an existing status option. Update the mapping.'
      }
    }
    const original = await getRecord({ ...auth, reference })
    if (!original || original.recordId !== reference.recordId) {
      return { ok: false, error: 'The Feishu record no longer exists.' }
    }
    const data = await feishuRequest<{
      record?: { record_id?: unknown; fields?: Record<string, unknown> }
    }>(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(reference.appToken)}/tables/${encodeURIComponent(reference.tableId)}/records/${encodeURIComponent(reference.recordId)}`,
      { method: 'PUT', auth, json: { fields: { [statusField]: completedValue } } }
    )
    if (
      data.record?.record_id !== reference.recordId ||
      !data.record.fields ||
      data.record.fields[statusField] !== completedValue
    ) {
      return {
        ok: false,
        error: 'Could not verify the saved status. Refresh the record before retrying.'
      }
    }
    return {
      ok: true,
      task: mapRecordToTask({
        connection,
        record: {
          ...original,
          fields: { ...original.fields, ...data.record.fields }
        }
      })
    }
  } catch (error) {
    if (
      error instanceof FeishuBitableApiError &&
      (error.httpStatus === 403 || [1254302, 1254304, 99991672].includes(error.code))
    ) {
      return {
        ok: false,
        error:
          'The app needs record write permission and access to this status field. Reading remains available.'
      }
    }
    return {
      ok: false,
      error:
        'Could not update the Feishu status. Refresh the record and check app access before retrying.'
    }
  }
}
