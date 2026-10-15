// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PlaneConnection,
  PlaneConnectionStatus,
  PlaneProject,
  PlaneWorkItem,
  PlaneWorkItemList
} from '../../../../../shared/plane-types'
import { getEnvironmentRuntimeContextKey } from '@/lib/provider-runtime-context'
import type { PlaneWorkItemFilters } from '@/store/slices/plane-slice-contract'
import { TaskPagePlaneContent } from './TaskPagePlaneContent'

const CONTEXT_KEY = getEnvironmentRuntimeContextKey(null)

type FixtureState = {
  runtimeEnvironments: { id: string; name: string }[]
  planeStatus: PlaneConnectionStatus
  planeStatusChecked: boolean
  planeStatusContextKey: string | null
  planeProjectsByConnection: Record<string, PlaneProject[]>
  planeProjectsContextKey: string | null
  planeWorkItemFiltersByConnection: Record<string, PlaneWorkItemFilters>
  checkPlaneConnection: ReturnType<typeof vi.fn>
  loadPlaneProjects: ReturnType<typeof vi.fn>
  setPlaneWorkItemFilters: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => {
  const holder: { current: FixtureState | null } = { current: null }
  return {
    holder,
    listWorkItems: vi.fn(),
    lookupWorkItem: vi.fn(),
    listComments: vi.fn(),
    getWorkItem: vi.fn()
  }
})
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: FixtureState) => unknown) => {
    if (!mocks.holder.current) {
      throw new Error('Store state was not installed')
    }
    return selector(mocks.holder.current)
  }
}))
vi.mock('@/runtime/runtime-plane-client', () => ({
  planeListWorkItemsForTarget: mocks.listWorkItems,
  planeListStatesForTarget: vi.fn().mockResolvedValue({ ok: true, value: [] }),
  planeLookupWorkItemForTarget: mocks.lookupWorkItem,
  planeGetWorkItemForTarget: mocks.getWorkItem,
  planeListCommentsForTarget: mocks.listComments,
  isPlaneRuntimeUpdateRequiredError: () => false
}))
vi.mock('@/components/plane/PlaneConnectDialog', () => ({
  PlaneConnectDialog: ({ open, mode }: { open: boolean; mode: string }) =>
    open ? <div data-testid="plane-dialog">{mode}</div> : null
}))

const WEB: PlaneProject = { id: 'web', name: 'Web', identifier: 'WEB' }
const API: PlaneProject = { id: 'api', name: 'API', identifier: 'API' }

const CONNECTION: PlaneConnection = {
  id: 'conn-1',
  hostKind: 'self-hosted',
  apiBaseUrl: 'https://plane.example.com',
  webBaseUrl: 'https://plane.example.com',
  workspaceSlug: 'acme',
  viewer: { id: 'viewer-1', displayName: 'Ada', email: null },
  projectScope: { mode: 'all' },
  connectedAt: 1
}

function workItem(id: string, overrides: Partial<PlaneWorkItem> = {}): PlaneWorkItem {
  return {
    connectionId: 'conn-1',
    id,
    projectId: 'web',
    projectIdentifier: 'WEB',
    sequenceId: Number(id),
    identifier: `WEB-${id}`,
    name: `Item ${id}`,
    state: { id: 's', name: 'In Progress', group: 'started', color: '', sequence: 1 },
    priority: 'none',
    assignees: [],
    labels: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    url: `https://plane.example.com/acme/projects/web/issues/${id}`,
    ...overrides
  }
}

function listResult(items: PlaneWorkItem[], extra: Partial<PlaneWorkItemList> = {}) {
  return {
    ok: true,
    value: {
      items,
      errors: [],
      missingProjectIds: [],
      truncatedProjectIds: [],
      totalCapped: false,
      ...extra
    }
  }
}

