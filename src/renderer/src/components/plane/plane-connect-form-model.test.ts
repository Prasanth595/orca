import { describe, expect, it } from 'vitest'
import {
  INITIAL_PLANE_CONNECT_FORM,
  planeConnectFormReducer,
  type PlaneConnectFormAction,
  type PlaneConnectFormState
} from './plane-connect-form-model'
import {
  canSubmitPlaneCredentials,
  getPlaneScopeToSave,
  getPlaneSlugsToConnect,
  getPlaneTokenSettingsUrl,
  isCloudUrlInSelfHostedForm,
  needsInsecureHttpConsent,
  toPlaneConnectArgs
} from './plane-connect-form-selectors'
import { parsePlaneSlugEntries } from './plane-workspace-chips'

const PROJECT = { id: '0b8c4e9e-5f43-4f6a-9d6f-1c2b3a4d5e6f', name: 'Web', identifier: 'WEB' }

function run(...actions: PlaneConnectFormAction[]): PlaneConnectFormState {
  return actions.reduce(planeConnectFormReducer, INITIAL_PLANE_CONNECT_FORM)
}

const field = (
  name: 'serverUrl' | 'apiBaseUrl' | 'apiToken',
  value: string
): PlaneConnectFormAction => ({ type: 'setField', field: name, value })
const typeSlugs = (value: string): PlaneConnectFormAction => ({ type: 'setSlugDraft', value })

describe('workspace slug entries', () => {
  it('splits on commas and spaces and pulls slugs and the server out of Plane URLs', () => {
    expect(
      parsePlaneSlugEntries('acme, Beta https://plane.example.com/plane/gamma/projects/ bad/x')
    ).toEqual({
      slugs: ['acme', 'beta', 'gamma'],
      invalid: ['bad/x'],
      server: { hostKind: 'self-hosted', serverUrl: 'https://plane.example.com/plane' }
    })
    expect(parsePlaneSlugEntries('https://app.plane.so/acme/browse/WEB-1/').server).toEqual({
      hostKind: 'cloud',
      serverUrl: 'https://app.plane.so'
    })
  })
})

describe.each([
  { name: 'Plane Cloud', host: [{ type: 'selectHost', hostKind: 'cloud' }] },
  {
    name: 'self-hosted',
    host: [
      { type: 'selectHost', hostKind: 'self-hosted' },
      { type: 'setField', field: 'serverUrl', value: 'https://plane.example.com' }
    ]
  }
] satisfies { name: string; host: PlaneConnectFormAction[] }[])(
  'connect form on $name',
  ({ host }) => {
    it('turns Enter, comma or a space into chips and connects each slug with one token', () => {
      const state = run(
        ...host,
        typeSlugs('acme,'),
        typeSlugs('beta gamma'),
        { type: 'commitSlugDraft' },
        field('apiToken', ' plane_api_x ')
      )
      expect(state.chips.map((chip) => chip.slug)).toEqual(['acme', 'beta', 'gamma'])
      expect(getPlaneSlugsToConnect(state)).toEqual(['acme', 'beta', 'gamma'])
      expect(canSubmitPlaneCredentials(state)).toBe(true)
      expect(toPlaneConnectArgs(state, 'beta')).toMatchObject({
        workspaceSlug: 'beta',
        apiToken: 'plane_api_x'
      })
    })

    it('counts a typed slug that is not a chip yet and ignores duplicates', () => {
      const state = run(...host, typeSlugs('acme,'), typeSlugs('acme'), field('apiToken', 't'))
      expect(getPlaneSlugsToConnect(state)).toEqual(['acme'])
    })

    it('keeps going past a failed chip and retries only what is not connected', () => {
      const state = run(
        ...host,
        typeSlugs('acme beta '),
        field('apiToken', 't'),
        { type: 'chipStarted', slug: 'acme' },
        { type: 'chipFailed', slug: 'acme', error: 'workspace_unavailable' },
        {
          type: 'chipConnected',
          slug: 'beta',
          connectionId: 'conn-b',
          projects: [PROJECT],
          scope: null
        }
      )
      expect(state.chips).toEqual([
        { slug: 'acme', status: 'failed', error: 'workspace_unavailable' },
        { slug: 'beta', status: 'connected', connectionId: 'conn-b', projectCount: 1 }
      ])
      expect(getPlaneSlugsToConnect(state)).toEqual(['acme'])
      expect(state.workspaces).toEqual([
        { connectionId: 'conn-b', slug: 'beta', projects: [PROJECT], scope: { mode: 'all' } }
      ])
      const removed = planeConnectFormReducer(state, { type: 'removeChip', slug: 'acme' })
      expect(getPlaneSlugsToConnect(removed)).toEqual([])
    })

    it('drops the token when it moves on to choosing projects', () => {
      const state = run(...host, typeSlugs('acme '), field('apiToken', 'secret'), {
        type: 'goToScope'
      })
      expect(state).toMatchObject({ step: 'scope', apiToken: '' })
    })
  }
)

