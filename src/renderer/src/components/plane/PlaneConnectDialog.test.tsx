// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLocalExecutionHostLabel } from '../../../../shared/execution-host'
import type {
  PlaneConnection,
  PlaneConnectionStatus,
  PlaneHostKind,
  PlaneProject
} from '../../../../shared/plane-types'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { PlaneConnectDialog } from './PlaneConnectDialog'
import { PlaneHostScopeProvider, useResolvedPlaneHostScope } from './plane-host-scope'

const PROJECTS: PlaneProject[] = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Web', identifier: 'WEB' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'API', identifier: 'API' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Docs', identifier: 'DOC' }
]

function connectionFor(hostKind: PlaneHostKind, slug = 'acme'): PlaneConnection {
  return {
    id: `conn-${slug}`,
    hostKind,
    apiBaseUrl: 'https://plane.example.com',
    webBaseUrl: 'https://plane.example.com',
    workspaceSlug: slug,
    viewer: { id: 'viewer-1', displayName: 'Ada', email: null },
    projectScope: null,
    connectedAt: 1
  }
}

function connectedStatus(...connections: PlaneConnection[]): PlaneConnectionStatus {
  return {
    connected: true,
    credentialProtection: 'sealed',
    connection: connections[0],
    connections: connections.map((connection) => ({ connection, credentialProtection: 'sealed' }))
  }
}

/** connectPlane answers per slug: listed ones connect, the rest are not reachable. */
function answerBySlug(hostKind: PlaneHostKind, reachable: string[]): void {
  mocks.state.connectPlane.mockImplementation(async (_target, args: { workspaceSlug: string }) =>
    reachable.includes(args.workspaceSlug)
      ? {
          ok: true,
          status: connectedStatus(connectionFor(hostKind, args.workspaceSlug)),
          connection: connectionFor(hostKind, args.workspaceSlug),
          projects: PROJECTS
        }
      : { ok: false, error: 'workspace_unavailable', message: 'raw', field: 'workspaceSlug' }
  )
}

type FixtureState = {
  runtimeEnvironments: { id: string; name: string }[]
  planeProjectsByConnection: Record<string, PlaneProject[]>
  planeStatus: PlaneConnectionStatus
  connectPlane: ReturnType<typeof vi.fn>
  setPlaneProjectScope: ReturnType<typeof vi.fn>
  loadPlaneProjects: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => {
  const state: FixtureState = {
    runtimeEnvironments: [{ id: 'env-1', name: 'Build box' }],
    planeProjectsByConnection: {},
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
  mocks.state.connectPlane.mockReset()
  mocks.state.setPlaneProjectScope.mockReset().mockResolvedValue({ ok: true, value: {} })
  mocks.state.loadPlaneProjects.mockReset().mockResolvedValue({ ok: true, value: PROJECTS })
})
afterEach(cleanup)

const LOCAL: RuntimeClientTarget = { kind: 'local' }

function Scoped({ target, children }: { target: RuntimeClientTarget; children: React.ReactNode }) {
  return (
    <PlaneHostScopeProvider value={useResolvedPlaneHostScope(target)}>
      {children}
    </PlaneHostScopeProvider>
  )
}

function renderDialog(ui: React.ReactElement, target: RuntimeClientTarget = LOCAL): void {
  render(<Scoped target={target}>{ui}</Scoped>)
}

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
  addSlugs('acme')
  type('Personal access token', 'plane_api_secret')
}

