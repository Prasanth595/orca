import type {
  FeishuBitableRecordReference,
  FeishuBitableTaskSnapshot
} from './feishu-bitable-task-contract'
import type { SecretAtRestProtection } from './secret-at-rest-protection'

/** One enterprise self-built app connection to a single Bitable table. */
export type FeishuBitableConnection = {
  id: string
  label: string
  appId: string
  appToken: string
  tableId: string
  viewId?: string | null
  fieldMapping: FeishuBitableFieldMapping
  createdAt: string
  lastValidatedAt?: string | null
}

/**
 * Which Bitable field names feed which task slot. Field names are the
 * user-visible column names, not field ids, so renaming a column in Feishu
 * surfaces as an empty slot instead of silently rebinding.
 */
export type FeishuBitableFieldMapping = {
  titleField: string | null
  descriptionField: string | null
  acceptanceCriteriaField: string | null
  urlField: string | null
}

export type FeishuBitableField = {
  fieldName: string
  type: number
  uiType?: string | null
}

export type FeishuBitableConnectionSummary = {
  id: string
  label: string
  appId: string
  appToken: string
  tableId: string
  viewId?: string | null
  fieldMapping: FeishuBitableFieldMapping
  createdAt: string
  lastValidatedAt?: string | null
}

export type FeishuBitableConnectionStatus = {
  connected: boolean
  connections: FeishuBitableConnectionSummary[]
  activeConnectionId: string | null
  // Set when a stored secret exists but could not be decrypted, so the UI can
  // explain reads failing while the connection still looks saved.
  credentialError?: string
  // 'plaintext' when any stored secret is unsealed, so Settings can warn.
  // Absent must read as "unknown", not "sealed" (older remote host).
  credentialProtection?: SecretAtRestProtection | null
}

export type FeishuBitableRecordPage = {
  tasks: FeishuBitableTask[]
  nextPageToken: string | null
  totalFetched: number
}

/** A Bitable record converted through the connection's field mapping. */
export type FeishuBitableTask = FeishuBitableTaskSnapshot & {
  record: FeishuBitableRecordReference
  connectionLabel: string
  updatedAt?: string | null
}

export type FeishuBitableConnectArgs = {
  label: string
  appId: string
  appSecret: string
  appToken: string
  tableId: string
  viewId?: string
  fieldMapping?: FeishuBitableFieldMapping
}

export type FeishuBitableFieldMappingUpdate = {
  connectionId: string
  fieldMapping: FeishuBitableFieldMapping
}

export type FeishuBitableConnectResult =
  | { ok: true; connection: FeishuBitableConnectionSummary }
  | { ok: false; error: string }

export type FeishuBitableReadResult =
  | { ok: true; page: FeishuBitableRecordPage }
  | { ok: false; error: string }

export type FeishuBitableRecordResult =
  | { ok: true; task: FeishuBitableTask | null }
  | { ok: false; error: string }

export const FEISHU_BITABLE_RECORDS_PAGE_SIZE = 50
export const FEISHU_BITABLE_MAX_PAGE_SIZE = 200

/** Stable identity key for a record: the full connection/app/table/record tuple. */
export function feishuBitableRecordKey(reference: FeishuBitableRecordReference): string {
  return JSON.stringify([
    reference.connectionId,
    reference.appToken,
    reference.tableId,
    reference.recordId
  ])
}

export function isSameFeishuBitableRecord(
  a: FeishuBitableRecordReference | null | undefined,
  b: FeishuBitableRecordReference | null | undefined
): boolean {
  if (!a || !b) {
    return !a && !b
  }
  return feishuBitableRecordKey(a) === feishuBitableRecordKey(b)
}

export function normalizeFeishuBitableRecordReference(
  value: unknown
): FeishuBitableRecordReference | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw: Record<string, unknown> = Object.fromEntries(Object.entries(value))
  const connectionId = nonEmpty(raw.connectionId)
  const appToken = nonEmpty(raw.appToken)
  const tableId = nonEmpty(raw.tableId)
  const recordId = nonEmpty(raw.recordId)
  if (!connectionId || !appToken || !tableId || !recordId) {
    return null
  }
  return { connectionId, appToken, tableId, recordId }
}

export function normalizeFeishuBitableFieldMapping(value: unknown): FeishuBitableFieldMapping {
  const raw: Record<string, unknown> =
    value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)) : {}
  return {
    titleField: nonEmpty(raw.titleField),
    descriptionField: nonEmpty(raw.descriptionField),
    acceptanceCriteriaField: nonEmpty(raw.acceptanceCriteriaField),
    urlField: nonEmpty(raw.urlField)
  }
}

export function normalizeFeishuBitableConnectionSummary(
  value: unknown
): FeishuBitableConnectionSummary | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw: Record<string, unknown> = Object.fromEntries(Object.entries(value))
  const id = nonEmpty(raw.id)
  const appId = nonEmpty(raw.appId)
  const appToken = nonEmpty(raw.appToken)
  const tableId = nonEmpty(raw.tableId)
  if (!id || !appId || !appToken || !tableId) {
    return null
  }
  const label = nonEmpty(raw.label) ?? 'Feishu Bitable'
  return {
    id,
    label,
    appId,
    appToken,
    tableId,
    viewId: nonEmpty(raw.viewId),
    fieldMapping: normalizeFeishuBitableFieldMapping(raw.fieldMapping),
    createdAt:
      typeof raw.createdAt === 'string' && raw.createdAt
        ? raw.createdAt
        : new Date(0).toISOString(),
    lastValidatedAt: nonEmpty(raw.lastValidatedAt)
  }
}

export function parseFeishuBitableConnectionStatus(value: unknown): FeishuBitableConnectionStatus {
  const raw: Record<string, unknown> =
    value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)) : {}
  const connections = Array.isArray(raw.connections)
    ? raw.connections
        .map((entry) => normalizeFeishuBitableConnectionSummary(entry))
        .filter((entry): entry is FeishuBitableConnectionSummary => entry !== null)
    : []
  const activeConnectionId = nonEmpty(raw.activeConnectionId)
  const credentialProtection = normalizeCredentialProtection(raw.credentialProtection)
  return {
    connected: raw.connected === true && connections.length > 0,
    connections,
    activeConnectionId:
      activeConnectionId && connections.some((entry) => entry.id === activeConnectionId)
        ? activeConnectionId
        : (connections[0]?.id ?? null),
    ...(typeof raw.credentialError === 'string' && raw.credentialError
      ? { credentialError: raw.credentialError }
      : {}),
    ...(credentialProtection !== undefined ? { credentialProtection } : {})
  }
}

function isSecretAtRestProtection(value: unknown): value is SecretAtRestProtection {
  return value === 'sealed' || value === 'plaintext'
}

/** Undefined means "not reported" (older remote host); null means "reported absent". */
function normalizeCredentialProtection(value: unknown): SecretAtRestProtection | null | undefined {
  if (value === null || isSecretAtRestProtection(value)) {
    return value
  }
  return undefined
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
