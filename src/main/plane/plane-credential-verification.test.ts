import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPlaneApiFixture,
  PLANE_FIXTURE_BASES,
  PLANE_FIXTURE_TOKEN,
  PLANE_FIXTURE_VIEWER,
  planeConnectParams,
  type PlaneApiFixture
} from './__mocks__/plane-api-fixture'
import { loadPlaneMainModule, planeHtmlResponse } from './__mocks__/plane-http-module'

let tempHome = ''

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'orca-plane-verify-'))
})

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true })
})

const nothingSaved = () =>
  !existsSync(join(tempHome, '.orca', 'plane-connections.json')) &&
  !existsSync(join(tempHome, '.orca', 'plane-tokens'))

describe.each(PLANE_FIXTURE_BASES)('Plane connect verification on $name', (base) => {
  let fixture: PlaneApiFixture
  let plane: Awaited<ReturnType<typeof loadPlaneMainModule>>

  beforeEach(async () => {
    fixture = createPlaneApiFixture(base.apiBaseUrl)
    plane = await loadPlaneMainModule(vi.fn(fixture.fetch), tempHome)
  })

  it('checks the viewer, the workspace and the API flavor, then saves', async () => {
    const result = await plane.commands.planeConnect(planeConnectParams(base))
    expect(result).toMatchObject({
      ok: true,
      projects: [{ identifier: 'P1' }, { identifier: 'P2' }],
      status: {
        connected: true,
        connection: {
          hostKind: base.hostKind,
          apiBaseUrl: base.apiBaseUrl,
          workspaceSlug: 'acme',
          viewer: { id: PLANE_FIXTURE_VIEWER.id, displayName: 'ada', email: 'ada@example.test' },
          projectScope: null
        }
      }
    })
    expect(fixture.requests.map((r) => r.path)).toEqual([
      '/users/me/',
      '/workspaces/acme/projects/',
      `/workspaces/acme/projects/${String(fixture.projects[0].id)}/work-items/`
    ])
    expect(JSON.stringify(result)).not.toContain(PLANE_FIXTURE_TOKEN)
  })

  it('saves nothing for a slug the token cannot reach', async () => {
    const result = await plane.commands.planeConnect({
      ...planeConnectParams(base),
      workspaceSlug: 'other'
    })
    expect(result).toEqual({
      ok: false,
      error: 'workspace_not_found',
      message: expect.any(String),
      field: 'workspaceSlug'
    })
    expect(nothingSaved()).toBe(true)
  })

  it.each([
    ['/users/me/', 401, 'auth', 'apiToken'],
    ['/projects/', 403, 'workspace_not_found', 'workspaceSlug'],
    ['/users/me/', 502, 'network', undefined],
    ['/work-items/', 403, 'forbidden', undefined]
  ])('maps HTTP %s %i to %s', async (path, status, error, field) => {
    fixture.failures.set(path, status)
    const result = await plane.commands.planeConnect(planeConnectParams(base))
    expect(result).toMatchObject({ ok: false, error })
    expect(result.ok ? null : result.field).toBe(field)
    expect(JSON.stringify(result)).not.toContain(PLANE_FIXTURE_TOKEN)
    expect(nothingSaved()).toBe(true)
  })

  it('reports the web app answering instead of the API', async () => {
    fixture.routes.push(() => planeHtmlResponse(200))
    await expect(plane.commands.planeConnect(planeConnectParams(base))).resolves.toMatchObject({
      ok: false,
      error: 'invalid_response'
    })
    expect(nothingSaved()).toBe(true)
  })

  it('detects the older issues flavor', async () => {
    fixture.flavor = 'issues'
    await expect(plane.commands.planeConnect(planeConnectParams(base))).resolves.toMatchObject({
      ok: true
    })
    expect(fixture.requests.at(-1)?.path).toMatch(/\/issues\/$/)
  })

  it('connects a workspace with no projects yet', async () => {
    fixture.projects = []
    await expect(plane.commands.planeConnect(planeConnectParams(base))).resolves.toMatchObject({
      ok: true,
      projects: []
    })
  })
})

describe('Plane connect URL checks', () => {
  let fixture: PlaneApiFixture
  let plane: Awaited<ReturnType<typeof loadPlaneMainModule>>

  beforeEach(async () => {
    fixture = createPlaneApiFixture('http://10.0.0.5:8080')
    plane = await loadPlaneMainModule(vi.fn(fixture.fetch), tempHome)
  })

  const params = {
    hostKind: 'self-hosted' as const,
    serverUrl: 'http://10.0.0.5:8080',
    workspaceSlug: 'acme',
    apiToken: PLANE_FIXTURE_TOKEN
  }

  it('refuses plain http until the user confirms, without sending the token', async () => {
    await expect(plane.commands.planeConnect(params)).resolves.toMatchObject({
      ok: false,
      error: 'insecure_http_unconfirmed',
      field: 'serverUrl'
    })
    expect(fixture.requests).toEqual([])
    await expect(
      plane.commands.planeConnect({ ...params, insecureHttpAcknowledged: true })
    ).resolves.toMatchObject({
      ok: true,
      status: { connection: { insecureHttpAcknowledged: true } }
    })
  })

  it('rejects a URL it cannot use', async () => {
    await expect(
      plane.commands.planeConnect({ ...params, serverUrl: 'ftp://plane.example.test' })
    ).resolves.toMatchObject({ ok: false, error: 'unsupported_protocol', field: 'serverUrl' })
    expect(fixture.requests).toEqual([])
  })
})
