import { create } from 'zustand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaneConnection, PlaneConnectionStatus } from '../../../../shared/plane-types'
import type { TaskProvider } from '../../../../shared/task-providers'
import type { AppState } from '../types'
import { DEFAULT_PLANE_WORK_ITEM_FILTERS, createPlaneSlice } from './plane'

function connection(id: string, workspaceSlug: string): PlaneConnection {
  return {
    id,
    hostKind: 'cloud',
    apiBaseUrl: 'https://api.plane.so',
    webBaseUrl: 'https://app.plane.so',
    workspaceSlug,
    viewer: { id: 'viewer-1', displayName: 'Ada', email: null },
    projectScope: null,
    connectedAt: 1
  }
}

function statusOf(...connections: PlaneConnection[]): PlaneConnectionStatus {
  return {
    connected: true,
    credentialProtection: 'sealed',
    connection: connections[0],
    connections: connections.map((c) => ({ connection: c, credentialProtection: 'sealed' }))
  }
}

const ACME = connection('conn-1', 'acme')
const BETA = connection('conn-2', 'beta')
const CONNECTED = statusOf(ACME)
const connectedResult = (
  status: PlaneConnectionStatus,
  conn: PlaneConnection,
  projects: unknown[]
) => ({
  ok: true,
  status,
  connection: conn,
  projects
})
const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Web', identifier: 'WEB' }

const plane = {
  status: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  setProjectScope: vi.fn(),
  listProjects: vi.fn()
}

const updateSettings = vi.fn()

function createTestStore(visibleTaskProviders: TaskProvider[] | null = null) {
  const settings = visibleTaskProviders ? { visibleTaskProviders } : null
  return create<AppState>()((...args) => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Plane actions read only settings, updateSettings and the fully initialized Plane slice.
    return { settings, updateSettings, ...createPlaneSlice(...args) } as unknown as AppState
  })
}

