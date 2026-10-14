import { abortSignalReason } from '../../shared/abort-signal-reason'
import {
  readFetchResponseJsonWithinLimit,
  readFetchResponseTextWithinLimit
} from '../../shared/fetch-response-body'
import { getMainHttpClient } from '../network/http-client'
import { ensureElectronProxyFromEnvironment } from '../network/proxy-settings'
import { withSpan } from '../observability/tracer'
import {
  PlaneApiError,
  isPlaneApiError,
  planeErrorKindForStatus,
  planeTransportError
} from './plane-api-error'
import { planeRequestLane, planeRetryAfterMs } from './plane-rate-limit'

export const PLANE_REQUEST_TIMEOUT_MS = 20_000
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_NOT_FOUND_PROBE_BYTES = 64 * 1024
// Why a cap: a GET waits out one 429 only when the wait is short enough to beat a manual retry.
const MAX_GET_RETRY_WAIT_MS = 60_000
const API_PATH_PATTERN = /^\/(?:[A-Za-z0-9._~%-]+\/)*$/

export type PlaneHttpTarget = { apiBaseUrl: string; apiToken: string }
export type PlaneHttpMethod = 'GET' | 'POST' | 'PATCH'
export type PlaneRequestOptions = {
  method?: PlaneHttpMethod
  query?: Record<string, string>
  body?: unknown
  signal?: AbortSignal
  timeoutMs?: number
}

/** Builds `/a/b/c/` with every segment encoded, so ids can never change the route. */
export function planeApiPath(...segments: string[]): string {
  return `/${segments.map((segment) => `${encodeURIComponent(segment)}/`).join('')}`
}

function planeApiUrl(apiBaseUrl: string, path: string, query?: Record<string, string>): string {
  if (!API_PATH_PATTERN.test(path) || path.split('/').some((s) => s === '.' || s === '..')) {
    throw new Error('Invalid Plane API path')
  }
  const search = query ? new URLSearchParams(query).toString() : ''
  return `${apiBaseUrl}/api/v1${path}${search ? `?${search}` : ''}`
}

async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

function isJsonObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Why look at a 404 body at all: callers must tell a missing route (older API flavor) from a
// missing resource. Only the shape is kept; the content never leaves this function.
async function notFoundHasJsonBody(response: Response): Promise<boolean> {
  if (!/json/i.test(response.headers.get('content-type') ?? '')) {
    await discardBody(response)
    return false
  }
  try {
    const text = await readFetchResponseTextWithinLimit(response, MAX_NOT_FOUND_PROBE_BYTES)
    return isJsonObject(JSON.parse(text))
  } catch {
    return false
  }
}

async function readResponse(response: Response): Promise<unknown> {
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    await discardBody(response)
    throw new PlaneApiError('redirect', { status: response.status })
  }
  if (!response.ok) {
    const kind = planeErrorKindForStatus(response.status)
    if (kind === 'not_found') {
      const jsonBody = await notFoundHasJsonBody(response)
      throw new PlaneApiError(kind, { status: response.status, jsonBody })
    }
    await discardBody(response)
    throw new PlaneApiError(kind, { status: response.status })
  }
  if (response.status === 204 || response.status === 205) {
    await discardBody(response)
    return null
  }
  // A proxy or the web app answering instead of the API serves HTML with a 200.
  if (/text\/html/i.test(response.headers.get('content-type') ?? '')) {
    await discardBody(response)
    throw new PlaneApiError('invalid_response', { status: response.status })
  }
  try {
    return await readFetchResponseJsonWithinLimit<unknown>(response, MAX_RESPONSE_BYTES)
  } catch {
    await discardBody(response)
    throw new PlaneApiError('invalid_response', { status: response.status })
  }
}

type AttemptResult = { done: true; value: unknown } | { done: false; retryAfterMs: number }

async function attempt(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  onHeaders: (headers: Headers) => void
): Promise<AttemptResult> {
  const httpClient = getMainHttpClient()
  const proxySession = httpClient.proxySession()
  await ensureElectronProxyFromEnvironment({
    ...(proxySession ? { proxySession } : {}),
    probeUrl: url
  }).catch(() => undefined)
  let response: Response
  try {
    // Why redirect:'error': neither Chromium nor undici drops X-API-Key on a cross-origin hop.
    response = await httpClient.fetch(url, { ...init, redirect: 'error', signal })
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    throw planeTransportError(error)
  }
  onHeaders(response.headers)
  if (response.status === 429) {
    const retryAfterMs = planeRetryAfterMs(response.headers)
    await discardBody(response)
    return { done: false, retryAfterMs }
  }
  return { done: true, value: await readResponse(response) }
}

async function withRequestTimeout<T>(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), timeoutMs)
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout.signal]) : timeout.signal
  try {
    return await run(signal)
  } catch (error) {
    if (callerSignal?.aborted) {
      throw abortSignalReason(callerSignal)
    }
    // A timeout mid-body surfaces as a read failure; report the timeout instead.
    if (timeout.signal.aborted) {
      throw new PlaneApiError('network')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * One Plane API call through the per-key rate limit and concurrency lane. Resolves with the
 * parsed JSON (null for an empty reply); rejects with a PlaneApiError, or the caller's abort.
 */
export async function planeRequest(
  target: PlaneHttpTarget,
  path: string,
  options: PlaneRequestOptions = {}
): Promise<unknown> {
  const method = options.method ?? 'GET'
  const url = planeApiUrl(target.apiBaseUrl, path, options.query)
  const headers = new Headers({ Accept: 'application/json', 'X-API-Key': target.apiToken })
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }
  const init: RequestInit = {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  }
  const { limiter, gate } = planeRequestLane(target.apiBaseUrl, target.apiToken)
  return withSpan(
    'plane.request',
    (span) =>
      gate.run(async () => {
        for (let retried = false; ; retried = true) {
          await limiter.acquire(options.signal)
          const result = await withRequestTimeout(
            options.signal,
            options.timeoutMs ?? PLANE_REQUEST_TIMEOUT_MS,
            (signal) => attempt(url, init, signal, (h) => limiter.observe(h))
          ).catch((error: unknown) => {
            span.setAttribute('plane.errorKind', isPlaneApiError(error) ? error.kind : 'abort')
            throw error
          })
          if (result.done) {
            return result.value
          }
          limiter.blockFor(result.retryAfterMs)
          // Why GET only: a POST or PATCH may have landed before the 429 and must not repeat.
          if (method !== 'GET' || retried || result.retryAfterMs > MAX_GET_RETRY_WAIT_MS) {
            span.setAttribute('plane.errorKind', 'rate_limited')
            throw new PlaneApiError('rate_limited', {
              status: 429,
              retryAfterMs: result.retryAfterMs
            })
          }
        }
      }, options.signal),
    { kind: 'client', attributes: { 'plane.origin': new URL(url).origin, 'plane.method': method } }
  )
}
