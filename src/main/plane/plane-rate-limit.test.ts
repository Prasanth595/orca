import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadPlaneHttpModule,
  planeJsonResponse,
  type PlaneFetchMock
} from './__mocks__/plane-http-module'
import {
  createPlaneRateLimiter,
  PLANE_DEFAULT_RETRY_AFTER_MS,
  PLANE_INITIAL_REQUEST_BUDGET,
  planeRetryAfterMs
} from './plane-rate-limit'

const NOW = Date.UTC(2026, 0, 1)

function settledFlag(promise: Promise<unknown>): { done: boolean } {
  const state = { done: false }
  void promise.then(
    () => (state.done = true),
    () => (state.done = true)
  )
  return state
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createPlaneRateLimiter', () => {
  it('holds the request past the budget until the window slides', async () => {
    const limiter = createPlaneRateLimiter()
    for (let i = 0; i < PLANE_INITIAL_REQUEST_BUDGET; i += 1) {
      await limiter.acquire()
    }
    const next = settledFlag(limiter.acquire())
    await vi.advanceTimersByTimeAsync(59_999)
    expect(next.done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(next.done).toBe(true)
  })

  it('lets the server headers shrink the budget', async () => {
    const limiter = createPlaneRateLimiter()
    limiter.observe(
      new Headers({ 'x-ratelimit-remaining': '1', 'x-ratelimit-reset': String(NOW / 1000 + 30) })
    )
    await limiter.acquire()
    const next = settledFlag(limiter.acquire())
    await vi.advanceTimersByTimeAsync(29_999)
    expect(next.done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(next.done).toBe(true)
  })

  it('lowers the window budget below a smaller advertised limit', async () => {
    const limiter = createPlaneRateLimiter()
    limiter.observe(new Headers({ 'x-ratelimit-limit': '6' }))
    for (let i = 0; i < 5; i += 1) {
      await limiter.acquire()
    }
    const next = settledFlag(limiter.acquire())
    await vi.advanceTimersByTimeAsync(1_000)
    expect(next.done).toBe(false)
  })

  it('aborts a waiting acquire', async () => {
    const limiter = createPlaneRateLimiter()
    limiter.blockFor(10_000)
    const controller = new AbortController()
    const pending = limiter.acquire(controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('planeRetryAfterMs', () => {
  it.each([
    [{ 'retry-after': '7' }, 7_000],
    [{ 'retry-after': new Date(NOW + 12_000).toUTCString() }, 12_000],
    [{ 'x-ratelimit-reset': String(NOW / 1000 + 20) }, 20_000],
    [{ 'x-ratelimit-reset': '5' }, 5_000],
    [{}, PLANE_DEFAULT_RETRY_AFTER_MS]
  ])('reads %j', (headers, expected) => {
    expect(planeRetryAfterMs(new Headers(headers), NOW)).toBe(expected)
  })
})

describe.each([
  { name: 'cloud', apiBaseUrl: 'https://api.plane.so' },
  { name: 'self-hosted', apiBaseUrl: 'https://plane.example.test' }
])('planeRequest 429 handling on $name', ({ apiBaseUrl }) => {
  const target = { apiBaseUrl, apiToken: 'plane_api_token' }
  let fetchMock: PlaneFetchMock
  let mod: Awaited<ReturnType<typeof loadPlaneHttpModule>>
  const tooMany = () =>
    planeJsonResponse({ detail: 'slow down' }, { status: 429, headers: { 'retry-after': '7' } })

  beforeEach(async () => {
    fetchMock = vi.fn()
    mod = await loadPlaneHttpModule(fetchMock)
  })

  it('waits out Retry-After and retries a GET once', async () => {
    fetchMock.mockResolvedValueOnce(tooMany()).mockResolvedValueOnce(planeJsonResponse([1]))
    const pending = mod.http.planeRequest(target, '/x/')
    const state = settledFlag(pending)
    await vi.advanceTimersByTimeAsync(6_999)
    expect(state.done).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toEqual([1])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after the second 429', async () => {
    fetchMock.mockResolvedValueOnce(tooMany()).mockResolvedValueOnce(tooMany())
    const pending = mod.http.planeRequest(target, '/x/')
    const settled = expect(pending).rejects.toMatchObject({
      kind: 'rate_limited',
      retryAfterMs: 7_000
    })
    await vi.advanceTimersByTimeAsync(7_000)
    await settled
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each(['POST', 'PATCH'] as const)('never retries a %s', async (method) => {
    fetchMock.mockResolvedValue(tooMany())
    await expect(mod.http.planeRequest(target, '/x/', { method, body: {} })).rejects.toMatchObject({
      kind: 'rate_limited',
      status: 429,
      retryAfterMs: 7_000
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps later requests on the same key behind the 429 block', async () => {
    fetchMock.mockResolvedValueOnce(tooMany()).mockResolvedValue(planeJsonResponse({}))
    await expect(mod.http.planeRequest(target, '/x/', { method: 'POST' })).rejects.toMatchObject({
      kind: 'rate_limited'
    })
    const next = settledFlag(mod.http.planeRequest(target, '/y/'))
    await vi.advanceTimersByTimeAsync(6_999)
    expect(next.done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(next.done).toBe(true)
  })
})
