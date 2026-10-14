import {
  HTTP_REQUEST_METHODS,
  type HttpFormDataParam,
  type HttpKeyValue,
  type HttpPaginationOptions,
  type HttpPaginationParam,
  type HttpRequestAuth,
  type HttpRequestData,
  type HttpRequestOptions
} from './workflow-http-request-types'

export function defaultHttpRequestData(): HttpRequestData {
  return {
    method: 'GET',
    url: '',
    auth: { type: 'none', username: '', password: '', token: '', name: '', value: '' },
    sendQuery: false,
    queryMode: 'fields',
    queryParameters: [],
    queryJson: '',
    sendHeaders: false,
    headerMode: 'fields',
    headers: [],
    headersJson: '',
    sendBody: false,
    bodyContentType: 'json',
    bodyMode: 'fields',
    bodyParameters: [],
    bodyJson: '',
    rawContentType: 'text/plain',
    rawBody: '',
    binaryFilePath: '',
    options: {
      timeoutMs: 30_000,
      followRedirects: true,
      maxRedirects: 21,
      ignoreSsl: false,
      proxy: '',
      lowercaseHeaders: true,
      arrayFormat: 'brackets',
      responseFormat: 'autodetect',
      outputField: 'data',
      responseFilePath: '',
      includeResponseMeta: false,
      neverError: false,
      pagination: {
        mode: 'off',
        parameters: [],
        nextUrl: '',
        completeWhen: 'emptyResponse',
        completeStatusCodes: '',
        completeExpression: '',
        maxPages: 100,
        intervalMs: 0
      }
    }
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : fallback
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((a) => a === v) ?? fallback
}

function keyValues(v: unknown): HttpKeyValue[] {
  return Array.isArray(v)
    ? v.filter(isRecord).map((p) => ({ name: str(p.name, ''), value: str(p.value, '') }))
    : []
}

function formParams(v: unknown): HttpFormDataParam[] {
  return Array.isArray(v)
    ? v.filter(isRecord).map((p) => ({
        name: str(p.name, ''),
        value: str(p.value, ''),
        kind: oneOf(p.kind, ['text', 'file'] as const, 'text')
      }))
    : []
}

function paginationParams(v: unknown): HttpPaginationParam[] {
  return Array.isArray(v)
    ? v.filter(isRecord).map((p) => ({
        name: str(p.name, ''),
        value: str(p.value, ''),
        location: oneOf(p.location, ['query', 'body', 'headers'] as const, 'query')
      }))
    : []
}

function normalizeAuth(v: unknown, d: HttpRequestAuth): HttpRequestAuth {
  const a = isRecord(v) ? v : {}
  return {
    type: oneOf(a.type, ['none', 'basic', 'digest', 'bearer', 'header', 'query'] as const, d.type),
    username: str(a.username, d.username),
    password: str(a.password, d.password),
    token: str(a.token, d.token),
    name: str(a.name, d.name),
    value: str(a.value, d.value)
  }
}

function normalizePagination(v: unknown, d: HttpPaginationOptions): HttpPaginationOptions {
  const p = isRecord(v) ? v : {}
  return {
    mode: oneOf(p.mode, ['off', 'updateParameter', 'nextUrl'] as const, d.mode),
    parameters: paginationParams(p.parameters),
    nextUrl: str(p.nextUrl, d.nextUrl),
    completeWhen: oneOf(
      p.completeWhen,
      ['emptyResponse', 'statusCodes', 'expression'] as const,
      d.completeWhen
    ),
    completeStatusCodes: str(p.completeStatusCodes, d.completeStatusCodes),
    completeExpression: str(p.completeExpression, d.completeExpression),
    maxPages: num(p.maxPages, d.maxPages),
    intervalMs: num(p.intervalMs, d.intervalMs)
  }
}

function normalizeOptions(v: unknown, d: HttpRequestOptions): HttpRequestOptions {
  const o = isRecord(v) ? v : {}
  return {
    timeoutMs: num(o.timeoutMs, d.timeoutMs),
    followRedirects: bool(o.followRedirects, d.followRedirects),
    maxRedirects: num(o.maxRedirects, d.maxRedirects),
    ignoreSsl: bool(o.ignoreSsl, d.ignoreSsl),
    proxy: str(o.proxy, d.proxy),
    lowercaseHeaders: bool(o.lowercaseHeaders, d.lowercaseHeaders),
    arrayFormat: oneOf(
      o.arrayFormat,
      ['noBrackets', 'brackets', 'indices'] as const,
      d.arrayFormat
    ),
    responseFormat: oneOf(
      o.responseFormat,
      ['autodetect', 'json', 'text', 'file'] as const,
      d.responseFormat
    ),
    outputField: str(o.outputField, d.outputField) || d.outputField,
    responseFilePath: str(o.responseFilePath, d.responseFilePath),
    includeResponseMeta: bool(o.includeResponseMeta, d.includeResponseMeta),
    neverError: bool(o.neverError, d.neverError),
    pagination: normalizePagination(o.pagination, d.pagination)
  }
}

/** Fills missing or malformed fields (e.g. from an imported workflow) with defaults. */
export function normalizeHttpRequestData(raw: unknown): HttpRequestData {
  const d = defaultHttpRequestData()
  const r = isRecord(raw) ? raw : {}
  const method = typeof r.method === 'string' ? r.method.toUpperCase() : d.method
  return {
    method: oneOf(method, HTTP_REQUEST_METHODS, d.method),
    url: str(r.url, d.url),
    auth: normalizeAuth(r.auth, d.auth),
    sendQuery: bool(r.sendQuery, d.sendQuery),
    queryMode: oneOf(r.queryMode, ['fields', 'json'] as const, d.queryMode),
    queryParameters: keyValues(r.queryParameters),
    queryJson: str(r.queryJson, d.queryJson),
    sendHeaders: bool(r.sendHeaders, d.sendHeaders),
    headerMode: oneOf(r.headerMode, ['fields', 'json'] as const, d.headerMode),
    headers: keyValues(r.headers),
    headersJson: str(r.headersJson, d.headersJson),
    sendBody: bool(r.sendBody, d.sendBody),
    bodyContentType: oneOf(
      r.bodyContentType,
      ['json', 'form_urlencoded', 'multipart', 'raw', 'binary'] as const,
      d.bodyContentType
    ),
    bodyMode: oneOf(r.bodyMode, ['fields', 'json'] as const, d.bodyMode),
    bodyParameters: formParams(r.bodyParameters),
    bodyJson: str(r.bodyJson, d.bodyJson),
    rawContentType: str(r.rawContentType, d.rawContentType),
    rawBody: str(r.rawBody, d.rawBody),
    binaryFilePath: str(r.binaryFilePath, d.binaryFilePath),
    options: normalizeOptions(r.options, d.options)
  }
}
