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
  PlaneConnectDialog: ({ open, mode }: { open: boolean; mode: string }) =>
    open ? <div data-testid="plane-dialog">{mode}</div> : null
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
    expect(screen.getByTestId('plane-dialog').textContent).toBe('connect')
  })

  it('shows host, slug, viewer, scope and the warning badges', () => {
    install({
      planeStatus: { connected: true, connection: CONNECTION, credentialProtection: 'plaintext' }
    })
    render(<PlaneIntegrationCard />)
    expect(screen.getByText('acme on plane.internal:8080')).toBeTruthy()
    expect(screen.getByText('Ada · ada@example.com')).toBeTruthy()
    expect(screen.getByText('Self-hosted')).toBeTruthy()
    expect(screen.getByText('2 projects')).toBeTruthy()
    expect(screen.getByText('Unencrypted HTTP')).toBeTruthy()
    expect(screen.getByText('Token stored unencrypted')).toBeTruthy()
  })

  it('opens the project step from Edit projects and disconnects', () => {
    const state = install({
      planeStatus: {
        connected: true,
        connection: { ...CONNECTION, projectScope: { mode: 'all' } },
        credentialProtection: 'sealed'
      }
    })
    render(<PlaneIntegrationCard />)
    expect(screen.getByText('All projects')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit projects' }))
    expect(screen.getByTestId('plane-dialog').textContent).toBe('editScope')
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect acme' }))
    expect(state.disconnectPlane).toHaveBeenCalledTimes(1)
  })

  it('asks for projects when the saved scope no longer resolves', () => {
    install({
      planeStatus: {
        connected: true,
        connection: { ...CONNECTION, projectScope: null },
        credentialProtection: 'sealed'
      }
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