function install(planeStatus: PlaneConnectionStatus, overrides: Partial<FixtureState> = {}) {
  mocks.holder.current = {
    runtimeEnvironments: [],
    planeStatus,
    planeStatusChecked: true,
    planeStatusContextKey: CONTEXT_KEY,
    planeProjectsByConnection: { [CONNECTION.id]: [WEB, API] },
    planeProjectsContextKey: CONTEXT_KEY,
    planeWorkItemFiltersByConnection: {},
    checkPlaneConnection: vi.fn(),
    loadPlaneProjects: vi.fn(),
    setPlaneWorkItemFilters: vi.fn(),
    ...overrides
  }
}

const connected = (connection: PlaneConnection = CONNECTION): PlaneConnectionStatus => ({
  connected: true,
  connection,
  credentialProtection: 'sealed',
  connections: [{ connection, credentialProtection: 'sealed' }]
})

beforeEach(() => {
  mocks.listWorkItems.mockReset()
  mocks.lookupWorkItem.mockReset()
  mocks.getWorkItem
    .mockReset()
    .mockResolvedValue({ ok: false, error: { kind: 'network', message: '' } })
  mocks.listComments.mockReset().mockResolvedValue({ ok: true, value: [] })
})
afterEach(cleanup)

describe('TaskPagePlaneContent states', () => {
  it('offers to connect or hide when Plane is not connected', () => {
    install({ connected: false })
    const onHide = vi.fn()
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={onHide} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect Plane' }))
    expect(screen.getByTestId('plane-dialog').textContent).toBe('connect')
    fireEvent.click(screen.getByRole('button', { name: 'Hide Plane' }))
    expect(onHide).toHaveBeenCalledOnce()
    expect(mocks.listWorkItems).not.toHaveBeenCalled()
  })

  it('asks for projects when the connection has no usable scope', () => {
    install(connected({ ...CONNECTION, projectScope: null }))
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose projects' }))
    expect(screen.getByTestId('plane-dialog').textContent).toBe('editScope')
    expect(mocks.listWorkItems).not.toHaveBeenCalled()
  })

  it('asks to reconnect when the saved token cannot be read', () => {
    install({ ...connected(), credentialError: 'unreadable' })
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect Plane' }))
    expect(screen.getByTestId('plane-dialog').textContent).toBe('connect')
  })

  it('asks to reconnect when Plane rejects the token', async () => {
    install(connected())
    mocks.listWorkItems.mockResolvedValue({ ok: false, error: { kind: 'auth', message: 'x' } })
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reconnect Plane' })).toBeTruthy()
    )
  })

  it('shows a spinner while loading, then the list', async () => {
    install(connected())
    let resolve: (value: unknown) => void = () => {}
    mocks.listWorkItems.mockReturnValue(new Promise((done) => (resolve = done)))
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    expect(screen.queryByRole('list')).toBeNull()
    resolve(listResult([workItem('12', { name: 'Fix login redirect' })]))
    await waitFor(() => expect(screen.getByText('Fix login redirect')).toBeTruthy())
    expect(screen.getByText('WEB-12')).toBeTruthy()
    expect(screen.getByText('1 shown')).toBeTruthy()
  })

  it('says when the chosen projects have no work items', async () => {
    install(connected())
    mocks.listWorkItems.mockResolvedValue(listResult([]))
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText('No work items in the chosen projects.')).toBeTruthy()
    )
  })

  it('offers to clear filters that hide every loaded item', async () => {
    install(connected(), {
      planeWorkItemFiltersByConnection: {
        'conn-1': {
          projectId: null,
          stateGroups: ['completed'],
          stateId: null,
          assignee: 'anyone',
          priority: 'any',
          text: ''
        }
      }
    })
    mocks.listWorkItems.mockResolvedValue(listResult([workItem('1')]))
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('No work items match these filters.')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(mocks.holder.current?.setPlaneWorkItemFilters).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({ stateGroups: ['backlog', 'unstarted', 'started'] })
    )
  })

  it('switches to the project prompt when the host reports the scope is gone', async () => {
    install(connected())
    mocks.listWorkItems.mockResolvedValue(listResult([], { needsScope: true }))
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Choose Plane projects')).toBeTruthy())
  })
})