describe('plane connect form model', () => {
  it('starts with no host chosen, so neither card is preferred', () => {
    expect(INITIAL_PLANE_CONNECT_FORM.hostKind).toBeNull()
    expect(canSubmitPlaneCredentials(INITIAL_PLANE_CONNECT_FORM)).toBe(false)
  })

  it('fills server and slug from a pasted self-hosted URL, and switches to Cloud for app.plane.so', () => {
    const selfHosted = run({
      type: 'pasteSlugs',
      text: 'https://plane.example.com/plane/acme/projects/'
    })
    expect(selfHosted).toMatchObject({
      hostKind: 'self-hosted',
      serverUrl: 'https://plane.example.com/plane',
      chips: [{ slug: 'acme', status: 'pending' }]
    })
    const cloud = run({ type: 'pasteSlugs', text: 'https://app.plane.so/acme/browse/WEB-1/' })
    expect(cloud).toMatchObject({ hostKind: 'cloud', chips: [{ slug: 'acme' }] })
    expect(getPlaneTokenSettingsUrl(cloud)).toBe(
      'https://app.plane.so/acme/settings/account/api-tokens'
    )
  })

  it('adds a chip from a browser URL typed as the server, and flags a Cloud URL there', () => {
    const selfHosted = run(
      { type: 'selectHost', hostKind: 'self-hosted' },
      field('serverUrl', 'https://plane.example.com/acme/projects/')
    )
    expect(selfHosted.chips).toEqual([{ slug: 'acme', status: 'pending' }])
    const cloud = run(
      { type: 'selectHost', hostKind: 'self-hosted' },
      field('serverUrl', 'https://app.plane.so/acme/projects/')
    )
    expect(isCloudUrlInSelfHostedForm(cloud)).toBe(true)
  })

  it('sends the advanced API base only when open and asks consent for remote http', () => {
    const state = run(
      { type: 'selectHost', hostKind: 'self-hosted' },
      field('serverUrl', 'http://plane.example.com'),
      field('apiBaseUrl', 'http://api.example.com'),
      typeSlugs('acme '),
      field('apiToken', 'token')
    )
    expect(toPlaneConnectArgs(state, 'acme')).not.toHaveProperty('apiBaseUrl')
    expect(needsInsecureHttpConsent(state)).toBe(true)
    expect(canSubmitPlaneCredentials(state)).toBe(false)
    const agreed = planeConnectFormReducer(state, { type: 'acknowledgeInsecureHttp', value: true })
    expect(toPlaneConnectArgs(agreed, 'acme')).toMatchObject({ insecureHttpAcknowledged: true })
    const advanced = planeConnectFormReducer(agreed, { type: 'toggleAdvanced' })
    expect(advanced.insecureHttpAcknowledged).toBe(false)
    expect(toPlaneConnectArgs(advanced, 'acme')).toMatchObject({
      apiBaseUrl: 'http://api.example.com'
    })
  })

  it('adds workspaces with a saved token and never asks for one', () => {
    const state = run(
      {
        type: 'addWorkspace',
        source: { connectionId: 'conn-a', slug: 'acme', server: 'app.plane.so' }
      },
      typeSlugs('beta ')
    )
    expect(canSubmitPlaneCredentials(state)).toBe(true)
    expect(needsInsecureHttpConsent(state)).toBe(false)
    expect(toPlaneConnectArgs(state, 'beta')).toEqual({
      reuseTokenFromConnectionId: 'conn-a',
      workspaceSlug: 'beta'
    })
  })

  it('clears the token when switching host kind', () => {
    const typed = run({ type: 'selectHost', hostKind: 'cloud' }, field('apiToken', 'secret'))
    expect(
      planeConnectFormReducer(typed, { type: 'selectHost', hostKind: 'self-hosted' }).apiToken
    ).toBe('')
  })

  it('only saves a scope that names at least one project or all of them', () => {
    expect(getPlaneScopeToSave(null)).toBeNull()
    expect(getPlaneScopeToSave({ mode: 'selected', projectIds: [] })).toBeNull()
    expect(getPlaneScopeToSave({ mode: 'all' })).toEqual({ mode: 'all' })
  })

  it('edits one workspace and drops projects that left its live list', () => {
    const editing = run({
      type: 'editScope',
      workspaces: [
        {
          connectionId: 'conn-a',
          slug: 'acme',
          projects: [PROJECT],
          scope: { mode: 'selected', projectIds: [PROJECT.id, 'gone'] }
        }
      ]
    })
    expect(editing.step).toBe('scope')
    const reloaded = planeConnectFormReducer(editing, {
      type: 'projectsLoaded',
      connectionId: 'conn-a',
      projects: [PROJECT]
    })
    expect(reloaded.workspaces[0].scope).toEqual({ mode: 'selected', projectIds: [PROJECT.id] })
  })
})
