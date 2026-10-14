import { create } from 'zustand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaneConnectionStatus } from '../../../../shared/plane-types'
import type { TaskProvider } from '../../../../shared/task-providers'
import type { AppState } from '../types'
import { DEFAULT_PLANE_WORK_ITEM_FILTERS, createPlaneSlice } from './plane'

const CONNECTED: PlaneConnectionStatus = {
  connected: true,
  credentialProtection: 'sealed',
  connection: {
    id: 'conn-1',
    hostKind: 'cloud',
    apiBaseUrl: 'https://api.plane.so',
    webBaseUrl: 'https://app.plane.so',
    workspaceSlug: 'acme',
    viewer: { id: 'viewer-1', displayName: 'Ada', email: null },
    projectScope: null,
    connectedAt: 1
  }
}
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
    plane.connect.mockResolvedValue({ ok: true, status: CONNECTED, projects: [PROJECT] })
    const store = createTestStore()

    await store.getState().connectPlane({
      hostKind: 'cloud',
      workspaceSlug: 'acme',
      apiToken: 'plane_api_secret'
    })

    const state = store.getState()
    expect(state.planeStatus).toEqual(CONNECTED)
    expect(state.planeProjects).toEqual([PROJECT])
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
    plane.connect.mockResolvedValue({ ok: true, status: CONNECTED, projects: [PROJECT] })
    plane.disconnect.mockResolvedValue({ connected: false })
    const store = createTestStore()
    await store.getState().connectPlane({ hostKind: 'cloud', workspaceSlug: 'acme', apiToken: 't' })

    await store.getState().disconnectPlane()

    expect(store.getState()).toMatchObject({ planeStatus: { connected: false }, planeProjects: [] })
  })

  it('shows Plane in Tasks after the first successful connect', async () => {
    plane.connect.mockResolvedValue({ ok: true, status: CONNECTED, projects: [] })
    const store = createTestStore(['github', 'jira'])

    await store.getState().connectPlane({ hostKind: 'cloud', workspaceSlug: 'acme', apiToken: 't' })

    expect(updateSettings).toHaveBeenCalledWith({
      visibleTaskProviders: ['github', 'jira', 'plane']
    })
  })

  it('leaves a saved provider list alone when Plane is already there or the connect fails', async () => {
    plane.connect.mockResolvedValue({ ok: true, status: CONNECTED, projects: [] })
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