function addSlugs(text: string): void {
  const input = screen.getByLabelText('Workspaces')
  fireEvent.change(input, { target: { value: text } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

const connectButton = () => screen.getByRole('button', { name: 'Connect' })

describe('PlaneConnectDialog credentials', () => {
  it('offers Cloud and self-hosted as equal choices with nothing preselected', () => {
    renderDialog(<PlaneConnectDialog open onOpenChange={vi.fn()} />)
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(2)
    expect(radios.every((radio) => radio.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(screen.queryByLabelText('Personal access token')).toBeNull()
  })

  it('has no URL field for Plane Cloud', () => {
    renderDialog(<PlaneConnectDialog open onOpenChange={vi.fn()} />)
    chooseHost('cloud')
    expect(screen.queryByLabelText('Server URL')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Advanced' })).toBeNull()
    expect(screen.getByLabelText('Workspaces')).toBeTruthy()
  })

  it('asks self-hosted for a server URL with the API base under Advanced', () => {
    renderDialog(<PlaneConnectDialog open onOpenChange={vi.fn()} />)
    chooseHost('self-hosted')
    expect(screen.getByLabelText('Server URL')).toBeTruthy()
    expect(screen.queryByLabelText('API base URL')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    expect(screen.getByLabelText('API base URL')).toBeTruthy()
  })

  it('requires consent before sending a token over plain http', async () => {
    mocks.state.connectPlane.mockResolvedValue({ ok: false, error: 'auth', message: 'x' })
    renderDialog(<PlaneConnectDialog open onOpenChange={vi.fn()} />)
    fillCredentials('self-hosted', 'http://plane.example.com')
    expect(connectButton()).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByLabelText('Send my token over unencrypted HTTP'))
    expect(connectButton()).toHaveProperty('disabled', false)
    fireEvent.click(connectButton())
    await waitFor(() =>
      expect(mocks.state.connectPlane).toHaveBeenCalledWith(
        LOCAL,
        expect.objectContaining({ insecureHttpAcknowledged: true })
      )
    )
  })

  it('fills the server and a chip from a pasted Plane URL', () => {
    renderDialog(<PlaneConnectDialog open onOpenChange={vi.fn()} />)
    chooseHost('self-hosted')
    fireEvent.paste(screen.getByLabelText('Workspaces'), {
      clipboardData: { getData: () => 'https://plane.example.com/plane/acme/projects/' }
    })
    expect(screen.getByLabelText('Server URL')).toHaveProperty(
      'value',
      'https://plane.example.com/plane'
    )
    expect(screen.getByRole('button', { name: 'Remove acme' })).toBeTruthy()
  })
})

describe.each<PlaneHostKind>(['cloud', 'self-hosted'])(
  'PlaneConnectDialog workspaces (%s)',
  (hostKind) => {
    it('connects every chip with one token, one call per workspace', async () => {
      answerBySlug(hostKind, ['acme', 'beta'])
      renderDialog(<PlaneConnectDialog open onOpenChange={vi.fn()} />)
      fillCredentials(hostKind)
      const input = screen.getByLabelText('Workspaces')
      fireEvent.change(input, { target: { value: 'beta,' } })
      fireEvent.click(connectButton())
      await waitFor(() => expect(screen.getByText('Choose Plane projects')).toBeTruthy())
      expect(mocks.state.connectPlane.mock.calls.map(([, args]) => args)).toEqual([
        expect.objectContaining({ workspaceSlug: 'acme', apiToken: 'plane_api_secret' }),
        expect.objectContaining({ workspaceSlug: 'beta', apiToken: 'plane_api_secret' })
      ])
      expect(screen.queryByLabelText('Personal access token')).toBeNull()
      expect(screen.getByRole('region', { name: 'Projects in acme' })).toBeTruthy()
      expect(screen.getByRole('region', { name: 'Projects in beta' })).toBeTruthy()
    })

    it('marks a workspace it cannot reach without blocking the others', async () => {
      answerBySlug(hostKind, ['acme'])
      renderDialog(<PlaneConnectDialog open onOpenChange={vi.fn()} />)
      fillCredentials(hostKind)
      addSlugs('nope')
      fireEvent.click(connectButton())
      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toBe(
          "nope: Workspace not found or you don't have access."
        )
      )
      expect(mocks.state.connectPlane).toHaveBeenCalledTimes(2)
      fireEvent.click(screen.getByRole('button', { name: 'Remove nope' }))
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
      expect(screen.getByText('Choose Plane projects')).toBeTruthy()
    })

    it('saves all projects by default for each workspace, by connection', async () => {
      answerBySlug(hostKind, ['acme'])
      const onOpenChange = vi.fn()
      renderDialog(<PlaneConnectDialog open onOpenChange={onOpenChange} />)
      fillCredentials(hostKind)
      fireEvent.click(connectButton())
      await waitFor(() => expect(screen.getByText('Choose Plane projects')).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: 'Save projects' }))
      await waitFor(() =>
        expect(mocks.state.setPlaneProjectScope).toHaveBeenCalledWith(
          LOCAL,
          { mode: 'all' },
          'conn-acme'
        )
      )
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('saves a chosen project for one workspace', async () => {
      answerBySlug(hostKind, ['acme'])
      renderDialog(<PlaneConnectDialog open onOpenChange={vi.fn()} />)
      fillCredentials(hostKind)
      fireEvent.click(connectButton())
      await waitFor(() => expect(screen.getByText('Choose Plane projects')).toBeTruthy())
      fireEvent.click(screen.getByRole('radio', { name: /Choose projects/ }))
      fireEvent.click(screen.getByText('Web'))
      fireEvent.click(screen.getByRole('button', { name: 'Save projects' }))
      await waitFor(() =>
        expect(mocks.state.setPlaneProjectScope).toHaveBeenCalledWith(
          LOCAL,
          { mode: 'selected', projectIds: [PROJECTS[0].id] },
          'conn-acme'
        )
      )
    })

    it('adds workspaces with the token saved on the host', async () => {
      mocks.state.planeStatus = connectedStatus(connectionFor(hostKind))
      answerBySlug(hostKind, ['beta'])
      renderDialog(<PlaneConnectDialog open onOpenChange={vi.fn()} mode="addWorkspace" />)
      expect(screen.queryByLabelText('Personal access token')).toBeNull()
      expect(screen.getByText(/Uses the token saved for acme on plane.example.com/)).toBeTruthy()
      addSlugs('beta')
      fireEvent.click(connectButton())
      await waitFor(() => expect(screen.getByText('Choose Plane projects')).toBeTruthy())
      expect(mocks.state.connectPlane).toHaveBeenCalledWith(LOCAL, {
        reuseTokenFromConnectionId: 'conn-acme',
        workspaceSlug: 'beta'
      })
      mocks.state.planeStatus = { connected: false }
    })
  }
)

describe('PlaneConnectDialog error messages', () => {
  const localHost = getLocalExecutionHostLabel()

  it.each([
    ['auth', 'Plane rejected this token. Create a new one and try again.'],
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
  ])('shows copy for %s once for the whole form', async (kind, copy) => {
    mocks.state.connectPlane.mockResolvedValue({ ok: false, error: kind, message: 'raw host text' })
    renderDialog(<PlaneConnectDialog open onOpenChange={vi.fn()} />)
    fillCredentials('cloud')
    addSlugs('beta')
    fireEvent.click(connectButton())
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(copy))
    expect(mocks.state.connectPlane).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('raw host text')).toBeNull()
  })

  it('names the remote server that failed the TLS check', async () => {
    mocks.state.connectPlane.mockResolvedValue({ ok: false, error: 'tls', message: 'raw' })
    renderDialog(<PlaneConnectDialog open onOpenChange={vi.fn()} />, {
      kind: 'environment',
      environmentId: 'env-1'
    })
    fillCredentials('self-hosted')
    fireEvent.click(connectButton())
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        "The Orca runtime on Build box doesn't trust this server's certificate."
      )
    )
  })
})
