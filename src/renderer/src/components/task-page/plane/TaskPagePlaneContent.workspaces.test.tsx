// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PlaneConnection,
  PlaneConnectionEntry,
  PlaneConnectionStatus,
  PlaneProject,
  PlaneWorkItem
} from '../../../../../shared/plane-types'
import { getEnvironmentRuntimeContextKey } from '@/lib/provider-runtime-context'
import {
  DEFAULT_PLANE_WORK_ITEM_FILTERS,
  PLANE_ALL_WORKSPACES,
  type PlaneWorkItemFilters
} from '@/store/slices/plane-slice-contract'
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
  planeTasksWorkspaceId: string | null
  checkPlaneConnection: ReturnType<typeof vi.fn>
  loadPlaneProjects: ReturnType<typeof vi.fn>
  setPlaneWorkItemFilters: ReturnType<typeof vi.fn>
  setPlaneTasksWorkspaceId: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => {
  const holder: { current: FixtureState | null } = { current: null }
  return { holder, listWorkItems: vi.fn(), lookupWorkItem: vi.fn() }
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
  planeGetWorkItemForTarget: vi.fn().mockResolvedValue({ ok: false, error: { kind: 'network' } }),
  planeListCommentsForTarget: vi.fn().mockResolvedValue({ ok: true, value: [] }),
  isPlaneRuntimeUpdateRequiredError: () => false
}))
vi.mock('@/components/plane/PlaneConnectDialog', () => ({
  PlaneConnectDialog: (props: { open: boolean; mode: string; connectionId?: string }) =>
    props.open ? (
      <div data-testid="plane-dialog">{`${props.mode}:${props.connectionId}`}</div>
    ) : null
}))

function connection(id: string, slug: string, overrides: Partial<PlaneConnection> = {}) {
  const value: PlaneConnection = {
    id,
    hostKind: 'self-hosted',
    apiBaseUrl: 'https://plane.example.com',
    webBaseUrl: 'https://plane.example.com',
    workspaceSlug: slug,
    viewer: { id: `viewer-${id}`, displayName: 'Ada', email: null },
    projectScope: { mode: 'all' },
    connectedAt: 1,
    ...overrides
  }
  return value
}

const ACME = connection('conn-1', 'acme')
const BETA = connection('conn-2', 'beta', {
  hostKind: 'cloud',
  apiBaseUrl: 'https://api.plane.so',
  webBaseUrl: 'https://app.plane.so'
})

function workItem(id: string, connectionId: string, updatedAt: string): PlaneWorkItem {
  return {
    connectionId,
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
    updatedAt,
    url: `https://plane.example.com/${id}`
  }
}

function listResult(items: PlaneWorkItem[]) {
  return {
    ok: true,
    value: { items, errors: [], missingProjectIds: [], truncatedProjectIds: [], totalCapped: false }
  }
}

function status(entries: PlaneConnectionEntry[]): PlaneConnectionStatus {
  return {
    connected: true,
    connection: entries[0].connection,
    credentialProtection: 'sealed',
    connections: entries
  }
}

const entry = (value: PlaneConnection): PlaneConnectionEntry => ({
  connection: value,
  credentialProtection: 'sealed'
})

function install(entries: PlaneConnectionEntry[], overrides: Partial<FixtureState> = {}) {
  mocks.holder.current = {
    runtimeEnvironments: [],
    planeStatus: status(entries),
    planeStatusChecked: true,
    planeStatusContextKey: CONTEXT_KEY,
    planeProjectsByConnection: { 'conn-1': [], 'conn-2': [] },
    planeProjectsContextKey: CONTEXT_KEY,
    planeWorkItemFiltersByConnection: {},
    planeTasksWorkspaceId: null,
    checkPlaneConnection: vi.fn(),
    loadPlaneProjects: vi.fn(),
    setPlaneWorkItemFilters: vi.fn(),
    setPlaneTasksWorkspaceId: vi.fn(),
    ...overrides
  }
}

const switcher = () => screen.queryByRole('combobox', { name: 'Plane workspace' })

beforeEach(() => {
  mocks.listWorkItems
    .mockReset()
    .mockImplementation(async (_target, params) =>
      params.connectionId === 'conn-2'
        ? listResult([workItem('2', 'conn-2', '2026-02-02T00:00:00Z')])
        : listResult([workItem('1', 'conn-1', '2026-02-01T00:00:00Z')])
    )
  mocks.lookupWorkItem.mockReset()
})
afterEach(cleanup)

