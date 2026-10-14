// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PlaneConnection,
  PlaneConnectionStatus,
  PlaneWorkItem
} from '../../../../../shared/plane-types'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { TaskPagePlaneContent } from './TaskPagePlaneContent'

type FixtureState = {
  settings: { activeRuntimeEnvironmentId: string | null }
  runtimeEnvironments: { id: string; name: string }[]
  planeStatus: PlaneConnectionStatus
  planeStatusChecked: boolean
  planeStatusContextKey: string | null
  checkPlaneConnection: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => {
  const holder: { current: FixtureState | null } = { current: null }
  return { holder, listWorkItems: vi.fn() }
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
  isPlaneRuntimeUpdateRequiredError: () => false
}))
vi.mock('@/components/plane/PlaneConnectDialog', () => ({
  PlaneConnectDialog: ({ open, mode }: { open: boolean; mode: string }) =>
    open ? <div data-testid="plane-dialog">{mode}</div> : null
}))

const CONNECTION: PlaneConnection = {
  id: 'conn-1',
  hostKind: 'cloud',
  apiBaseUrl: 'https://api.plane.so',
  webBaseUrl: 'https://app.plane.so',
  workspaceSlug: 'acme',
  viewer: { id: 'viewer-1', displayName: 'Ada', email: null },
  projectScope: { mode: 'all' },
  connectedAt: 1
}

const ITEM: PlaneWorkItem = {
  connectionId: 'conn-1',
  id: 'item-1',
  projectId: 'project-1',
  projectIdentifier: 'WEB',
  sequenceId: 12,
  identifier: 'WEB-12',
  name: 'Fix login redirect',
  state: { id: 'state-1', name: 'In Progress', group: 'started', color: '#000', sequence: 1 },
  priority: 'high',
  assignees: [],
  labels: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  url: 'https://app.plane.so/acme/projects/project-1/issues/item-1'
}

function install(planeStatus: PlaneConnectionStatus): FixtureState {
  const state: FixtureState = {
    settings: { activeRuntimeEnvironmentId: null },
    runtimeEnvironments: [],
    planeStatus,
    planeStatusChecked: true,
    planeStatusContextKey: getProviderRuntimeContextKey({ activeRuntimeEnvironmentId: null }),
    checkPlaneConnection: vi.fn()
  }
  mocks.holder.current = state
  return state
}

beforeEach(() => {
  mocks.listWorkItems.mockReset()
})
afterEach(cleanup)

describe('TaskPagePlaneContent', () => {
  it('offers to connect or hide when Plane is not connected', () => {
    install({ connected: false })
    const onHide = vi.fn()
    render(<TaskPagePlaneContent onHide={onHide} />)

    fireEvent.click(screen.getByRole('button', { name: 'Connect Plane' }))
    expect(screen.getByTestId('plane-dialog').textContent).toBe('connect')
    fireEvent.click(screen.getByRole('button', { name: 'Hide Plane' }))
    expect(onHide).toHaveBeenCalledOnce()
    expect(mocks.listWorkItems).not.toHaveBeenCalled()
  })

  it('asks for projects when the connection has no usable scope', () => {
    install({
      connected: true,
      connection: { ...CONNECTION, projectScope: null },
      credentialProtection: 'sealed'
    })
    render(<TaskPagePlaneContent onHide={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Choose projects' }))
    expect(screen.getByTestId('plane-dialog').textContent).toBe('editScope')
    expect(mocks.listWorkItems).not.toHaveBeenCalled()
  })

  it('lists work items with identifier, title and state', async () => {
    install({ connected: true, connection: CONNECTION, credentialProtection: 'sealed' })
    mocks.listWorkItems.mockResolvedValue({
      ok: true,
      value: {
        items: [ITEM],
        errors: [],
        missingProjectIds: [],
        truncatedProjectIds: [],
        totalCapped: false
      }
    })
    render(<TaskPagePlaneContent onHide={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Fix login redirect')).toBeTruthy())
    expect(screen.getByText('WEB-12')).toBeTruthy()
    expect(screen.getByText('In Progress')).toBeTruthy()
  })

  it('switches to the project prompt when the host reports the scope is gone', async () => {
    install({ connected: true, connection: CONNECTION, credentialProtection: 'sealed' })
    mocks.listWorkItems.mockResolvedValue({
      ok: true,
      value: {
        items: [],
        errors: [],
        missingProjectIds: [],
        truncatedProjectIds: [],
        totalCapped: false,
        needsScope: true
      }
    })
    render(<TaskPagePlaneContent onHide={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Choose Plane projects')).toBeTruthy())
  })

  it('shows copy for a failed list instead of the host message', async () => {
    install({ connected: true, connection: CONNECTION, credentialProtection: 'sealed' })
    mocks.listWorkItems.mockResolvedValue({
      ok: false,
      error: { kind: 'auth', message: 'raw host text' }
    })
    render(<TaskPagePlaneContent onHide={vi.fn()} />)

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Plane rejected this token. Create a new one and try again.'
      )
    )
  })
})
