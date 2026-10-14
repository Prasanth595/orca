import { describe, expect, it, vi } from 'vitest'
import {
  createPlaneApiFixture,
  fixtureUuid,
  PLANE_FIXTURE_BASES,
  PLANE_FIXTURE_SLUG,
  PLANE_FIXTURE_TOKEN,
  PLANE_MISSING_ROUTE_BODY
} from './__mocks__/plane-api-fixture'
import {
  loadPlaneHttpModule,
  planeHtmlResponse,
  planeJsonResponse
} from './__mocks__/plane-http-module'

async function loadFlavor(fetch: (url: string, init?: RequestInit) => Promise<Response>) {
  await loadPlaneHttpModule(vi.fn(fetch))
  return import('./plane-api-flavor')
}

describe.each(PLANE_FIXTURE_BASES)('Plane API flavor on $name', (base) => {
  const target = { apiBaseUrl: base.apiBaseUrl, apiToken: PLANE_FIXTURE_TOKEN }
  const projectId = fixtureUuid(1)

  it("falls back to issues on Plane's JSON missing-route 404", async () => {
    const fixture = createPlaneApiFixture(base.apiBaseUrl)
    fixture.flavor = 'issues'
    fixture.routes.push(({ path }) =>
      path.endsWith('/work-items/')
        ? planeJsonResponse(PLANE_MISSING_ROUTE_BODY, { status: 404 })
        : undefined
    )
    const flavor = await loadFlavor(fixture.fetch)
    await expect(flavor.detectPlaneApiFlavor(target, PLANE_FIXTURE_SLUG, projectId)).resolves.toBe(
      'issues'
    )
  })

  it('falls back to issues on an HTML 404 from a proxy', async () => {
    const fixture = createPlaneApiFixture(base.apiBaseUrl)
    fixture.flavor = 'issues'
    fixture.routes.push(({ path }) =>
      path.endsWith('/work-items/') ? planeHtmlResponse(404) : undefined
    )
    const flavor = await loadFlavor(fixture.fetch)
    await expect(flavor.detectPlaneApiFlavor(target, PLANE_FIXTURE_SLUG, projectId)).resolves.toBe(
      'issues'
    )
  })

  it('prefers work-items and falls back to issues only for a missing route', async () => {
    const fixture = createPlaneApiFixture(base.apiBaseUrl)
    fixture.flavor = 'issues'
    const flavor = await loadFlavor(fixture.fetch)
    await expect(flavor.detectPlaneApiFlavor(target, PLANE_FIXTURE_SLUG, projectId)).resolves.toBe(
      'issues'
    )
    expect(fixture.requests.map((r) => r.path.split('/').at(-2))).toEqual(['work-items', 'issues'])
  })

  it('does not decide on a 404 for a missing object', async () => {
    const fixture = createPlaneApiFixture(base.apiBaseUrl)
    const flavor = await loadFlavor(fixture.fetch)
    await expect(
      flavor.detectPlaneApiFlavor(target, PLANE_FIXTURE_SLUG, fixtureUuid(99))
    ).rejects.toMatchObject({ kind: 'not_found', routeMissing: false })
    expect(fixture.requests).toHaveLength(1)
  })

  it('does not decide on a permission error', async () => {
    const fixture = createPlaneApiFixture(base.apiBaseUrl)
    fixture.failures.set('/work-items/', 403)
    const flavor = await loadFlavor(fixture.fetch)
    await expect(
      flavor.detectPlaneApiFlavor(target, PLANE_FIXTURE_SLUG, projectId)
    ).rejects.toMatchObject({ kind: 'forbidden' })
  })

  it('caches the answer per connection', async () => {
    const fetch = vi.fn(async () => planeJsonResponse([]))
    const flavor = await loadFlavor(fetch)
    await flavor.resolvePlaneApiFlavor('a', target, PLANE_FIXTURE_SLUG, projectId)
    await flavor.resolvePlaneApiFlavor('a', target, PLANE_FIXTURE_SLUG, projectId)
    expect(fetch).toHaveBeenCalledTimes(1)
    flavor.rememberPlaneApiFlavor('b', 'issues')
    await expect(
      flavor.resolvePlaneApiFlavor('b', target, PLANE_FIXTURE_SLUG, projectId)
    ).resolves.toBe('issues')
    expect(flavor.cachedPlaneApiFlavor('a')).toBe('work-items')
    flavor.forgetPlaneApiFlavor('a')
    expect(flavor.cachedPlaneApiFlavor('a')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
