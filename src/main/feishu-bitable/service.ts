import { randomUUID } from 'node:crypto'
import {
  FeishuBitableApiError,
  FeishuBitableAuthError,
  listAllFields,
  listRecordsPage,
  getRecord as fetchRecord
} from './client'
import { applyFieldMappingToRecords, mapRecordToTask } from './record-tasks'
import {
  getConnection,
  getConnectionFile,
  getStatus,
  readSecret,
  removeConnection,
  selectConnection,
  updateFieldMapping as persistFieldMapping,
  upsertConnection
} from './connection-store'
import {
  FEISHU_BITABLE_RECORDS_PAGE_SIZE,
  type FeishuBitableConnectArgs,
  type FeishuBitableConnectResult,
  type FeishuBitableConnection,
  type FeishuBitableConnectionStatus,
  type FeishuBitableField,
  type FeishuBitableFieldMapping,
  type FeishuBitableFieldMappingUpdate,
  type FeishuBitableReadResult,
  type FeishuBitableRecordPage,
  type FeishuBitableRecordResult
} from '../../shared/feishu-bitable-types'

export async function connect(args: FeishuBitableConnectArgs): Promise<FeishuBitableConnectResult> {
  const label = args.label.trim() || 'Feishu Bitable'
  if (
    !args.appId.trim() ||
    !args.appSecret.trim() ||
    !args.appToken.trim() ||
    !args.tableId.trim()
  ) {
    return { ok: false, error: 'App ID, app secret, Bitable app token, and table ID are required.' }
  }
  const reference = { appToken: args.appToken.trim(), tableId: args.tableId.trim() }
  try {
    // Why: connect validates credentials AND table reachability before saving,
    // so a stored connection is always one the app can read.
    const fields = await listAllFields({
      appId: args.appId.trim(),
      appSecret: args.appSecret.trim(),
      reference
    })
    const fieldMapping = resolveInitialFieldMapping(args.fieldMapping, fields)
    const connection: FeishuBitableConnection = {
      id: randomUUID(),
      label,
      appId: args.appId.trim(),
      appToken: reference.appToken,
      tableId: reference.tableId,
      viewId: args.viewId?.trim() || null,
      fieldMapping,
      createdAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString()
    }
    upsertConnection(connection, args.appSecret.trim())
    return { ok: true, connection }
  } catch (error) {
    return { ok: false, error: readableError(error) }
  }
}

function resolveInitialFieldMapping(
  provided: FeishuBitableFieldMapping | undefined,
  fields: readonly FeishuBitableField[]
): FeishuBitableFieldMapping {
  if (provided) {
    return {
      titleField: provided.titleField,
      descriptionField: provided.descriptionField,
      acceptanceCriteriaField: provided.acceptanceCriteriaField,
      urlField: provided.urlField
    }
  }
  // Sensible default: the first text-ish column becomes the title.
  const firstTextField = fields.find((field) => field.uiType === 'text' || field.type === 1)
  return {
    titleField: firstTextField?.fieldName ?? null,
    descriptionField: null,
    acceptanceCriteriaField: null,
    urlField: null
  }
}

export function disconnect(connectionId?: string): void {
  if (connectionId?.trim()) {
    removeConnection(connectionId.trim())
    return
  }
  for (const connection of getConnectionFile().connections) {
    removeConnection(connection.id)
  }
}

export function status(): FeishuBitableConnectionStatus {
  return getStatus()
}

export function selectActive(connectionId: string | null): FeishuBitableConnectionStatus {
  return selectConnection(connectionId)
}

export async function listRecords(args: {
  connectionId?: string | null
  pageToken?: string | null
  pageSize?: number
  signal?: AbortSignal
}): Promise<FeishuBitableReadResult> {
  const connection = resolveConnection(args.connectionId)
  if (!connection) {
    return { ok: false, error: 'No Feishu Bitable connection is configured.' }
  }
  const secret = readSecret(connection.id)
  if (!secret) {
    return {
      ok: false,
      error: 'The saved Feishu Bitable app secret is missing. Reconnect the connection.'
    }
  }
  try {
    const page = await listRecordsPage({
      appId: connection.appId,
      appSecret: secret,
      reference: connection,
      pageToken: args.pageToken ?? null,
      pageSize: args.pageSize ?? FEISHU_BITABLE_RECORDS_PAGE_SIZE,
      signal: args.signal
    })
    const tasks = applyFieldMappingToRecords({ connection, records: page.records })
    const result: FeishuBitableRecordPage = {
      tasks,
      nextPageToken: page.nextPageToken,
      totalFetched: tasks.length
    }
    return { ok: true, page: result }
  } catch (error) {
    return { ok: false, error: readableError(error) }
  }
}

export async function getTask(args: {
  connectionId?: string | null
  recordId: string
  signal?: AbortSignal
}): Promise<FeishuBitableRecordResult> {
  const connection = resolveConnection(args.connectionId)
  if (!connection) {
    return { ok: false, error: 'No Feishu Bitable connection is configured.' }
  }
  if (!args.recordId.trim()) {
    return { ok: false, error: 'A record ID is required.' }
  }
  const secret = readSecret(connection.id)
  if (!secret) {
    return {
      ok: false,
      error: 'The saved Feishu Bitable app secret is missing. Reconnect the connection.'
    }
  }
  try {
    const record = await fetchRecord({
      appId: connection.appId,
      appSecret: secret,
      reference: {
        connectionId: connection.id,
        appToken: connection.appToken,
        tableId: connection.tableId,
        recordId: args.recordId.trim()
      },
      signal: args.signal
    })
    return { ok: true, task: record ? mapRecordToTask({ connection, record }) : null }
  } catch (error) {
    return { ok: false, error: readableError(error) }
  }
}

export async function listFields(args: {
  connectionId?: string | null
  signal?: AbortSignal
}): Promise<{ ok: true; fields: FeishuBitableField[] } | { ok: false; error: string }> {
  const connection = resolveConnection(args.connectionId)
  if (!connection) {
    return { ok: false, error: 'No Feishu Bitable connection is configured.' }
  }
  const secret = readSecret(connection.id)
  if (!secret) {
    return {
      ok: false,
      error: 'The saved Feishu Bitable app secret is missing. Reconnect the connection.'
    }
  }
  try {
    const fields = await listAllFields({
      appId: connection.appId,
      appSecret: secret,
      reference: connection,
      signal: args.signal
    })
    return { ok: true, fields }
  } catch (error) {
    return { ok: false, error: readableError(error) }
  }
}

export function updateMapping(
  update: FeishuBitableFieldMappingUpdate
): { ok: true; connection: FeishuBitableConnection } | { ok: false; error: string } {
  const updated = persistFieldMapping(update.connectionId, update.fieldMapping)
  if (!updated) {
    return { ok: false, error: 'Unknown Feishu Bitable connection.' }
  }
  return { ok: true, connection: updated }
}

function resolveConnection(connectionId?: string | null): FeishuBitableConnection | null {
  const file = getConnectionFile()
  if (connectionId?.trim()) {
    return getConnection(connectionId.trim())
  }
  return (
    file.connections.find((entry) => entry.id === file.activeConnectionId) ??
    file.connections[0] ??
    null
  )
}

function readableError(error: unknown): string {
  if (error instanceof FeishuBitableAuthError) {
    return error.message
  }
  if (error instanceof FeishuBitableApiError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return 'Feishu Bitable request failed.'
}