describe('TaskPagePlaneContent banners', () => {
  it('names the project that failed and why', async () => {
    install(connected())
    mocks.listWorkItems.mockResolvedValue(
      listResult([workItem('1')], { errors: [{ projectId: 'api', kind: 'forbidden' }] })
    )
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    await waitFor(() =>
      expect(
        screen.getByText('API could not be loaded: This token cannot access that Plane workspace.')
      ).toBeTruthy()
    )
  })

  it('reports missing selected projects with an Edit projects action', async () => {
    install(
      connected({ ...CONNECTION, projectScope: { mode: 'selected', projectIds: ['web', 'gone'] } })
    )
    mocks.listWorkItems.mockResolvedValue(
      listResult([workItem('1')], { missingProjectIds: ['gone'] })
    )
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText('1 selected project is no longer available.')).toBeTruthy()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit projects' }))
    expect(screen.getByTestId('plane-dialog').textContent).toBe('editScope')
  })

  it('loads more of a truncated project and says when the total is capped', async () => {
    install(connected())
    mocks.listWorkItems.mockResolvedValueOnce(
      listResult([workItem('1')], {
        truncatedProjectIds: ['web'],
        nextCursorByProject: { web: '100:1:0' },
        totalCapped: true
      })
    )
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText('Showing the newest work items in Web.')).toBeTruthy()
    )
    expect(
      screen.getByText('Showing the first 500 work items. Choose one project to see more.')
    ).toBeTruthy()
    mocks.listWorkItems.mockResolvedValueOnce(listResult([workItem('2')]))
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(screen.getByText('Item 2')).toBeTruthy())
  })
})

describe('TaskPagePlaneContent row menu', () => {
  it('opens a context menu with Change state and Open in Plane', async () => {
    install(connected())
    mocks.listWorkItems.mockResolvedValue(listResult([workItem('12', { name: 'Fix login' })]))
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Fix login')).toBeTruthy())

    fireEvent.contextMenu(screen.getByText('Fix login'))

    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Change state' })).toBeTruthy())
    expect(screen.getByRole('menuitem', { name: 'Open in Plane' })).toBeTruthy()
  })
})

describe('TaskPagePlaneContent identifier jump', () => {
  it('looks up an identifier the list has not loaded and opens its detail', async () => {
    install(connected(), {
      planeWorkItemFiltersByConnection: {
        'conn-1': {
          projectId: null,
          stateGroups: ['backlog', 'unstarted', 'started'],
          stateId: null,
          assignee: 'anyone',
          priority: 'any',
          text: 'WEB-99'
        }
      }
    })
    mocks.listWorkItems.mockResolvedValue(listResult([workItem('1')]))
    mocks.lookupWorkItem.mockResolvedValue({
      ok: true,
      value: { ...workItem('99', { name: 'Deep link' }), descriptionText: 'Body', truncated: false }
    })
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('No work items match these filters.')).toBeTruthy())
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search work items' }), { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('Deep link')).toBeTruthy())
    expect(mocks.lookupWorkItem).toHaveBeenCalledWith({ kind: 'local' }, 'WEB-99', 'conn-1')
  })

  it('says when the identifier does not exist', async () => {
    install(connected(), {
      planeWorkItemFiltersByConnection: {
        'conn-1': {
          projectId: null,
          stateGroups: [],
          stateId: null,
          assignee: 'anyone',
          priority: 'any',
          text: 'WEB-404'
        }
      }
    })
    mocks.listWorkItems.mockResolvedValue(listResult([]))
    mocks.lookupWorkItem.mockResolvedValue({ ok: false, error: { kind: 'not_found', message: '' } })
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText('No work items in the chosen projects.')).toBeTruthy()
    )
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search work items' }), { key: 'Enter' })
    await waitFor(() =>
      expect(screen.getByText('WEB-404 was not found in this workspace.')).toBeTruthy()
    )
  })
})
