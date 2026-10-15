import type * as Os from 'node:os'
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

// Binary like real ciphertext, so the plaintext sniff classifies the file as sealed.
export const SEALED_MARKER = Buffer.from([0x00, 0x01, 0xff, 0xfe])

export type PlaneMainModuleOptions = { encryptionAvailable?: boolean }

/**
 * Loads the Plane main-process modules against a temporary HOME, a fake secret store
 * (sealing is a reversible marker) and `fetchMock` as the network.
 */
export async function loadPlaneMainModule(
  fetchMock: PlaneFetchMock,
  tempHome: string,
  options: PlaneMainModuleOptions = {}
) {
  vi.resetModules()
  const homeMock = async (importOriginal: () => Promise<typeof Os>) => ({
    ...(await importOriginal()),
    homedir: () => tempHome
  })
  vi.doMock('node:os', homeMock)
  vi.doMock('os', homeMock)
  const { setSecretStore } = await import('../../../shared/secret-store')
  setSecretStore({
    isEncryptionAvailable: () => options.encryptionAvailable ?? true,
    encryptString: (value) => Buffer.concat([SEALED_MARKER, Buffer.from(value, 'utf-8')]),
    decryptString: (value) => {
      if (!value.subarray(0, SEALED_MARKER.length).equals(SEALED_MARKER)) {
        throw new Error('not sealed')
      }
      return value.subarray(SEALED_MARKER.length).toString('utf-8')
    },
    describeProtectionGap: () => null
  })
  const { setMainHttpClient } = await import('../../network/http-client')
  setMainHttpClient({ fetch: (url, init) => fetchMock(url, init), proxySession: () => null })
  const [commands, workItems, store, session, rateLimit] = await Promise.all([
    import('../plane-commands'),
    import('../plane-work-item-commands'),
    import('../plane-connection-store'),
    import('../plane-session'),
    import('../plane-rate-limit')
  ])
  rateLimit.resetPlaneRequestLanesForTests()
  return { commands, workItems, store, session }
}