beforeEach(() => {
  updateSettings.mockReset().mockResolvedValue(undefined)
  for (const fn of Object.values(plane)) {
    fn.mockReset()
  }
  vi.stubGlobal('window', { api: { plane } })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('plane slice', () => {
  it('stores the connected status and projects without ever holding the token', async () => {
    plane.connect.mockResolvedValue(connectedResult(CONNECTED, ACME, [PROJECT]))
    const store = createTestStore()

    await store.getState().connectPlane({
      hostKind: 'cloud',
      workspaceSlug: 'acme',
      apiToken: 'plane_api_secret'
    })

    const state = store.getState()
    expect(state.planeStatus).toEqual(CONNECTED)
    expect(state.planeProjectsByConnection).toEqual({ 'conn-1': [PROJECT] })
    expect(state.planeStatusContextKey).toBe(state.planeProjectsContextKey)
    expect(JSON.stringify(state)).not.toContain('plane_api_secret')
  })

  it('reads a missing Plane bridge as disconnected', async () => {
    plane.status.mockResolvedValue(undefined)
    const store = createTestStore()

    await store.getState().checkPlaneConnection()

    expect(store.getState()).toMatchObject({
      planeStatus: { connected: false },
      planeStatusChecked: true,
      planeStatusIssue: null
    })
  })

  it('records an unreachable host as an issue instead of throwing', async () => {
    plane.status.mockRejectedValue(new Error('socket closed'))
    const store = createTestStore()

    await store.getState().checkPlaneConnection()

    expect(store.getState().planeStatusIssue).toBe('runtime_error')
  })

  it('returns a client error kind when connect cannot reach the host', async () => {
    plane.connect.mockRejectedValue(new Error('socket closed'))
    const store = createTestStore()

    await expect(
      store.getState().connectPlane({ hostKind: 'cloud', workspaceSlug: 'acme', apiToken: 't' })
    ).resolves.toEqual({ ok: false, error: 'runtime_error', message: 'socket closed' })
  })

  it('clears projects on disconnect', async () => {
    plane.connect.mockResolvedValue(connectedResult(CONNECTED, ACME, [PROJECT]))
    plane.disconnect.mockResolvedValue({ connected: false })
    const store = createTestStore()
    await store.getState().connectPlane({ hostKind: 'cloud', workspaceSlug: 'acme', apiToken: 't' })

    await store.getState().disconnectPlane()

    expect(store.getState()).toMatchObject({
      planeStatus: { connected: false },
      planeProjectsByConnection: {}
    })
  })

  it('shows Plane in Tasks after the first successful connect', async () => {
    plane.connect.mockResolvedValue(connectedResult(CONNECTED, ACME, []))
    const store = createTestStore(['github', 'jira'])

    await store.getState().connectPlane({ hostKind: 'cloud', workspaceSlug: 'acme', apiToken: 't' })

    expect(updateSettings).toHaveBeenCalledWith({
      visibleTaskProviders: ['github', 'jira', 'plane']
    })
  })

  it('leaves a saved provider list alone when Plane is already there or the connect fails', async () => {
    plane.connect.mockResolvedValue(connectedResult(CONNECTED, ACME, []))
    const listed = createTestStore(['plane', 'github'])
    await listed
      .getState()
      .connectPlane({ hostKind: 'cloud', workspaceSlug: 'acme', apiToken: 't' })

    plane.connect.mockResolvedValue({ ok: false, error: 'auth', message: 'Invalid token' })
    const failed = createTestStore(['github', 'jira'])
    await failed
      .getState()
      .connectPlane({ hostKind: 'cloud', workspaceSlug: 'acme', apiToken: 't' })

    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('keeps projects per workspace and drops only a removed workspace', async () => {
    const both = statusOf(ACME, BETA)
    plane.connect
      .mockResolvedValueOnce(connectedResult(CONNECTED, ACME, [PROJECT]))
      .mockResolvedValueOnce(connectedResult(both, BETA, []))
    plane.disconnect.mockResolvedValue(statusOf(BETA))
    const store = createTestStore()
    await store.getState().connectPlane({ hostKind: 'cloud', workspaceSlug: 'acme', apiToken: 't' })
    await store
      .getState()
      .connectPlane({ reuseTokenFromConnectionId: 'conn-1', workspaceSlug: 'beta' })
    expect(store.getState().planeProjectsByConnection).toEqual({
      'conn-1': [PROJECT],
      'conn-2': []
    })

    await store.getState().disconnectPlane('conn-1')

    expect(plane.disconnect).toHaveBeenCalledWith({ connectionId: 'conn-1' })
    expect(store.getState().planeProjectsByConnection).toEqual({ 'conn-2': [] })
    expect(store.getState().planeStatus).toMatchObject({ connection: { id: 'conn-2' } })
  })

  it('sends the connection id with scope and project calls', async () => {
    plane.setProjectScope.mockResolvedValue({ ok: true, value: statusOf(ACME, BETA) })
    plane.listProjects.mockResolvedValue({ ok: true, value: [PROJECT] })
    const store = createTestStore()

    await store.getState().setPlaneProjectScope({ mode: 'all' }, 'conn-2')
    await store.getState().loadPlaneProjects({ refresh: true, connectionId: 'conn-2' })

    expect(plane.setProjectScope).toHaveBeenCalledWith({
      scope: { mode: 'all' },
      connectionId: 'conn-2'
    })
    expect(plane.listProjects).toHaveBeenCalledWith({ refresh: true, connectionId: 'conn-2' })
    expect(store.getState().planeProjectsByConnection['conn-2']).toEqual([PROJECT])
  })

  it('keeps work-item filters per connection', () => {
    const store = createTestStore()

    store.getState().setPlaneWorkItemFilters('conn-1', { priority: 'high' })
    store.getState().setPlaneWorkItemFilters('conn-2', { text: 'login' })

    expect(store.getState().planeWorkItemFiltersByConnection).toEqual({
      'conn-1': { ...DEFAULT_PLANE_WORK_ITEM_FILTERS, priority: 'high' },
      'conn-2': { ...DEFAULT_PLANE_WORK_ITEM_FILTERS, text: 'login' }
    })
  })
})
