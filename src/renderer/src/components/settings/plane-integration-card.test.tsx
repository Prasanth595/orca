// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLocalExecutionHostLabel } from '../../../../shared/execution-host'
import type { PlaneConnection, PlaneConnectionStatus } from '../../../../shared/plane-types'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { PlaneIntegrationCard } from './plane-integration-card'

type FixtureState = {
  settings: { activeRuntimeEnvironmentId: string | null }
  runtimeEnvironments: { id: string; name: string }[]
  planeStatus: PlaneConnectionStatus
  planeStatusChecked: boolean
  planeStatusContextKey: string | null
  planeStatusIssue: 'update_required' | 'runtime_error' | null
  checkPlaneConnection: ReturnType<typeof vi.fn>
  disconnectPlane: ReturnType<typeof vi.fn>
  openSettingsPage: ReturnType<typeof vi.fn>
  openSettingsTarget: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => {
  const holder: { current: FixtureState | null } = { current: null }
  return { holder }
})
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: FixtureState) => unknown) => {
    if (!mocks.holder.current) {
      throw new Error('Store state was not installed')
    }
    return selector(mocks.holder.current)
  }
}))
vi.mock('@/components/plane/PlaneConnectDialog', () => ({
  PlaneConnectDialog: ({
    open,
    mode,
    connectionId
  }: {
    open: boolean
    mode: string
    connectionId?: string
  }) => (open ? <div data-testid="plane-dialog">{`${mode}:${connectionId ?? ''}`}</div> : null)
}))

const CONNECTION: PlaneConnection = {
  id: 'conn-1',
  hostKind: 'self-hosted',
  apiBaseUrl: 'http://plane.internal:8080',
  webBaseUrl: 'http://plane.internal:8080',
  workspaceSlug: 'acme',
  viewer: { id: 'viewer-1', displayName: 'Ada', email: 'ada@example.com' },
  projectScope: { mode: 'selected', projectIds: ['p1', 'p2'] },
  insecureHttpAcknowledged: true,
  connectedAt: 1
}

function install(overrides: Partial<FixtureState>): FixtureState {
  const state: FixtureState = {
    settings: { activeRuntimeEnvironmentId: null },
    runtimeEnvironments: [],
    planeStatus: { connected: false },
    planeStatusChecked: true,
    planeStatusContextKey: getProviderRuntimeContextKey({ activeRuntimeEnvironmentId: null }),
    planeStatusIssue: null,
    checkPlaneConnection: vi.fn(),
    disconnectPlane: vi.fn().mockResolvedValue(undefined),
    openSettingsPage: vi.fn(),
    openSettingsTarget: vi.fn(),
    ...overrides
  }
  mocks.holder.current = state
  return state
}

function statusOf(
  connections: PlaneConnection[],
  credentialProtection: 'sealed' | 'plaintext' = 'sealed'
): PlaneConnectionStatus {
  return {
    connected: true,
    connection: connections[0],
    credentialProtection,
    connections: connections.map((connection) => ({ connection, credentialProtection }))
  }
}

const BETA: PlaneConnection = {
  ...CONNECTION,
  id: 'conn-2',
  workspaceSlug: 'beta',
  projectScope: { mode: 'all' }
}

beforeEach(() => install({}))
afterEach(cleanup)

describe('PlaneIntegrationCard', () => {
  it('offers to connect when Plane is not connected', () => {
    render(<PlaneIntegrationCard />)
    expect(
      screen.getByText(
        'Browse, start work from and update Plane work items, on Plane Cloud or your own server.'
      )
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Connect Plane' }))
    expect(screen.getByTestId('plane-dialog').textContent).toBe('connect:')
  })

  it('shows host, slug, viewer, scope and the warning badges', () => {
    install({
      planeStatus: statusOf([CONNECTION], 'plaintext')
    })
    render(<PlaneIntegrationCard />)
    expect(screen.getByText(/Connected to acme on plane\.internal:8080\.$/)).toBeTruthy()
    expect(screen.getByText('Ada · ada@example.com')).toBeTruthy()
    expect(screen.getByText('Self-hosted')).toBeTruthy()
    expect(screen.getByText('2 projects')).toBeTruthy()
    expect(screen.getByText('Unencrypted HTTP')).toBeTruthy()
    expect(screen.getByText('Token stored unencrypted')).toBeTruthy()
  })

  it('lists each workspace with its own Edit projects and Remove', () => {
    const state = install({ planeStatus: statusOf([CONNECTION, BETA]) })
    render(<PlaneIntegrationCard />)
    expect(screen.getByText(/^Browse, start work from .* 2 workspaces connected\.$/)).toBeTruthy()
    expect(screen.getByText('acme')).toBeTruthy()
    expect(screen.getByText('beta')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit projects' })[1])
    expect(screen.getByTestId('plane-dialog').textContent).toBe('editScope:conn-2')
    fireEvent.click(screen.getByRole('button', { name: 'Remove beta' }))
    expect(state.disconnectPlane).toHaveBeenCalledWith('conn-2')
  })

  it('adds another workspace with the saved token', () => {
    install({ planeStatus: statusOf([{ ...CONNECTION, projectScope: { mode: 'all' } }]) })
    render(<PlaneIntegrationCard />)
    expect(screen.getByText('All projects')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add workspace' }))
    expect(screen.getByTestId('plane-dialog').textContent).toBe('addWorkspace:')
  })

  it('asks for projects when the saved scope no longer resolves', () => {
    install({
      planeStatus: statusOf([{ ...CONNECTION, projectScope: null }])
    })
    render(<PlaneIntegrationCard />)
    expect(screen.getAllByText('Choose projects').length).toBeGreaterThan(0)
    expect(screen.getByText('No projects chosen')).toBeTruthy()
  })

  it('asks an older host to update', () => {
    install({ planeStatusIssue: 'update_required' })
    render(<PlaneIntegrationCard />)
    expect(screen.getByRole('alert').textContent).toBe(
      `Update the Orca server on ${getLocalExecutionHostLabel()} to use Plane.`
    )
  })
})
