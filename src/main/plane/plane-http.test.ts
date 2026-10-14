import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadPlaneHttpModule,
  planeHtmlResponse,
  planeJsonResponse,
  type PlaneFetchMock
} from './__mocks__/plane-http-module'

const TOKEN = 'plane_api_0123456789abcdef0123456789abcdef'
const SECRET_BODY = 'internal-host.corp secret detail'

function trackedResponse(status: number, contentType = 'application/json') {
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ detail: SECRET_BODY })))
    },
    cancel
  })
  return {
    response: new Response(body, { status, headers: { 'content-type': contentType } }),
    cancel
  }
}

function waitForAbort(_url: string, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted by signal')))
  })
}

describe.each([
  { name: 'cloud', apiBaseUrl: 'https://api.plane.so' },
  { name: 'self-hosted with a prefix', apiBaseUrl: 'https://plane.example.test/plane' }
])('planeRequest on $name', ({ apiBaseUrl }) => {
  const target = { apiBaseUrl, apiToken: TOKEN }
  let fetchMock: PlaneFetchMock
  let mod: Awaited<ReturnType<typeof loadPlaneHttpModule>>

  beforeEach(async () => {
    fetchMock = vi.fn()
    mod = await loadPlaneHttpModule(fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends the key as a header, never in the URL, and refuses redirects', async () => {
    fetchMock.mockResolvedValue(planeJsonResponse({ id: 'me' }))
    const path = mod.http.planeApiPath('workspaces', 'acme', 'projects')
    await expect(
      mod.http.planeRequest(target, path, { query: { per_page: '100' } })
    ).resolves.toEqual({ id: 'me' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${apiBaseUrl}/api/v1/workspaces/acme/projects/?per_page=100`)
    expect(url).not.toContain(TOKEN)
    expect(init?.redirect).toBe('error')
    const headers = new Headers(init?.headers)
    expect(headers.get('x-api-key')).toBe(TOKEN)
    expect(headers.get('accept')).toBe('application/json')
  })

  it('encodes path segments and rejects hand-built traversal', async () => {
    expect(mod.http.planeApiPath('workspaces', 'a/b', '..')).toBe('/workspaces/a%2Fb/../')
    await expect(mod.http.planeRequest(target, '/workspaces/../users/me/')).rejects.toThrow(
      'Invalid Plane API path'
    )
    await expect(mod.http.planeRequest(target, '/users/me/?x=1')).rejects.toThrow(
      'Invalid Plane API path'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends a JSON body for writes and returns null for an empty reply', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(
      mod.http.planeRequest(target, '/x/', { method: 'PATCH', body: { state: 's' } })
    ).resolves.toBeNull()
    const init = fetchMock.mock.calls[0][1]
    expect(init?.method).toBe('PATCH')
    expect(init?.body).toBe('{"state":"s"}')
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
  })

  it.each([
    [401, 'auth'],
    [403, 'forbidden'],
    [400, 'rejected'],
    [502, 'network'],
    [302, 'redirect']
  ])('maps HTTP %i to %s, cancels the body and never echoes it', async (status, kind) => {
    const { response, cancel } = trackedResponse(status)
    fetchMock.mockResolvedValue(response)
    const error = await mod.http.planeRequest(target, '/x/').catch((e: unknown) => e)
    expect(error).toMatchObject({ name: 'PlaneApiError', kind, status })
    expect(String(error)).not.toContain(SECRET_BODY)
    expect(String(error)).not.toContain(TOKEN)
    expect(cancel).toHaveBeenCalled()
  })

  it('tells a JSON 404 from a missing route', async () => {
    fetchMock.mockResolvedValueOnce(planeJsonResponse({ detail: SECRET_BODY }, { status: 404 }))
    fetchMock.mockResolvedValueOnce(planeHtmlResponse(404))
    const resource = await mod.http.planeRequest(target, '/x/').catch((e: unknown) => e)
    const route = await mod.http.planeRequest(target, '/x/').catch((e: unknown) => e)
    expect(resource).toMatchObject({ kind: 'not_found', jsonBody: true })
    expect(route).toMatchObject({ kind: 'not_found', jsonBody: false })
    expect(String(resource)).not.toContain(SECRET_BODY)
  })

  it('reports the web app or malformed JSON as an invalid response', async () => {
    fetchMock.mockResolvedValueOnce(planeHtmlResponse(200))
    fetchMock.mockResolvedValueOnce(
      new Response('{not json', { headers: { 'content-type': 'application/json' } })
    )
    await expect(mod.http.planeRequest(target, '/x/')).rejects.toMatchObject({
      kind: 'invalid_response'
    })
    await expect(mod.http.planeRequest(target, '/x/')).rejects.toMatchObject({
      kind: 'invalid_response'
    })
  })

  it.each([
    [
      'undici redirect',
      new TypeError('fetch failed', { cause: new Error('unexpected redirect') }),
      'redirect'
    ],
    [
      'node certificate',
      new TypeError('fetch failed', {
        cause: Object.assign(new Error('x'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' })
      }),
      'tls'
    ],
    ['chromium certificate', new Error('net::ERR_CERT_AUTHORITY_INVALID'), 'tls'],
    [
      'connection refused',
      new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') }),
      'network'
    ]
  ])('maps a %s failure to %s without its text', async (_name, failure, kind) => {
    fetchMock.mockRejectedValue(failure)
    const error = await mod.http.planeRequest(target, '/x/').catch((e: unknown) => e)
    expect(error).toMatchObject({ kind })
    expect(error).not.toHaveProperty('cause')
  })

  it('rejects with the caller abort, not a Plane error', async () => {
    fetchMock.mockImplementation(waitForAbort)
    const controller = new AbortController()
    const pending = mod.http.planeRequest(target, '/x/', { signal: controller.signal })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('times out as a network error', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(waitForAbort)
    const pending = mod.http.planeRequest(target, '/x/', { timeoutMs: 1_000 })
    const settled = expect(pending).rejects.toMatchObject({ kind: 'network' })
    await vi.advanceTimersByTimeAsync(1_000)
    await settled
  })
})
