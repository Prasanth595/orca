import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaneConnectResult, PlaneConnectionStatus } from '../../shared/plane-types'
import {
  createPlaneApiFixture,
  PLANE_FIXTURE_BASES,
  PLANE_FIXTURE_TOKEN,
  planeConnectParams,
  type PlaneApiFixture
} from './__mocks__/plane-api-fixture'
import { loadPlaneMainModule } from './__mocks__/plane-http-module'

function connectedId(result: PlaneConnectResult): string {
  if (!result.ok) {
    throw new Error(`connect failed: ${result.error}`)
  }
  return result.connection.id
}

function slugs(status: PlaneConnectionStatus): string[] {
  return status.connected ? status.connections.map((e) => e.connection.workspaceSlug) : []
}

describe.each(PLANE_FIXTURE_BASES)('several Plane workspaces on $name', (base) => {
  let tempHome = ''
  let fixture: PlaneApiFixture
  let plane: Awaited<ReturnType<typeof loadPlaneMainModule>>

  beforeEach(async () => {
    tempHome = mkdtempSync(join(tmpdir(), 'orca-plane-multi-'))
    fixture = createPlaneApiFixture(base.apiBaseUrl)
    fixture.workspaceSlugs.add('beta')
    plane = await loadPlaneMainModule(vi.fn(fixture.fetch), tempHome)
  })

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true })
  })

  const connect = (workspaceSlug: string) =>
    plane.commands.planeConnect({ ...planeConnectParams(base), workspaceSlug })

  it('adds a second workspace without touching the first, and updates in place', async () => {
    const acme = connectedId(await connect('acme'))
    plane.commands.planeSetProjectScope({ scope: { mode: 'all' } })
    const beta = connectedId(await connect('beta'))
    expect(beta).not.toBe(acme)
    const status = plane.commands.planeStatus()
    expect(slugs(status)).toEqual(['acme', 'beta'])
    expect(status).toMatchObject({ connected: true, connection: { id: acme } })

    const again = await connect('acme')
    expect(again).toMatchObject({
      ok: true,
      connection: { id: acme, projectScope: { mode: 'all' } }
    })
    expect(slugs(plane.commands.planeStatus())).toEqual(['acme', 'beta'])
  })

  it('reuses a saved token on the host and never returns it', async () => {
    const acme = connectedId(await connect('acme'))
    fixture.requests.length = 0
    const result = await plane.commands.planeConnect({
      reuseTokenFromConnectionId: acme,
      workspaceSlug: 'beta'
    })
    expect(result).toMatchObject({
      ok: true,
      connection: { workspaceSlug: 'beta', apiBaseUrl: base.apiBaseUrl, hostKind: base.hostKind }
    })
    expect(JSON.stringify(result)).not.toContain(PLANE_FIXTURE_TOKEN)
    expect(JSON.stringify(plane.commands.planeStatus())).not.toContain(PLANE_FIXTURE_TOKEN)
    expect(fixture.requests.map((r) => r.path)).toContain('/workspaces/beta/projects/')
    expect(plane.store.readPlaneToken(connectedId(result))).toBe(PLANE_FIXTURE_TOKEN)
  })

  it('reports an unknown source connection or slug for that workspace only', async () => {
    const acme = connectedId(await connect('acme'))
    await expect(
      plane.commands.planeConnect({
        reuseTokenFromConnectionId: 'zzzzzzzzzzzzzzzzzzzzzzzz',
        workspaceSlug: 'beta'
      })
    ).resolves.toMatchObject({ ok: false, error: 'not_connected' })
    await expect(
      plane.commands.planeConnect({ reuseTokenFromConnectionId: acme, workspaceSlug: 'nope' })
    ).resolves.toMatchObject({ ok: false, error: 'workspace_unavailable', field: 'workspaceSlug' })
    expect(slugs(plane.commands.planeStatus())).toEqual(['acme'])
  })

  it('removes one workspace and keeps the rest, then removes all', async () => {
    const acme = connectedId(await connect('acme'))
    const beta = connectedId(await connect('beta'))
    const status = plane.commands.planeDisconnect({ connectionId: acme })
    expect(status).toMatchObject({ connected: true, connection: { id: beta } })
    expect(slugs(status)).toEqual(['beta'])
    expect(existsSync(plane.store.getPlaneTokenPath(acme))).toBe(false)
    expect(plane.store.readPlaneToken(beta)).toBe(PLANE_FIXTURE_TOKEN)
    expect(plane.commands.planeDisconnect()).toEqual({ connected: false })
  })

  it('scopes projects and work items to the named workspace', async () => {
    await connect('acme')
    const beta = connectedId(await connect('beta'))
    plane.commands.planeSetProjectScope({ scope: { mode: 'all' }, connectionId: beta })
    const status = plane.commands.planeStatus()
    const scopes = status.connected
      ? status.connections.map((e) => [e.connection.workspaceSlug, e.connection.projectScope])
      : []
    expect(scopes).toEqual([
      ['acme', null],
      ['beta', { mode: 'all' }]
    ])
    fixture.requests.length = 0
    await plane.commands.planeListProjects({ refresh: true, connectionId: beta })
    await plane.workItems.planeListWorkItems({ connectionId: beta })
    expect(fixture.requests.every((r) => r.path.startsWith('/workspaces/beta/'))).toBe(true)
  })
})
