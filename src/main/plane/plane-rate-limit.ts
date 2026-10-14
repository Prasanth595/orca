import { createHash } from 'node:crypto'
import { throwIfSignalAborted, abortSignalReason } from '../../shared/abort-signal-reason'
import {
  createAbortableConcurrencyGate,
  type AbortableConcurrencyGate
} from '../network/abortable-concurrency-gate'

const WINDOW_MS = 60_000
// Why below 60: Cloud allows 60/min per key and self-hosted defaults to the same, so leave
// headroom for the user's other clients of that key.
export const PLANE_INITIAL_REQUEST_BUDGET = 50
export const PLANE_DEFAULT_RETRY_AFTER_MS = 60_000
const MAX_RETRY_AFTER_MS = 15 * 60_000
export const PLANE_CONCURRENCY = 2
const MAX_LANES = 32

export type PlaneRateLimiter = {
  /** Waits until one more request fits the window, the server allowance and any 429 block. */
  acquire(signal?: AbortSignal): Promise<void>
  /** Adopts the server's `X-RateLimit-*` view when it sends one. */
  observe(headers: Headers): void
  blockFor(ms: number): void
}

function headerNumber(headers: Headers, name: string): number | null {
  const raw = headers.get(name)?.trim()
  if (!raw || !/^\d+(?:\.\d+)?$/.test(raw)) {
    return null
  }
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

// The reset header is either an epoch (seconds or ms) or seconds from now, depending on version.
function resetAtFromHeaders(headers: Headers, now: number): number | null {
  const reset = headerNumber(headers, 'x-ratelimit-reset')
  if (reset === null) {
    return null
  }
  if (reset > 1e12) {
    return reset
  }
  return reset > 1e9 ? reset * 1000 : now + reset * 1000
}

function clampRetryMs(ms: number): number {
  return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS)
}

/** How long a 429 asks us to wait: `Retry-After`, else the reset header, else a minute. */
export function planeRetryAfterMs(headers: Headers, now = Date.now()): number {
  const seconds = headerNumber(headers, 'retry-after')
  if (seconds !== null) {
    return clampRetryMs(seconds * 1000)
  }
  const date = Date.parse(headers.get('retry-after') ?? '')
  if (Number.isFinite(date)) {
    return clampRetryMs(date - now)
  }
  const resetAt = resetAtFromHeaders(headers, now)
  return resetAt === null ? PLANE_DEFAULT_RETRY_AFTER_MS : clampRetryMs(resetAt - now)
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      if (signal) {
        reject(abortSignalReason(signal))
      }
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function createPlaneRateLimiter(): PlaneRateLimiter {
  let budget = PLANE_INITIAL_REQUEST_BUDGET
  let blockedUntil = 0
  let server: { remaining: number; resetAt: number } | null = null
  const starts: number[] = []

  const waitMs = (now: number): number => {
    while (starts.length > 0 && starts[0] <= now - WINDOW_MS) {
      starts.shift()
    }
    if (blockedUntil > now) {
      return blockedUntil - now
    }
    if (server && now >= server.resetAt) {
      server = null
    }
    if (server && server.remaining <= 0) {
      return server.resetAt - now
    }
    return starts.length >= budget ? starts[0] + WINDOW_MS - now : 0
  }

  return {
    async acquire(signal) {
      for (;;) {
        throwIfSignalAborted(signal)
        const now = Date.now()
        const wait = waitMs(now)
        if (wait <= 0) {
          starts.push(now)
          if (server) {
            server.remaining -= 1
          }
          return
        }
        await delay(wait, signal)
      }
    },
    observe(headers) {
      const now = Date.now()
      const limit = headerNumber(headers, 'x-ratelimit-limit')
      if (limit !== null) {
        budget = Math.min(PLANE_INITIAL_REQUEST_BUDGET, Math.max(1, Math.floor((limit * 5) / 6)))
      }
      const remaining = headerNumber(headers, 'x-ratelimit-remaining')
      if (remaining !== null) {
        server = { remaining, resetAt: resetAtFromHeaders(headers, now) ?? now + WINDOW_MS }
      }
    },
    blockFor(ms) {
      blockedUntil = Math.max(blockedUntil, Date.now() + clampRetryMs(ms))
    }
  }
}

export type PlaneRequestLane = { limiter: PlaneRateLimiter; gate: AbortableConcurrencyGate }

const lanes = new Map<string, PlaneRequestLane>()

// Why hash: one budget per server and key, without holding the token as a map key.
function laneKey(apiBaseUrl: string, apiToken: string): string {
  return createHash('sha256').update(`${apiBaseUrl}\n${apiToken}`).digest('base64url')
}

export function planeRequestLane(apiBaseUrl: string, apiToken: string): PlaneRequestLane {
  const key = laneKey(apiBaseUrl, apiToken)
  let lane = lanes.get(key)
  if (!lane) {
    if (lanes.size >= MAX_LANES) {
      const oldest = lanes.keys().next()
      if (!oldest.done) {
        lanes.delete(oldest.value)
      }
    }
    lane = {
      limiter: createPlaneRateLimiter(),
      gate: createAbortableConcurrencyGate(PLANE_CONCURRENCY)
    }
    lanes.set(key, lane)
  }
  return lane
}

export function resetPlaneRequestLanesForTests(): void {
  lanes.clear()
}
