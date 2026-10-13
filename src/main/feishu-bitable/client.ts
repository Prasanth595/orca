import { randomUUID } from 'node:crypto'
import { getMainHttpClient } from '../network/http-client'
import type { FeishuBitableRecordReference } from '../../shared/feishu-bitable-task-contract'
import type { FeishuBitableField } from '../../shared/feishu-bitable-types'

const FEISHU_OPEN_BASE_URL = 'https://open.feishu.cn'
const TOKEN_EXPIRY_MARGIN_MS = 60_000
const MAX_PAGES_PER_READ = 100

export class FeishuBitableApiError extends Error {
  readonly code: number
  readonly httpStatus: number

  constructor(message: string, code: number, httpStatus: number) {
    super(message)
    this.name = 'FeishuBitableApiError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

export class FeishuBitableAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeishuBitableAuthError'
  }
}

type TenantTokenEntry = {
  token: string
  expiresAt: number
}

// Why: app secrets rotate independently of app ids, so the cache key is the
// pair; a secret rotation just starts a fresh entry.
const tenantTokenCache = new Map<string, TenantTokenEntry>()

export async function fetchTenantAccessToken(
  appId: string,
  appSecret: string,
  signal?: AbortSignal
): Promise<string> {
  const cacheKey = `${appId}::${appSecret}`
  const cached = tenantTokenCache.get(cacheKey)
  if (cached && cached.expiresAt - TOKEN_EXPIRY_MARGIN_MS > Date.now()) {
    return cached.token
  }
  const body = await feishuRequest<{ tenant_access_token: string; expire: number }>(
    '/open-apis/auth/v3/tenant_access_token/internal',
    { method: 'POST', json: { app_id: appId, app_secret: appSecret }, auth: null, signal }
  )
  if (!body.tenant_access_token || typeof body.expire !== 'number') {
    throw new FeishuBitableAuthError('Feishu did not return a tenant access token.')
  }
  tenantTokenCache.set(cacheKey, {
    token: body.tenant_access_token,
    expiresAt: Date.now() + body.expire * 1000
  })
  return body.tenant_access_token
}

/** Test-only: drop cached tenant tokens between isolated HTTP fixture runs. */
export function resetTenantTokenCacheForTest(): void {
  tenantTokenCache.clear()
}

export type RawFeishuBitableRecord = {
  recordId: string
  fields: Record<string, unknown>
  lastModifiedTime?: string | null
}

export type RawRecordPage = {
  records: RawFeishuBitableRecord[]
  nextPageToken: string | null
}

export type ListRecordsArgs = {
  appId: string
  appSecret: string
  reference: Pick<FeishuBitableRecordReference, 'appToken' | 'tableId'>
  pageToken?: string | null
  pageSize?: number
  signal?: AbortSignal
}

export async function listRecordsPage({
  appId,
  appSecret,
  reference,
  pageToken,
  pageSize,
  signal
}: ListRecordsArgs): Promise<RawRecordPage> {
  const params = new URLSearchParams({
    page_size: String(Math.min(Math.max(pageSize ?? 50, 1), 500)),
    user_id_type: 'open_id'
  })
  if (pageToken) {
    params.set('page_token', pageToken)
  }
  const data = await feishuRequest<{
    items?:
      | { record_id?: string; fields?: Record<string, unknown>; last_modified_time?: string }[]
      | null
    has_more?: boolean
    page_token?: string
  }>(
    `/open-apis/bitable/v1/apps/${encodeURIComponent(reference.appToken)}/tables/${encodeURIComponent(
      reference.tableId
    )}/records?${params.toString()}`,
    { method: 'GET', auth: { appId, appSecret }, signal }
  )
  const records = (data.items ?? [])
    .map((item): RawFeishuBitableRecord | null => {
      if (typeof item.record_id !== 'string' || !item.record_id) {
        return null
      }
      return {
        recordId: item.record_id,
        fields:
          item.fields && typeof item.fields === 'object' && !Array.isArray(item.fields)
            ? item.fields
            : {},
        lastModifiedTime:
          typeof item.last_modified_time === 'string' ? item.last_modified_time : null
      }
    })
    .filter((record): record is RawFeishuBitableRecord => record !== null)
  return {
    records,
    nextPageToken: data.has_more && data.page_token ? data.page_token : null
  }
}

