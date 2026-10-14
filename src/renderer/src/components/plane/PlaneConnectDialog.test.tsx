// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLocalExecutionHostLabel } from '../../../../shared/execution-host'
import type {
  PlaneConnectionStatus,
  PlaneHostKind,
  PlaneProject
} from '../../../../shared/plane-types'
import { PlaneConnectDialog } from './PlaneConnectDialog'

const PROJECTS: PlaneProject[] = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Web', identifier: 'WEB' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'API', identifier: 'API' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Docs', identifier: 'DOC' }
]

function connectedStatus(hostKind: PlaneHostKind): PlaneConnectionStatus {
  return {
    connected: true,
    credentialProtection: 'sealed',
    connection: {
      id: 'conn-1',
      hostKind,
      apiBaseUrl: 'https://plane.example.com',
      webBaseUrl: 'https://plane.example.com',
      workspaceSlug: 'acme',
      viewer: { id: 'viewer-1', displayName: 'Ada', email: null },
      projectScope: null,
      connectedAt: 1
    }
  }
}

type FixtureState = {
  settings: { activeRuntimeEnvironmentId: string | null }
  runtimeEnvironments: { id: string; name: string }[]
  planeProjects: PlaneProject[]
  planeStatus: PlaneConnectionStatus
  connectPlane: ReturnType<typeof vi.fn>
  setPlaneProjectScope: ReturnType<typeof vi.fn>
  loadPlaneProjects: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => {
  const state: FixtureState = {
    settings: { activeRuntimeEnvironmentId: null },
    runtimeEnvironments: [{ id: 'env-1', name: 'Build box' }],
    planeProjects: [],
    planeStatus: { connected: false },
    connectPlane: vi.fn(),
    setPlaneProjectScope: vi.fn(),
    loadPlaneProjects: vi.fn()
  }
  const useAppStore = Object.assign((selector: (s: FixtureState) => unknown) => selector(state), {
    getState: () => state
  })
  return { state, useAppStore }
})
vi.mock('@/store', () => ({ useAppStore: mocks.useAppStore }))

beforeEach(() => {
  mocks.state.settings.activeRuntimeEnvironmentId = null
  mocks.state.connectPlane.mockReset()
  mocks.state.setPlaneProjectScope.mockReset().mockResolvedValue({ ok: true, value: {} })
  mocks.state.loadPlaneProjects.mockReset().mockResolvedValue({ ok: true, value: PROJECTS })
})
afterEach(cleanup)

function chooseHost(hostKind: PlaneHostKind): void {
  fireEvent.click(
    screen.getByRole('radio', { name: hostKind === 'cloud' ? /Plane Cloud/ : /Self-hosted/ })
  )
}

function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function fillCredentials(hostKind: PlaneHostKind, serverUrl = 'https://plane.example.com'): void {
  chooseHost(hostKind)
  if (hostKind === 'self-hosted') {
    type('Server URL', serverUrl)
  }
  type('Workspace slug', 'acme')
  type('Personal access token', 'plane_api_secret')
}

const connectButton = () => screen.getByRole('button', { name: 'Connect' })

