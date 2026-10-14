import type { HttpRequestData } from '../../shared/workflow-http-request-types'
import type { StepOutputs } from '../../shared/workflow-types'
import { normalizeHttpRequestData } from '../../shared/workflow-http-request-defaults'
import { resolveTemplatesDeep } from '../../shared/workflow-template-path'
import { localHttpTransport } from './workflow-http-transport'
import { createRemoteHttpTransport } from './workflow-http-transport-remote'
import type { RemoteExecFn } from './workflow-remote-exec'
import { buildHttpRequest, type PreparedHttpRequest } from './workflow-http-request-builder'
import { buildDigestAuthorization, parseDigestChallenge } from './workflow-http-digest-auth'
import {
  isEmptyBody,
  isTruthyTemplateResult,
  parseHttpBody,
  resolvePageTemplate,
  type HttpPageContext
} from './workflow-http-response'
import type { HttpSendOptions, HttpTransport, RawHttpResponse } from './workflow-http-transport'

export type HttpRequestResult = { stdout: string; outputValue: unknown }

type PageResult = { result: unknown; text: string | null; body: unknown; res: RawHttpResponse }

function withoutHeaders(headers: Record<string, string>, names: string[]): Record<string, string> {
  const drop = new Set(names)
  return Object.fromEntries(Object.entries(headers).filter(([k]) => !drop.has(k.toLowerCase())))
}

function withHeader(
  req: PreparedHttpRequest,
  name: string,
  value: string,
  lowercase: boolean
): PreparedHttpRequest {
  const headers = withoutHeaders(req.headers, [name.toLowerCase()])
  headers[lowercase ? name.toLowerCase() : name] = value
  return { ...req, headers }
}

async function sendWithAuthRetry(
  data: HttpRequestData,
  transport: HttpTransport,
  req: PreparedHttpRequest,
  opts: HttpSendOptions
): Promise<RawHttpResponse> {
  const res = await transport.send(req, opts)
  if (res.statusCode !== 401 || data.auth.type !== 'digest') {
    return res
  }
  const challenge = parseDigestChallenge(res.headers['www-authenticate'])
  if (!challenge) {
    return res
  }
  const authorization = buildDigestAuthorization(
    challenge,
    req.method,
    req.url,
    data.auth.username,
    data.auth.password
  )
  return transport.send(
    withHeader(req, 'Authorization', authorization, data.options.lowercaseHeaders),
    opts
  )
}

async function sendFollowingRedirects(
  data: HttpRequestData,
  transport: HttpTransport,
  initial: PreparedHttpRequest,
  opts: HttpSendOptions
): Promise<RawHttpResponse> {
  let req = initial
  for (let hops = 0; ; hops++) {
    const res = await sendWithAuthRetry(data, transport, req, opts)
    const location = res.headers['location']
    const isRedirect = [301, 302, 303, 307, 308].includes(res.statusCode)
    if (!isRedirect || !location || !data.options.followRedirects) {
      return res
    }
    if (hops >= data.options.maxRedirects) {
      throw new Error(`Maximum number of redirects exceeded (${data.options.maxRedirects}).`)
    }
    const nextUrl = new URL(location, req.url)
    // Browsers and n8n downgrade 303 (and 301/302 after POST) to a bodyless GET.
    const toGet =
      (res.statusCode === 303 && req.method !== 'HEAD') ||
      ([301, 302].includes(res.statusCode) && req.method === 'POST')
    let headers = toGet
      ? withoutHeaders(req.headers, ['content-type', 'content-length'])
      : req.headers
    if (nextUrl.origin !== new URL(req.url).origin) {
      headers = withoutHeaders(headers, ['authorization', 'cookie'])
    }
    req = {
      method: toGet ? 'GET' : req.method,
      url: nextUrl.toString(),
      headers,
      body: toGet ? null : req.body
    }
  }
}

function assertOk(res: RawHttpResponse, page: PageResult, data: HttpRequestData): void {
  if (data.options.neverError || (res.statusCode >= 200 && res.statusCode < 400)) {
    return
  }
  const detail = page.text ?? ''
  const snippet = detail.length > 500 ? `${detail.slice(0, 500)}…` : detail
  throw new Error(
    `Request failed with status code ${res.statusCode}${res.statusMessage ? ` (${res.statusMessage})` : ''}${snippet ? `: ${snippet}` : ''}`
  )
}

