import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'
import type { HttpRequestOptions } from '../../shared/workflow-http-request-types'
import type { HttpTransport, RawHttpResponse } from './workflow-http-transport'

export type ParsedHttpBody = {
  /** What downstream nodes see as the response body. */
  body: unknown
  /** Raw text form, used for the node's `output`; null when the body is not text. */
  text: string | null
}

export function decodeContentEncoding(res: RawHttpResponse): Buffer {
  const encoding = (res.headers['content-encoding'] ?? '').trim().toLowerCase()
  try {
    if (encoding === 'gzip' || encoding === 'x-gzip') {
      return gunzipSync(res.body)
    }
    if (encoding === 'deflate') {
      return inflateSync(res.body)
    }
    if (encoding === 'br') {
      return brotliDecompressSync(res.body)
    }
  } catch {
    // Some servers mislabel identity bodies; fall through to the raw bytes.
  }
  return res.body
}

function isTextContentType(contentType: string): boolean {
  return (
    contentType === '' ||
    contentType.startsWith('text/') ||
    /json|xml|javascript|ecmascript|x-www-form-urlencoded|yaml|csv|graphql/.test(contentType)
  )
}

function looksBinary(buf: Buffer): boolean {
  return buf.subarray(0, 512).includes(0)
}

export async function parseHttpBody(
  res: RawHttpResponse,
  options: HttpRequestOptions,
  transport: HttpTransport
): Promise<ParsedHttpBody> {
  const bytes = decodeContentEncoding(res)
  const contentType = (res.headers['content-type'] ?? '').toLowerCase()
  const mimeType = contentType.split(';')[0]!.trim()

  switch (options.responseFormat) {
    case 'file': {
      if (!options.responseFilePath) {
        throw new Error('Response format "File" requires an output file path.')
      }
      await transport.writeFile(options.responseFilePath, bytes)
      return {
        body: { filePath: options.responseFilePath, mimeType, sizeBytes: bytes.length },
        text: null
      }
    }
    case 'json': {
      const text = bytes.toString('utf8')
      if (!text.trim()) {
        return { body: null, text }
      }
      try {
        return { body: JSON.parse(text), text }
      } catch {
        throw new Error(`Response is not valid JSON: ${text.slice(0, 200)}`)
      }
    }
    case 'text':
      return { body: bytes.toString('utf8'), text: bytes.toString('utf8') }
    case 'autodetect': {
      if (mimeType.includes('json')) {
        const text = bytes.toString('utf8')
        try {
          return { body: text.trim() ? JSON.parse(text) : null, text }
        } catch {
          return { body: text, text }
        }
      }
      if (isTextContentType(mimeType) && !looksBinary(bytes)) {
        return { body: bytes.toString('utf8'), text: bytes.toString('utf8') }
      }
      return { body: { mimeType, encoding: 'base64', data: bytes.toString('base64') }, text: null }
    }
  }
}

/** Response context exposed to pagination expressions as $response / $pageCount. */
export type HttpPageContext = {
  pageCount: number
  response: { body: unknown; headers: Record<string, string>; statusCode: number } | null
}

function traverse(root: unknown, segments: string[]): unknown {
  let value = root
  for (const seg of segments) {
    for (const part of seg.split(/[[\]]/).filter(Boolean)) {
      if (value === null || typeof value !== 'object') {
        return undefined
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: indexing unknown JSON at runtime; non-objects rejected above
      value = (value as Record<string, unknown>)[part]
    }
  }
  return value
}

function evalPageExpr(expr: string, ctx: HttpPageContext): unknown {
  const arith = expr.match(/^\$pageCount\s*(?:([+\-*])\s*(\d+))?$/)
  if (arith) {
    const n = Number(arith[2] ?? 0)
    return arith[1] === '+'
      ? ctx.pageCount + n
      : arith[1] === '-'
        ? ctx.pageCount - n
        : arith[1] === '*'
          ? ctx.pageCount * n
          : ctx.pageCount
  }
  if (expr === '$response' || expr.startsWith('$response.')) {
    return traverse(ctx.response, expr.split('.').slice(1))
  }
  return undefined
}

/** Resolves {{$pageCount}} / {{$response.…}} placeholders; unknown placeholders become ''. */
export function resolvePageTemplate(template: string, ctx: HttpPageContext): string {
  return template.replace(/\{\{\s*(\$[^}]*?)\s*\}\}/g, (_m, expr: string) => {
    const value = evalPageExpr(expr.trim(), ctx)
    if (value === undefined || value === null) {
      return ''
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  })
}

export function isTruthyTemplateResult(value: string): boolean {
  const v = value.trim().toLowerCase()
  return v !== '' && v !== 'false' && v !== '0' && v !== 'null' && v !== 'undefined'
}

export function isEmptyBody(body: unknown): boolean {
  if (body === null || body === undefined) {
    return true
  }
  if (typeof body === 'string') {
    return body.trim() === ''
  }
  if (Array.isArray(body)) {
    return body.length === 0
  }
  return typeof body === 'object' && Object.keys(body).length === 0
}
