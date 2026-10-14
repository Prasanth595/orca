import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { credentialDecryptionMessage } from '../../shared/integration-credential-errors'
import {
  createPlaneApiFixture,
  PLANE_FIXTURE_BASES,
  PLANE_FIXTURE_TOKEN,
  planeConnectParams,
  fixtureUuid
} from './__mocks__/plane-api-fixture'
import { loadPlaneMainModule, type PlaneMainModuleOptions } from './__mocks__/plane-http-module'

let tempHome = ''

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'orca-plane-store-'))
})

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true })
})

const connectionsPath = () => join(tempHome, '.orca', 'plane-connections.json')
const tokenDir = () => join(tempHome, '.orca', 'plane-tokens')

describe.each(PLANE_FIXTURE_BASES)('Plane connection store on $name', (base) => {
  async function connect(options: PlaneMainModuleOptions = {}) {
    const fixture = createPlaneApiFixture(base.apiBaseUrl)
    const plane = await loadPlaneMainModule(vi.fn(fixture.fetch), tempHome, options)
    const result = await plane.commands.planeConnect(planeConnectParams(base))
    if (!result.ok || !result.status.connected) {
      throw new Error(`connect failed: ${JSON.stringify(result)}`)
    }
    return { plane, fixture, connection: result.status.connection }
  }

  it('seals the token, round-trips it and keeps both files owner-only', async () => {
    const { plane, connection } = await connect()
    const tokenPath = plane.store.getPlaneTokenPath(connection.id)
    expect(readFileSync(tokenPath).toString('utf-8')).not.toBe(PLANE_FIXTURE_TOKEN)
    expect(plane.store.readPlaneToken(connection.id)).toBe(PLANE_FIXTURE_TOKEN)
    expect(plane.commands.planeStatus()).toMatchObject({
      connected: true,
      credentialProtection: 'sealed'
    })
    if (process.platform !== 'win32') {
      expect(statSync(tokenPath).mode & 0o777).toBe(0o600)
      expect(statSync(connectionsPath()).mode & 0o777).toBe(0o600)
    }
    expect(readFileSync(connectionsPath(), 'utf-8')).not.toContain(PLANE_FIXTURE_TOKEN)
  })

  it('falls back to a plaintext token and says so', async () => {
    const { plane, connection } = await connect({ encryptionAvailable: false })
    const tokenPath = plane.store.getPlaneTokenPath(connection.id)
    expect(readFileSync(tokenPath, 'utf-8')).toBe(PLANE_FIXTURE_TOKEN)
    expect(plane.commands.planeStatus()).toMatchObject({ credentialProtection: 'plaintext' })
  })

  it('reports a token it cannot decrypt', async () => {
    const { plane, connection } = await connect()
    writeFileSync(plane.store.getPlaneTokenPath(connection.id), Buffer.from([0x00, 0x09, 0xfa]))
    expect(() => plane.session.getActivePlaneSession()).toThrow(
      credentialDecryptionMessage('Plane')
    )
    expect(plane.commands.planeStatus()).toMatchObject({
      connected: true,
      credentialError: credentialDecryptionMessage('Plane')
    })
  })

  it('names the token file with 24 characters', async () => {
    const { plane, connection } = await connect()
    expect(connection.id).toHaveLength(24)
    expect(plane.store.getPlaneTokenPath(connection.id)).toBe(
      join(tokenDir(), `${connection.id}.enc`)
    )
    expect(() => plane.store.getPlaneTokenPath('../../etc/passwd-aaaaaaaa')).toThrow()
  })

  it('removes the connection and its token on disconnect', async () => {
    const { plane, connection } = await connect()
    const tokenPath = plane.store.getPlaneTokenPath(connection.id)
    expect(plane.commands.planeDisconnect()).toEqual({ connected: false })
    expect(existsSync(tokenPath)).toBe(false)
    expect(JSON.parse(readFileSync(connectionsPath(), 'utf-8'))).toEqual({
      version: 1,
      activeConnectionId: null,
      connections: []
    })
  })

  it('keeps the saved scope when the same account reconnects', async () => {
    const { plane } = await connect()
    plane.commands.planeSetProjectScope({ scope: { mode: 'all' } })
    const again = await plane.commands.planeConnect(planeConnectParams(base))
    expect(again).toMatchObject({
      ok: true,
      status: { connection: { projectScope: { mode: 'all' } } }
    })
  })
})

describe('normalizePlaneConnectionFile', () => {
  async function loadStore() {
    const fixture = createPlaneApiFixture(PLANE_FIXTURE_BASES[0].apiBaseUrl)
    return (await loadPlaneMainModule(vi.fn(fixture.fetch), tempHome)).store
  }

  const id = 'abcdefghijklmnopqrstuvwx'
  const connection = (extra: Record<string, unknown> = {}) => ({
    id,
    hostKind: 'self-hosted',
    apiBaseUrl: 'https://plane.example.test/plane',
    webBaseUrl: 'https://plane.example.test/plane',
    workspaceSlug: 'acme',
    viewer: { id: 'viewer', displayName: 'Ada', email: null },
    projectScope: { mode: 'all' },
    connectedAt: 1,
    ...extra
  })
  const normalize = async (entry: unknown) =>
    (await loadStore()).normalizePlaneConnectionFile({ connections: [entry] }, () => true)

  it.each([
    [{ mode: 'selected', projectIds: [] }],
    [{ mode: 'selected', projectIds: ['not-a-uuid'] }],
    [{ mode: 'everything' }],
    [null]
  ])('reads the scope %j as "choose projects", never as all', async (projectScope) => {
    const file = await normalize(connection({ projectScope }))
    expect(file.connections[0].projectScope).toBeNull()
  })

  it('dedupes and lowercases a selected scope', async () => {
    const upper = fixtureUuid(1).toUpperCase()
    const file = await normalize(
      connection({ projectScope: { mode: 'selected', projectIds: [upper, fixtureUuid(1)] } })
    )
    expect(file.connections[0].projectScope).toEqual({
      mode: 'selected',
      projectIds: [fixtureUuid(1)]
    })
  })

  it.each([
    { id: '../x' },
    { apiBaseUrl: 'https://plane.example.test/plane/' },
    { apiBaseUrl: 'ftp://plane.example.test' },
    { webBaseUrl: 'https://u:p@plane.example.test' },
    { workspaceSlug: 'Acme' },
    { viewer: {} }
  ])('drops an invalid connection %j', async (extra) => {
    expect((await normalize(connection(extra))).connections).toEqual([])
  })

  it('drops connections whose token is gone', async () => {
    const store = await loadStore()
    mkdirSync(join(tempHome, '.orca'), { recursive: true })
    writeFileSync(
      connectionsPath(),
      JSON.stringify({ activeConnectionId: id, connections: [connection()] })
    )
    expect(store.readPlaneConnectionFile()).toEqual({
      version: 1,
      activeConnectionId: null,
      connections: []
    })
  })
})