describe('PlaneConnectDialog credentials', () => {
  it('offers Cloud and self-hosted as equal choices with nothing preselected', () => {
    render(<PlaneConnectDialog open onOpenChange={vi.fn()} />)
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(2)
    expect(radios.every((radio) => radio.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(screen.queryByLabelText('Personal access token')).toBeNull()
  })

  it('has no URL field for Plane Cloud', () => {
    render(<PlaneConnectDialog open onOpenChange={vi.fn()} />)
    chooseHost('cloud')
    expect(screen.queryByLabelText('Server URL')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Advanced' })).toBeNull()
    expect(screen.getByLabelText('Workspace slug')).toBeTruthy()
  })

  it('asks self-hosted for a server URL with the API base under Advanced', () => {
    render(<PlaneConnectDialog open onOpenChange={vi.fn()} />)
    chooseHost('self-hosted')
    expect(screen.getByLabelText('Server URL')).toBeTruthy()
    expect(screen.queryByLabelText('API base URL')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    expect(screen.getByLabelText('API base URL')).toBeTruthy()
  })

  it.each<[PlaneHostKind, Record<string, unknown>]>([
    ['cloud', { hostKind: 'cloud', workspaceSlug: 'acme', apiToken: 'plane_api_secret' }],
    [
      'self-hosted',
      {
        hostKind: 'self-hosted',
        serverUrl: 'https://plane.example.com',
        workspaceSlug: 'acme',
        apiToken: 'plane_api_secret'
      }
    ]
  ])('connects %s and moves to the project step', async (hostKind, args) => {
    mocks.state.connectPlane.mockResolvedValue({
      ok: true,
      status: connectedStatus(hostKind),
      projects: PROJECTS
    })
    render(<PlaneConnectDialog open onOpenChange={vi.fn()} />)
    fillCredentials(hostKind)
    fireEvent.click(connectButton())
    await waitFor(() => expect(screen.getByText('Choose Plane projects')).toBeTruthy())
    expect(mocks.state.connectPlane).toHaveBeenCalledWith(args)
    expect(screen.queryByLabelText('Personal access token')).toBeNull()
  })

  it('requires consent before sending a token over plain http', async () => {
    mocks.state.connectPlane.mockResolvedValue({ ok: false, error: 'auth', message: 'x' })
    render(<PlaneConnectDialog open onOpenChange={vi.fn()} />)
    fillCredentials('self-hosted', 'http://plane.example.com')
    expect(connectButton()).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByLabelText('Send my token over unencrypted HTTP'))
    expect(connectButton()).toHaveProperty('disabled', false)
    fireEvent.click(connectButton())
    await waitFor(() =>
      expect(mocks.state.connectPlane).toHaveBeenCalledWith(
        expect.objectContaining({ insecureHttpAcknowledged: true })
      )
    )
  })

  it('needs no consent for https', () => {
    render(<PlaneConnectDialog open onOpenChange={vi.fn()} />)
    fillCredentials('self-hosted')
    expect(screen.queryByLabelText('Send my token over unencrypted HTTP')).toBeNull()
    expect(connectButton()).toHaveProperty('disabled', false)
  })
})

describe('PlaneConnectDialog error messages', () => {
  const localHost = getLocalExecutionHostLabel()

  it.each([
    ['auth', 'Plane rejected this token. Create a new one and try again.'],
    ['workspace_not_found', 'No Plane workspace with that slug is available to this token.'],
    [
      'invalid_response',
      'This URL serves the Plane web app, not its API. Set the API base URL in Advanced.'
    ],
    ['tls', `The Orca runtime on ${localHost} doesn't trust this server's certificate.`],
    [
      'network',
      `${localHost} could not reach the Plane server. Check the URL and that ${localHost} can reach it.`
    ],
    ['update_required', `Update the Orca server on ${localHost} to use Plane.`]
  ])('shows copy for %s instead of the host message', async (kind, copy) => {
    mocks.state.connectPlane.mockResolvedValue({ ok: false, error: kind, message: 'raw host text' })
    render(<PlaneConnectDialog open onOpenChange={vi.fn()} />)
    fillCredentials('cloud')
    fireEvent.click(connectButton())
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(copy))
    expect(screen.queryByText('raw host text')).toBeNull()
  })

  it('names the remote server that failed the TLS check', async () => {
    mocks.state.settings.activeRuntimeEnvironmentId = 'env-1'
    mocks.state.connectPlane.mockResolvedValue({ ok: false, error: 'tls', message: 'raw' })
    render(<PlaneConnectDialog open onOpenChange={vi.fn()} />)
    fillCredentials('self-hosted')
    fireEvent.click(connectButton())
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        "The Orca runtime on Build box doesn't trust this server's certificate."
      )
    )
  })
})

describe.each<PlaneHostKind>(['cloud', 'self-hosted'])(
  'PlaneConnectDialog scope (%s)',
  (hostKind) => {
    async function connect(): Promise<void> {
      mocks.state.connectPlane.mockResolvedValue({
        ok: true,
        status: connectedStatus(hostKind),
        projects: PROJECTS
      })
      render(<PlaneConnectDialog open onOpenChange={vi.fn()} />)
      fillCredentials(hostKind)
      fireEvent.click(connectButton())
      await waitFor(() => expect(screen.getByText('Choose Plane projects')).toBeTruthy())
    }

    const save = () => screen.getByRole('button', { name: 'Save projects' })

    it('saves all projects', async () => {
      await connect()
      expect(save()).toHaveProperty('disabled', true)
      fireEvent.click(screen.getByRole('radio', { name: /All projects/ }))
      fireEvent.click(save())
      await waitFor(() =>
        expect(mocks.state.setPlaneProjectScope).toHaveBeenCalledWith({ mode: 'all' })
      )
    })

    it.each([
      ['one project', ['Web'], [PROJECTS[0].id]],
      ['several projects', ['Docs', 'Web'], [PROJECTS[0].id, PROJECTS[2].id]]
    ])('saves %s', async (_name, names, ids) => {
      await connect()
      fireEvent.click(screen.getByRole('radio', { name: /Choose projects/ }))
      expect(save()).toHaveProperty('disabled', true)
      for (const name of names) {
        fireEvent.click(screen.getByText(name))
      }
      fireEvent.click(save())
      await waitFor(() =>
        expect(mocks.state.setPlaneProjectScope).toHaveBeenCalledWith({
          mode: 'selected',
          projectIds: ids
        })
      )
    })
  }
)
