import { randomBytes } from 'node:crypto'
import type {
  HttpKeyValue,
  HttpPaginationParam,
  HttpQueryArrayFormat,
  HttpRequestData
} from '../../shared/workflow-http-request-types'

export type PreparedHttpRequest = {
  method: string
  url: string
  headers: Record<string, string>
  body: Buffer | null
}

/** Reads a file on the execution host (local disk or SSH target). */
export type HttpFileReader = (path: string) => Promise<Buffer>

const MIME_BY_EXT: Record<string, string> = {
  json: 'application/json',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  xml: 'application/xml',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  zip: 'application/zip'
}

export function fileBaseName(filePath: string): string {
  // Path may belong to a remote POSIX host or local Windows, so split on both separators.
  return filePath.split(/[\\/]/).findLast(Boolean) ?? 'file'
}

export function guessMimeType(filePath: string): string {
  const ext = fileBaseName(filePath).split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

function parseJsonObject(text: string, what: string): Record<string, unknown> {
  if (!text.trim()) {
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new Error(
      `${what} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${what} must be a JSON object.`)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: verified non-null non-array object above
  return parsed as Record<string, unknown>
}

function scalarToString(v: unknown): string {
  if (typeof v === 'string') {
    return v
  }
  if (v === null || v === undefined) {
    return ''
  }
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

function fieldsToEntries(fields: HttpKeyValue[]): [string, unknown][] {
  return fields.filter((f) => f.name !== '').map((f) => [f.name, f.value])
}

export function appendQueryEntries(
  url: URL,
  entries: [string, unknown][],
  format: HttpQueryArrayFormat
): void {
  for (const [name, value] of entries) {
    if (!Array.isArray(value)) {
      url.searchParams.append(name, scalarToString(value))
      continue
    }
    value.forEach((item, i) => {
      const key =
        format === 'noBrackets' ? name : format === 'brackets' ? `${name}[]` : `${name}[${i}]`
      url.searchParams.append(key, scalarToString(item))
    })
  }
}

function setHeader(headers: Record<string, string>, name: string, value: string): void {
  const existing = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase())
  if (existing) {
    delete headers[existing]
  }
  headers[name] = value
}

export function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((k) => k.toLowerCase() === name.toLowerCase())
}

function bodyObject(data: HttpRequestData): Record<string, unknown> {
  return data.bodyMode === 'json'
    ? parseJsonObject(data.bodyJson, 'JSON body')
    : Object.fromEntries(fieldsToEntries(data.bodyParameters))
}

function buildMultipart(
  parts: { name: string; value: Buffer | string; filename?: string; contentType?: string }[]
): { body: Buffer; contentType: string } {
  const boundary = `----OrcaFormBoundary${randomBytes(12).toString('hex')}`
  const chunks: Buffer[] = []
  for (const p of parts) {
    const name = p.name.replace(/"/g, '%22')
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${name}"`
    if (p.filename !== undefined) {
      head += `; filename="${p.filename.replace(/"/g, '%22')}"\r\nContent-Type: ${p.contentType}`
    }
    chunks.push(Buffer.from(`${head}\r\n\r\n`), Buffer.from(p.value), Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

async function buildBody(
  data: HttpRequestData,
  pageBodyParams: HttpPaginationParam[],
  readFile: HttpFileReader
): Promise<{ body: Buffer; contentType: string } | null> {
  switch (data.bodyContentType) {
    case 'json': {
      const obj = { ...bodyObject(data) }
      for (const p of pageBodyParams) {
        obj[p.name] = p.value
      }
      return { body: Buffer.from(JSON.stringify(obj)), contentType: 'application/json' }
    }
    case 'form_urlencoded': {
      const isRawString = data.bodyMode === 'json' && !data.bodyJson.trim().startsWith('{')
      const params = new URLSearchParams(isRawString ? data.bodyJson.trim() : '')
      if (!isRawString) {
        for (const [k, v] of Object.entries(bodyObject(data))) {
          params.append(k, scalarToString(v))
        }
      }
      for (const p of pageBodyParams) {
        params.set(p.name, p.value)
      }
      return {
        body: Buffer.from(params.toString()),
        contentType: 'application/x-www-form-urlencoded'
      }
    }
    case 'multipart': {
      const parts = await Promise.all(
        data.bodyParameters
          .filter((p) => p.name !== '')
          .map(async (p) =>
            p.kind === 'file'
              ? {
                  name: p.name,
                  value: await readFile(p.value),
                  filename: fileBaseName(p.value),
                  contentType: guessMimeType(p.value)
                }
              : { name: p.name, value: p.value }
          )
      )
      for (const p of pageBodyParams) {
        parts.push({ name: p.name, value: p.value })
      }
      return buildMultipart(parts)
    }
    case 'raw':
      return { body: Buffer.from(data.rawBody), contentType: data.rawContentType || 'text/plain' }
    case 'binary':
      if (!data.binaryFilePath) {
        throw new Error('Binary body requires a file path.')
      }
      return {
        body: await readFile(data.binaryFilePath),
        contentType: guessMimeType(data.binaryFilePath)
      }
  }
}

/** Builds the concrete request; `pageParams` are pagination overrides for this page. */
export async function buildHttpRequest(
  data: HttpRequestData,
  readFile: HttpFileReader,
  pageParams: HttpPaginationParam[] = [],
  urlOverride?: string
): Promise<PreparedHttpRequest> {
  const rawUrl = (urlOverride ?? data.url).trim()
  if (!rawUrl) {
    throw new Error('HTTP Request URL is required.')
  }
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`)
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported URL protocol: ${url.protocol}`)
  }

  // A next-URL page already carries its own query string.
  if (data.sendQuery && urlOverride === undefined) {
    const entries =
      data.queryMode === 'json'
        ? Object.entries(parseJsonObject(data.queryJson, 'Query parameters'))
        : fieldsToEntries(data.queryParameters)
    appendQueryEntries(url, entries, data.options.arrayFormat)
  }
  for (const p of pageParams.filter((p) => p.location === 'query')) {
    url.searchParams.set(p.name, p.value)
  }

  const headers: Record<string, string> = {}
  if (data.sendHeaders) {
    const entries =
      data.headerMode === 'json'
        ? Object.entries(parseJsonObject(data.headersJson, 'Headers'))
        : fieldsToEntries(data.headers)
    for (const [name, value] of entries) {
      setHeader(headers, name, scalarToString(value))
    }
  }
  for (const p of pageParams.filter((p) => p.location === 'headers')) {
    setHeader(headers, p.name, p.value)
  }

  const { auth } = data
  if (auth.type === 'basic') {
    const token = Buffer.from(`${auth.username}:${auth.password}`).toString('base64')
    setHeader(headers, 'Authorization', `Basic ${token}`)
  } else if (auth.type === 'bearer') {
    setHeader(headers, 'Authorization', `Bearer ${auth.token}`)
  } else if (auth.type === 'header' && auth.name) {
    setHeader(headers, auth.name, auth.value)
  } else if (auth.type === 'query' && auth.name) {
    url.searchParams.set(auth.name, auth.value)
  }

  const bodyAllowed = data.method !== 'GET' && data.method !== 'HEAD'
  const built =
    data.sendBody && bodyAllowed
      ? await buildBody(
          data,
          pageParams.filter((p) => p.location === 'body'),
          readFile
        )
      : null
  if (built && !hasHeader(headers, 'content-type')) {
    setHeader(headers, 'Content-Type', built.contentType)
  }

  const finalHeaders = data.options.lowercaseHeaders
    ? Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    : headers
  return {
    method: data.method,
    url: url.toString(),
    headers: finalHeaders,
    body: built?.body ?? null
  }
}
