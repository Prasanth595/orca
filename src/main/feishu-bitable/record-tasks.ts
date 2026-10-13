import type { FeishuBitableRecordReference } from '../../shared/feishu-bitable-task-contract'
import type { FeishuBitableConnection, FeishuBitableTask } from '../../shared/feishu-bitable-types'
import type { RawFeishuBitableRecord } from './client'

const TITLE_FALLBACK_PREFIX = 'Feishu record'
const MAX_TEXT_LENGTH = 20_000

/**
 * Field values arrive as free-form Feishu shapes (string, segment arrays,
 * link objects, arrays of links). Every extractor treats them as untrusted
 * data: it flattens to plain text, drops control characters, and caps length.
 */
function fieldText(value: unknown): string {
  const parts = collectTextParts(value)
  const text = parts
    .join('')
    // eslint-disable-next-line no-control-regex -- untrusted field text must not carry C0/DEL bytes
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .trim()
  return text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text
}

function collectTextParts(value: unknown): string[] {
  if (value === null || value === undefined) {
    return []
  }
  if (typeof value === 'string') {
    return [value]
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)]
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectTextParts(entry))
  }
  if (typeof value === 'object') {
    const record: Record<string, unknown> = Object.fromEntries(Object.entries(value))
    if (typeof record.text === 'string') {
      return [record.text]
    }
    if (typeof record.link === 'string') {
      return [record.link]
    }
    if (typeof record.name === 'string') {
      return [record.name]
    }
    if (typeof record.value === 'string') {
      return [record.value]
    }
    return []
  }
  return []
}

function fieldUrl(value: unknown): string | null {
  const candidate = firstUrlPart(value)
  if (!candidate) {
    return null
  }
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null
    }
    url.username = ''
    url.password = ''
    return url.href
  } catch {
    return null
  }
}

function firstUrlPart(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstUrlPart(entry)
      if (found) {
        return found
      }
    }
    return null
  }
  if (value && typeof value === 'object') {
    const record: Record<string, unknown> = Object.fromEntries(Object.entries(value))
    if (typeof record.link === 'string' && record.link) {
      return record.link
    }
    if (typeof record.text === 'string' && /^https?:\/\//.test(record.text)) {
      return record.text
    }
  }
  return null
}

export function buildRecordUrl(
  reference: Pick<FeishuBitableRecordReference, 'appToken' | 'tableId' | 'recordId'>
): string {
  return `https://open.feishu.cn/base/${encodeURIComponent(reference.appToken)}?table=${encodeURIComponent(
    reference.tableId
  )}&record=${encodeURIComponent(reference.recordId)}`
}

export function mapRecordToTask(args: {
  connection: FeishuBitableConnection
  record: RawFeishuBitableRecord
}): FeishuBitableTask {
  const { connection, record } = args
  const mapping = connection.fieldMapping
  const reference: FeishuBitableRecordReference = {
    connectionId: connection.id,
    appToken: connection.appToken,
    tableId: connection.tableId,
    recordId: record.recordId
  }
  const title = mappedFieldText(record.fields, mapping.titleField)
  const description = mappedFieldText(record.fields, mapping.descriptionField)
  const acceptanceCriteria = mappedFieldText(record.fields, mapping.acceptanceCriteriaField)
  const mappedUrl = mapping.urlField ? fieldUrl(record.fields[mapping.urlField]) : null
  return {
    source: reference,
    record: reference,
    // Why: a missing title field must never fall back to the record id or row
    // number as identity; this display fallback is only for humans.
    title: title || `${TITLE_FALLBACK_PREFIX} ${record.recordId}`,
    description,
    ...(acceptanceCriteria ? { acceptanceCriteria } : {}),
    url: mappedUrl ?? buildRecordUrl(reference),
    connectionLabel: connection.label,
    updatedAt: record.lastModifiedTime ?? null
  }
}

function mappedFieldText(fields: Record<string, unknown>, fieldName: string | null): string {
  if (!fieldName) {
    return ''
  }
  return fieldText(fields[fieldName])
}

export function applyFieldMappingToRecords(args: {
  connection: FeishuBitableConnection
  records: readonly RawFeishuBitableRecord[]
}): FeishuBitableTask[] {
  return args.records.map((record) => mapRecordToTask({ connection: args.connection, record }))
}
