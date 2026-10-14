import type { PlaneApiFlavor } from '../../../shared/plane-types'
import { planeHtmlResponse, planeJsonResponse } from './plane-http-module'

// A fake Plane API in the shape Plane serves it, for Cloud and self-hosted bases alike.

export const PLANE_FIXTURE_TOKEN = 'plane_api_fixture0123456789abcdef'
export const PLANE_FIXTURE_SLUG = 'acme'
export const PLANE_FIXTURE_VIEWER = {
  id: '5d6b6c1e-7c3f-4f8e-9a51-1c2d3e4f5a6b',
  display_name: 'ada',
  first_name: 'Ada',
  email: 'ada@example.test'
}

export const PLANE_FIXTURE_BASES = [
  { name: 'Plane Cloud', hostKind: 'cloud', apiBaseUrl: 'https://api.plane.so', serverUrl: '' },
  {
    name: 'self-hosted with a path prefix',
    hostKind: 'self-hosted',
    apiBaseUrl: 'https://plane.example.test/plane',
    serverUrl: 'https://plane.example.test/plane'
  }
] as const

export type PlaneFixtureBase = (typeof PLANE_FIXTURE_BASES)[number]

export function planeConnectParams(base: PlaneFixtureBase) {
  return base.hostKind === 'cloud'
    ? {
        hostKind: 'cloud' as const,
        workspaceSlug: PLANE_FIXTURE_SLUG,
        apiToken: PLANE_FIXTURE_TOKEN
      }
    : {
        hostKind: 'self-hosted' as const,
        serverUrl: base.serverUrl,
        workspaceSlug: PLANE_FIXTURE_SLUG,
        apiToken: PLANE_FIXTURE_TOKEN
      }
}

export function fixtureUuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
}

export function rawPlaneProject(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: fixtureUuid(n),
    name: `Project ${n}`,
    identifier: `P${n}`,
    archived_at: null,
    is_member: true,
    ...extra
  }
}

export type PlaneFixtureRequest = { method: string; path: string; search: string; body?: unknown }

export type PlaneFixtureRoute = (
  request: PlaneFixtureRequest
) => Response | undefined | Promise<Response | undefined>

export type PlaneApiFixture = {
  apiBaseUrl: string
  projects: Record<string, unknown>[]
  flavor: PlaneApiFlavor
  /** Status to answer for any path containing the key. */
  failures: Map<string, number>
  routes: PlaneFixtureRoute[]
  requests: PlaneFixtureRequest[]
  fetch: (url: string, init?: RequestInit) => Promise<Response>
}

function envelope(results: unknown[]) {
  return { results, next_cursor: null, next_page_results: false, total_results: results.length }
}

function readBody(init?: RequestInit): unknown {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
}

export function createPlaneApiFixture(apiBaseUrl: string): PlaneApiFixture {
  const fixture: PlaneApiFixture = {
    apiBaseUrl,
    projects: [rawPlaneProject(1), rawPlaneProject(2)],
    flavor: 'work-items',
    failures: new Map(),
    routes: [],
    requests: [],
    fetch: async (url, init) => {
      const prefix = `${apiBaseUrl}/api/v1`
      if (!url.startsWith(prefix)) {
        return planeHtmlResponse(404)
      }
      const parsed = new URL(url)
      const request: PlaneFixtureRequest = {
        method: init?.method ?? 'GET',
        path: parsed.pathname.slice(new URL(prefix).pathname.length),
        search: parsed.search,
        body: readBody(init)
      }
      fixture.requests.push(request)
      if (new Headers(init?.headers).get('x-api-key') !== PLANE_FIXTURE_TOKEN) {
        return planeJsonResponse({ detail: 'Invalid token' }, { status: 401 })
      }
      for (const [key, status] of fixture.failures) {
        if (request.path.includes(key)) {
          return planeJsonResponse({ detail: 'failure' }, { status })
        }
      }
      for (const route of fixture.routes) {
        const response = await route(request)
        if (response) {
          return response
        }
      }
      return defaultRoute(fixture, request)
    }
  }
  return fixture
}

function defaultRoute(fixture: PlaneApiFixture, request: PlaneFixtureRequest): Response {
  const ws = `/workspaces/${PLANE_FIXTURE_SLUG}`
  if (request.path === '/users/me/') {
    return planeJsonResponse(PLANE_FIXTURE_VIEWER)
  }
  if (request.path === `${ws}/projects/`) {
    return planeJsonResponse(envelope(fixture.projects))
  }
  if (request.path.startsWith('/workspaces/') && !request.path.startsWith(`${ws}/`)) {
    return planeJsonResponse({ detail: 'Not found.' }, { status: 404 })
  }
  const list = /^\/workspaces\/[^/]+\/projects\/([^/]+)\/(work-items|issues)\/$/.exec(request.path)
  if (list) {
    if (list[2] !== fixture.flavor) {
      return planeHtmlResponse(404)
    }
    const known = fixture.projects.some((project) => project.id === list[1])
    return known
      ? planeJsonResponse(envelope([]))
      : planeJsonResponse({ detail: 'Not found.' }, { status: 404 })
  }
  return planeHtmlResponse(404)
}