describe('Plane workspace switcher', () => {
  it('is hidden while only one workspace is connected', async () => {
    install([entry(ACME)])
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Item 1')).toBeTruthy())
    expect(switcher()).toBeNull()
  })

  it('shows the remembered workspace and lists only it', async () => {
    install([entry(ACME), entry(BETA)], { planeTasksWorkspaceId: 'conn-2' })
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Item 2')).toBeTruthy())
    expect(switcher()?.textContent).toContain('beta · Plane Cloud')
    expect(mocks.listWorkItems).toHaveBeenCalledTimes(1)
    expect(mocks.listWorkItems).toHaveBeenCalledWith({ kind: 'local' }, { connectionId: 'conn-2' })
  })

  it('falls back to the active workspace when the remembered one is gone', async () => {
    install([entry(ACME), entry(BETA)], { planeTasksWorkspaceId: 'conn-gone' })
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Item 1')).toBeTruthy())
    expect(switcher()?.textContent).toContain('acme · plane.example.com')
  })

  it('reloads pages on a switch but keeps each workspace its own filters', async () => {
    const filters = { ...DEFAULT_PLANE_WORK_ITEM_FILTERS, text: 'beta only' }
    install([entry(ACME), entry(BETA)], {
      planeTasksWorkspaceId: 'conn-1',
      planeWorkItemFiltersByConnection: { 'conn-2': filters }
    })
    const view = render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Item 1')).toBeTruthy())
    const search = () => screen.getByRole('textbox', { name: 'Search work items' })
    expect(search()).toHaveProperty('value', '')

    if (mocks.holder.current) {
      mocks.holder.current.planeTasksWorkspaceId = 'conn-2'
    }
    view.rerender(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)

    await waitFor(() =>
      expect(mocks.listWorkItems).toHaveBeenLastCalledWith(
        { kind: 'local' },
        { connectionId: 'conn-2' }
      )
    )
    expect(search()).toHaveProperty('value', 'beta only')
    expect(screen.queryByText('Item 1')).toBeNull()
  })
})

describe('All workspaces', () => {
  it('merges every workspace newest first, with a workspace badge on each row', async () => {
    install([entry(ACME), entry(BETA)], { planeTasksWorkspaceId: PLANE_ALL_WORKSPACES })
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Item 1')).toBeTruthy())
    const rows = screen.getAllByRole('listitem').map((row) => row.textContent ?? '')
    expect(rows[0]).toContain('Item 2')
    expect(rows[0]).toContain('beta')
    expect(rows[1]).toContain('acme')
    expect(switcher()?.textContent).toContain('All workspaces')
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveProperty('disabled', true)
    expect(
      screen.getByText('Choose one workspace to filter by project or exact state.')
    ).toBeTruthy()
  })

  it('isolates a failing workspace in its own banner', async () => {
    mocks.listWorkItems.mockImplementation(async (_target, params) =>
      params.connectionId === 'conn-2'
        ? { ok: false, error: { kind: 'forbidden', message: 'x' } }
        : listResult([workItem('1', 'conn-1', '2026-02-01T00:00:00Z')])
    )
    install([entry(ACME), entry(BETA)], { planeTasksWorkspaceId: PLANE_ALL_WORKSPACES })
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Item 1')).toBeTruthy())
    expect(screen.getByText('beta · Plane Cloud')).toBeTruthy()
    expect(screen.getByText('This token cannot access that Plane workspace.')).toBeTruthy()
  })

  it('shows a workspace that needs projects as a banner and keeps listing the rest', async () => {
    install([entry(ACME), entry({ ...BETA, projectScope: null })], {
      planeTasksWorkspaceId: PLANE_ALL_WORKSPACES
    })
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Item 1')).toBeTruthy())
    expect(mocks.listWorkItems).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Choose projects' }))
    expect(screen.getByTestId('plane-dialog').textContent).toBe('editScope:conn-2')
  })

  it('looks an identifier up in each workspace until one has it', async () => {
    install([entry(ACME), entry(BETA)], {
      planeTasksWorkspaceId: PLANE_ALL_WORKSPACES,
      planeWorkItemFiltersByConnection: {
        [PLANE_ALL_WORKSPACES]: { ...DEFAULT_PLANE_WORK_ITEM_FILTERS, text: 'WEB-99' }
      }
    })
    mocks.lookupWorkItem.mockImplementation(async (_target, _identifier, connectionId) =>
      connectionId === 'conn-2'
        ? {
            ok: true,
            value: {
              ...workItem('99', 'conn-2', '2026-02-03T00:00:00Z'),
              name: 'Deep link',
              descriptionText: '',
              truncated: false
            }
          }
        : { ok: false, error: { kind: 'not_found', message: '' } }
    )
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('No work items match these filters.')).toBeTruthy())
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search work items' }), { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('Deep link')).toBeTruthy())
    expect(mocks.lookupWorkItem.mock.calls.map((call) => call[2])).toEqual(['conn-1', 'conn-2'])
  })

  it('says when no workspace has the identifier', async () => {
    install([entry(ACME), entry(BETA)], {
      planeTasksWorkspaceId: PLANE_ALL_WORKSPACES,
      planeWorkItemFiltersByConnection: {
        [PLANE_ALL_WORKSPACES]: { ...DEFAULT_PLANE_WORK_ITEM_FILTERS, text: 'WEB-404' }
      }
    })
    mocks.lookupWorkItem.mockResolvedValue({ ok: false, error: { kind: 'not_found', message: '' } })
    render(<TaskPagePlaneContent host={{ kind: 'local' }} onHide={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('No work items match these filters.')).toBeTruthy())
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search work items' }), { key: 'Enter' })
    await waitFor(() =>
      expect(screen.getByText('WEB-404 was not found in any connected workspace.')).toBeTruthy()
    )
  })
})
