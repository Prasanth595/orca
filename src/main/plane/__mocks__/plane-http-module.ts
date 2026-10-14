import { vi, type Mock } from 'vitest'

export type PlaneFetchMock = Mock<(url: string, init?: RequestInit) => Promise<Response>>

export function planeJsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers }
  })
}

export function planeHtmlResponse(status = 200): Response {
  return new Response('<!doctype html><title>Plane</title>', {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  })
}

/** Loads a fresh Plane HTTP graph whose outbound fetch is `fetchMock`, with empty rate lanes. */
export async function loadPlaneHttpModule(fetchMock: PlaneFetchMock) {
  vi.resetModules()
  // Why after resetModules: the port is a module singleton, so it must be set on the fresh copy.
  const { setMainHttpClient } = await import('../../network/http-client')
  setMainHttpClient({ fetch: (url, init) => fetchMock(url, init), proxySession: () => null })
  const [http, rateLimit] = await Promise.all([
    import('../plane-http'),
    import('../plane-rate-limit')
  ])
  rateLimit.resetPlaneRequestLanesForTests()
  return { http, rateLimit }
}
