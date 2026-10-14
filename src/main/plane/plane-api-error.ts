import type { PlaneApiErrorKind } from '../../shared/plane-types'

// Why fixed messages: response bodies and URLs can carry server or user data, and these
// messages cross RPC to clients and logs. The renderer localizes by `kind` anyway.
const MESSAGES: Record<PlaneApiErrorKind, string> = {
  auth: 'Plane rejected the API token.',
  forbidden: 'This Plane token cannot access the requested resource.',
  not_found: 'Plane could not find the requested resource.',
  rate_limited: 'Plane rate limit reached. Try again shortly.',
  network: 'Could not reach the Plane server.',
  tls: "The Plane server's certificate is not trusted by this Orca host.",
  redirect: 'The Plane server answered with a redirect. Use its final URL.',
  invalid_response: 'This URL serves the Plane web app, not its API. Set the API base URL.',
  rejected: 'Plane rejected the request.'
}

// Node/undici certificate failures; Chromium reports them only through the message.
const TLS_ERROR_CODES = new Set([
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID'
])
const TLS_MESSAGE_PATTERN = /net::ERR_(?:CERT|SSL)_|certificate/i
const REDIRECT_MESSAGE_PATTERN = /redirect/i

export type PlaneApiErrorOptions = {
  status?: number
  retryAfterMs?: number
  /** For a 404: whether the body was a JSON object, i.e. the API route exists. */
  jsonBody?: boolean
}

export class PlaneApiError extends Error {
  readonly kind: PlaneApiErrorKind
  readonly status?: number
  readonly retryAfterMs?: number
  readonly jsonBody?: boolean

  constructor(kind: PlaneApiErrorKind, options: PlaneApiErrorOptions = {}) {
    super(
      options.status === undefined ? MESSAGES[kind] : `${MESSAGES[kind]} (HTTP ${options.status})`
    )
    this.name = 'PlaneApiError'
    this.kind = kind
    if (options.status !== undefined) {
      this.status = options.status
    }
    if (options.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs
    }
    if (options.jsonBody !== undefined) {
      this.jsonBody = options.jsonBody
    }
  }
}

export function isPlaneApiError(error: unknown): error is PlaneApiError {
  return error instanceof PlaneApiError
}

export function planeErrorKindForStatus(status: number): PlaneApiErrorKind {
  if (status === 401) {
    return 'auth'
  }
  if (status === 403) {
    return 'forbidden'
  }
  if (status === 404) {
    return 'not_found'
  }
  if (status === 429) {
    return 'rate_limited'
  }
  if (status >= 300 && status < 400) {
    return 'redirect'
  }
  return status >= 500 ? 'network' : 'rejected'
}

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = []
  let current = error
  while (current !== undefined && current !== null && chain.length < 4) {
    chain.push(current)
    current = current instanceof Error ? current.cause : undefined
  }
  return chain
}

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null
  }
  return typeof error.code === 'string' ? error.code : null
}

/** Classifies a fetch rejection; the original error is dropped so its text never escapes. */
export function planeTransportError(error: unknown): PlaneApiError {
  for (const link of errorChain(error)) {
    const code = errorCode(link)
    const message = link instanceof Error ? link.message : ''
    if (
      (code && (TLS_ERROR_CODES.has(code) || code.startsWith('CERT_'))) ||
      TLS_MESSAGE_PATTERN.test(message)
    ) {
      return new PlaneApiError('tls')
    }
    // undici: `fetch failed` caused by `unexpected redirect`; Chromium names the redirect too.
    if (REDIRECT_MESSAGE_PATTERN.test(message)) {
      return new PlaneApiError('redirect')
    }
  }
  return new PlaneApiError('network')
}