async function fetchPage(
  data: HttpRequestData,
  transport: HttpTransport,
  req: PreparedHttpRequest,
  opts: HttpSendOptions
): Promise<PageResult> {
  const res = await sendFollowingRedirects(data, transport, req, opts)
  const { body, text } = await parseHttpBody(res, data.options, transport)
  const { options } = data
  const result = options.includeResponseMeta
    ? { body, headers: res.headers, statusCode: res.statusCode, statusMessage: res.statusMessage }
    : typeof body === 'string'
      ? { [options.outputField]: body }
      : body
  return { result, text, body, res }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('Cancelled'))
      },
      { once: true }
    )
  })
}

async function runPaginated(
  data: HttpRequestData,
  transport: HttpTransport,
  opts: HttpSendOptions
): Promise<HttpRequestResult> {
  const p = data.options.pagination
  const completeCodes = new Set(
    p.completeStatusCodes
      .split(',')
      .map((c) => Number(c.trim()))
      .filter((c) => c > 0)
  )
  const results: unknown[] = []
  let ctx: HttpPageContext = { pageCount: 0, response: null }
  let nextUrl: string | undefined
  const maxPages = p.maxPages > 0 ? p.maxPages : Number.POSITIVE_INFINITY

  while (ctx.pageCount < maxPages) {
    if (opts.signal?.aborted) {
      throw new Error('Cancelled')
    }
    const pageParams =
      p.mode === 'updateParameter'
        ? p.parameters
            .filter((param) => param.name !== '')
            .map((param) => ({ ...param, value: resolvePageTemplate(param.value, ctx) }))
        : []
    const req = await buildHttpRequest(data, transport.readFile, pageParams, nextUrl)
    const page = await fetchPage(data, transport, req, opts)
    // A completing status code is the expected end of pagination, not a failure.
    if (p.completeWhen === 'statusCodes' && completeCodes.has(page.res.statusCode)) {
      break
    }
    if (p.completeWhen === 'emptyResponse' && isEmptyBody(page.body)) {
      break
    }
    assertOk(page.res, page, data)
    results.push(page.result)
    ctx = {
      pageCount: ctx.pageCount + 1,
      response: { body: page.body, headers: page.res.headers, statusCode: page.res.statusCode }
    }
    if (p.completeWhen === 'expression') {
      const expr = p.completeExpression.trim()
      const negate = expr.startsWith('!')
      const done = isTruthyTemplateResult(resolvePageTemplate(negate ? expr.slice(1) : expr, ctx))
      if (done !== negate) {
        break
      }
    }
    if (p.mode === 'nextUrl') {
      nextUrl = resolvePageTemplate(p.nextUrl, ctx).trim()
      if (!nextUrl) {
        break
      }
      nextUrl = new URL(nextUrl, req.url).toString()
    }
    if (p.intervalMs > 0 && ctx.pageCount < maxPages) {
      await sleep(p.intervalMs, opts.signal)
    }
  }

  // List endpoints return one array per page; join them so downstream nodes see one list.
  const merged = results.length > 0 && results.every(Array.isArray) ? results.flat() : results
  return { stdout: JSON.stringify(merged), outputValue: merged }
}

/** Executes an HTTP Request node. `data` must already have its {{}} templates resolved. */
export async function runHttpRequestNode(
  data: HttpRequestData,
  transport: HttpTransport,
  signal?: AbortSignal
): Promise<HttpRequestResult> {
  const opts: HttpSendOptions = {
    timeoutMs: data.options.timeoutMs,
    ignoreSsl: data.options.ignoreSsl,
    proxy: data.options.proxy,
    signal
  }
  if (data.options.pagination.mode !== 'off') {
    return runPaginated(data, transport, opts)
  }
  const req = await buildHttpRequest(data, transport.readFile)
  const page = await fetchPage(data, transport, req, opts)
  assertOk(page.res, page, data)
  const stdout =
    !data.options.includeResponseMeta && page.text !== null && typeof page.body === 'string'
      ? page.text
      : JSON.stringify(page.result)
  return { stdout, outputValue: page.result }
}

/** Resolves {{}} templates in every field, then sends from the workflow's execution host. */
export function executeHttpRequestNode(
  rawData: unknown,
  steps: StepOutputs,
  remoteExec?: RemoteExecFn,
  signal?: AbortSignal
): Promise<HttpRequestResult> {
  const data = resolveTemplatesDeep(normalizeHttpRequestData(rawData), steps)
  const transport = remoteExec ? createRemoteHttpTransport(remoteExec) : localHttpTransport
  return runHttpRequestNode(data, transport, signal)
}
