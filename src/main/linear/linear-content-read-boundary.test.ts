import { loadLinearSdk } from './linear-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readLinearDocumentContent } from './linear-content-read'
import { resolveIssue } from './issue-context-client'
import { acquire, release } from './linear-request-concurrency'

const mocks = vi.hoisted(() => ({ getClients: vi.fn(), clearToken: vi.fn() }))
vi.mock('./client', async () => {
  const { loadLinearSdk } = await import('./linear-sdk')
  return {
    getClients: mocks.getClients,
    getStatus: () => ({ workspaces: [] }),
    getPublicFileUrlClient: (entry: { client: unknown }) => entry.client,
    isAuthError: (error: unknown) => error instanceof loadLinearSdk().AuthenticationLinearError
  }
})
vi.mock('./linear-token-store', () => ({ clearToken: mocks.clearToken }))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const id = '33333333-3333-4333-8333-333333333333'
const request = { id, workspaceId }
const document = {
  id,
  slugId: 'fixture',
  title: 'Fixture',
  url: 'https://linear.app/fixture/document/fixture',
  content: 'Fixture content',
  updatedAt: '2026-10-15T00:00:00Z',
  project: null,
  issue: null
}
const fetchMock = vi.fn<typeof fetch>()
let client: InstanceType<ReturnType<typeof loadLinearSdk>['LinearClient']>

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockRejectedValue(new Error('unexpected network access'))
  client = new (loadLinearSdk().LinearClient)({ apiKey: 'synthetic-not-a-credential' })
  mocks.getClients.mockReturnValue([{ workspace: { id: workspaceId }, client }])
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function failResponse(status: number, type: string, message: string, headers = {}) {
  fetchMock.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          errors: [{ message, extensions: { type } }]
        }),
        { status, headers: { 'content-type': 'application/json', ...headers } }
      )
  )
}

describe('Linear content read SDK and concurrency boundaries', () => {
  it('cancels a timed-out queued read without issuing it or starving healthy reads', async () => {
    vi.useFakeTimers()
    const rawRequest = vi.spyOn(client.client, 'rawRequest')
    await Promise.all([acquire(), acquire(), acquire(), acquire()])
    let occupied = 4
    try {
      const expired = expect(readLinearDocumentContent(request)).rejects.toMatchObject({
        code: 'linear_timeout'
      })
      await vi.advanceTimersByTimeAsync(30_000)
      await expired
      expect(rawRequest).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
      release()
      occupied--
      await vi.advanceTimersByTimeAsync(0)
      expect(rawRequest).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ data: { document } }), {
          headers: { 'content-type': 'application/json' }
        })
      )
      await expect(readLinearDocumentContent(request)).resolves.toMatchObject({
        document: { id },
        meta: { contentComplete: true }
      })
      expect(rawRequest).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(mocks.clearToken).not.toHaveBeenCalled()
    } finally {
      for (let index = 0; index < occupied; index++) {
        release()
      }
    }
  })

  it('classifies real SDK 403 without clearing credentials or exposing SDK internals', async () => {
    failResponse(403, 'forbidden', 'You do not have access to this resource')
    const error = await readLinearDocumentContent(request).catch((error: unknown) => error)
    expect(error).toMatchObject({ code: 'linear_permission_denied', data: undefined })
    expect(JSON.stringify(error)).not.toMatch(
      /synthetic-not-a-credential|raw|headers|variables|query/
    )
    expect(mocks.clearToken).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([429, 400])('exports only safe rate-limit timing from SDK HTTP %i', async (status) => {
    failResponse(status, 'ratelimited', 'Too many requests', {
      'Retry-After': '120',
      'X-RateLimit-Requests-Reset': '1792022520000',
      'X-RateLimit-Complexity-Reset': '1792022580000'
    })
    const error = await readLinearDocumentContent(request).catch((error: unknown) => error)
    expect(error).toMatchObject({
      code: 'linear_rate_limited',
      data: {
        retryAfterSeconds: 120,
        requestsResetAtMs: 1792022520000,
        complexityResetAtMs: 1792022580000
      }
    })
    expect(error).toHaveProperty('data', {
      retryAfterSeconds: 120,
      requestsResetAtMs: 1792022520000,
      complexityResetAtMs: 1792022580000
    })
    expect(JSON.stringify(error)).not.toMatch(
      /synthetic-not-a-credential|raw|headers|variables|query/
    )
    expect(mocks.clearToken).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('omits invalid SDK timing rather than leaking headers or coercing unknown values', async () => {
    failResponse(429, 'ratelimited', 'Too many requests', {
      'Retry-After': 'Infinity',
      'X-RateLimit-Requests-Reset': '-1',
      'X-RateLimit-Complexity-Reset': 'not-a-number'
    })
    await expect(readLinearDocumentContent(request)).rejects.toMatchObject({
      code: 'linear_rate_limited',
      data: undefined
    })
    expect(mocks.clearToken).not.toHaveBeenCalled()
  })

  it('preserves real SDK authentication cleanup for the selected workspace', async () => {
    failResponse(401, 'authentication error', 'Session is no longer valid')
    await expect(readLinearDocumentContent(request)).rejects.toMatchObject({
      code: 'linear_auth_expired',
      message: 'Linear authentication expired.',
      data: { nextSteps: ['Reconnect Linear from Orca settings.'] }
    })
    expect(mocks.clearToken).toHaveBeenCalledExactlyOnceWith(workspaceId)
  })

  it('keeps unknown network errors sanitized and leaves credentials intact', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed Authorization: Bearer fixture-secret'))
    const error = await readLinearDocumentContent(request).catch((error: unknown) => error)
    expect(error).toMatchObject({ code: 'linear_network_error', data: undefined })
    expect(error).toHaveProperty('message', expect.stringContaining('[REDACTED]'))
    expect(JSON.stringify(error)).not.toContain('fixture-secret')
    expect(mocks.clearToken).not.toHaveBeenCalled()
  })

  it('preserves the same classification for existing issue reads used by write target resolution', async () => {
    failResponse(403, 'forbidden', 'You do not have access to this resource')
    await expect(resolveIssue('ENG-1', {})).rejects.toMatchObject({
      code: 'linear_permission_denied'
    })
    expect(mocks.clearToken).not.toHaveBeenCalled()
  })

  it('keeps the legacy AuthenticationLinearError cleanup behavior', async () => {
    fetchMock.mockRejectedValue(new (loadLinearSdk().AuthenticationLinearError)())
    await expect(readLinearDocumentContent(request)).rejects.toMatchObject({
      code: 'linear_auth_expired'
    })
    expect(mocks.clearToken).toHaveBeenCalledExactlyOnceWith(workspaceId)
  })
})