export async function getRecord(args: {
  appId: string
  appSecret: string
  reference: FeishuBitableRecordReference
  signal?: AbortSignal
}): Promise<RawFeishuBitableRecord | null> {
  const data = await feishuRequest<{
    record?: {
      record_id?: string
      fields?: Record<string, unknown>
      last_modified_time?: string
    } | null
  }>(
    `/open-apis/bitable/v1/apps/${encodeURIComponent(args.reference.appToken)}/tables/${encodeURIComponent(
      args.reference.tableId
    )}/records/${encodeURIComponent(args.reference.recordId)}?user_id_type=open_id`,
    { method: 'GET', auth: { appId: args.appId, appSecret: args.appSecret }, signal: args.signal }
  )
  const record = data.record
  if (!record || typeof record.record_id !== 'string' || !record.record_id) {
    return null
  }
  return {
    recordId: record.record_id,
    fields:
      record.fields && typeof record.fields === 'object' && !Array.isArray(record.fields)
        ? record.fields
        : {},
    lastModifiedTime:
      typeof record.last_modified_time === 'string' ? record.last_modified_time : null
  }
}

export async function listFieldsPage(args: {
  appId: string
  appSecret: string
  reference: Pick<FeishuBitableRecordReference, 'appToken' | 'tableId'>
  pageToken?: string | null
  signal?: AbortSignal
}): Promise<{ fields: FeishuBitableField[]; nextPageToken: string | null }> {
  const params = new URLSearchParams({ page_size: '100' })
  if (args.pageToken) {
    params.set('page_token', args.pageToken)
  }
  const data = await feishuRequest<{
    items?: { field_name?: string; type?: number; ui_type?: string }[] | null
    has_more?: boolean
    page_token?: string
  }>(
    `/open-apis/bitable/v1/apps/${encodeURIComponent(args.reference.appToken)}/tables/${encodeURIComponent(
      args.reference.tableId
    )}/fields?${params.toString()}`,
    { method: 'GET', auth: { appId: args.appId, appSecret: args.appSecret }, signal: args.signal }
  )
  const fields = (data.items ?? [])
    .map((item): FeishuBitableField | null => {
      if (typeof item.field_name !== 'string' || !item.field_name) {
        return null
      }
      return {
        fieldName: item.field_name,
        type: typeof item.type === 'number' ? item.type : 0,
        uiType: typeof item.ui_type === 'string' ? item.ui_type : null
      }
    })
    .filter((field): field is FeishuBitableField => field !== null)
  return {
    fields,
    nextPageToken: data.has_more && data.page_token ? data.page_token : null
  }
}

/** Walks every fields page so mapping editors see the full column set. */
export async function listAllFields(args: {
  appId: string
  appSecret: string
  reference: Pick<FeishuBitableRecordReference, 'appToken' | 'tableId'>
  signal?: AbortSignal
}): Promise<FeishuBitableField[]> {
  const fields: FeishuBitableField[] = []
  let pageToken: string | null = null
  for (let page = 0; page < MAX_PAGES_PER_READ; page += 1) {
    const result = await listFieldsPage({ ...args, pageToken })
    fields.push(...result.fields)
    pageToken = result.nextPageToken
    if (!pageToken) {
      return fields
    }
  }
  return fields
}

type FeishuRequestOptions = {
  method: 'GET' | 'POST'
  json?: unknown
  auth: { appId: string; appSecret: string } | null
  signal?: AbortSignal
}

async function feishuRequest<T extends object>(
  path: string,
  options: FeishuRequestOptions,
  retriedAuth = false
): Promise<T> {
  const token = options.auth
    ? await fetchTenantAccessToken(options.auth.appId, options.auth.appSecret, options.signal)
    : null
  const requestId = randomUUID()
  const response = await getMainHttpClient().fetch(`${FEISHU_OPEN_BASE_URL}${path}`, {
    method: options.method,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Request-Id': requestId,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
    signal: options.signal
  })
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    throw new FeishuBitableApiError(
      `Feishu returned a non-JSON response (HTTP ${response.status}).`,
      -1,
      response.status
    )
  }
  const envelope: Record<string, unknown> =
    parsed && typeof parsed === 'object' ? Object.fromEntries(Object.entries(parsed)) : {}
  const code = typeof envelope.code === 'number' ? envelope.code : 0
  const message =
    typeof envelope.msg === 'string' && envelope.msg ? envelope.msg : `HTTP ${response.status}`
  // Feishu envelopes: code 0 = success on the data path; the token endpoint
  // also uses code/msg and returns its payload at the top level.
  if (!response.ok || code !== 0) {
    // An expired tenant token surfaces as 99991663/99991661/99991668 — retry once
    // with a fresh token before giving up, mirroring tenant-token expiry handling.
    if (
      !retriedAuth &&
      token &&
      options.auth &&
      (code === 99991663 || code === 99991661 || code === 99991668) &&
      !options.signal?.aborted
    ) {
      tenantTokenCache.delete(`${options.auth.appId}::${options.auth.appSecret}`)
      return feishuRequest<T>(path, options, true)
    }
    throw new FeishuBitableApiError(`Feishu API error: ${message}`, code, response.status)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: trusted Feishu envelope boundary; every field of T is re-validated by the caller with typeof checks before use.
  return (envelope.data ?? envelope) as T
}
