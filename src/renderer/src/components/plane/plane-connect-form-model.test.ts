import { describe, expect, it } from 'vitest'
import {
  INITIAL_PLANE_CONNECT_FORM,
  canSubmitPlaneCredentials,
  getPlaneScopeToSave,
  getPlaneTokenSettingsUrl,
  isCloudUrlInSelfHostedForm,
  needsInsecureHttpConsent,
  planeConnectFormReducer,
  toPlaneConnectArgs,
  type PlaneConnectFormAction,
  type PlaneConnectFormState
} from './plane-connect-form-model'

const PROJECT = { id: '0b8c4e9e-5f43-4f6a-9d6f-1c2b3a4d5e6f', name: 'Web', identifier: 'WEB' }

function run(...actions: PlaneConnectFormAction[]): PlaneConnectFormState {
  return actions.reduce(planeConnectFormReducer, INITIAL_PLANE_CONNECT_FORM)
}

const field = (
  name: 'serverUrl' | 'apiBaseUrl' | 'workspaceSlug' | 'apiToken',
  value: string
): PlaneConnectFormAction => ({ type: 'setField', field: name, value })

describe('plane connect form model', () => {
  it('starts with no host chosen, so neither card is preferred', () => {
    expect(INITIAL_PLANE_CONNECT_FORM.hostKind).toBeNull()
    expect(canSubmitPlaneCredentials(INITIAL_PLANE_CONNECT_FORM)).toBe(false)
  })

  it('connects to Plane Cloud with only a slug and token', () => {
    const state = run(
      { type: 'selectHost', hostKind: 'cloud' },
      field('workspaceSlug', ' Acme '),
      field('apiToken', ' plane_api_x ')
    )
    expect(toPlaneConnectArgs(state)).toEqual({
      hostKind: 'cloud',
      workspaceSlug: 'Acme',
      apiToken: 'plane_api_x'
    })
    expect(getPlaneTokenSettingsUrl(state)).toBe(
      'https://app.plane.so/acme/settings/account/api-tokens'
    )
  })

  it('requires a server URL for self-hosted and sends the advanced API base only when open', () => {
    const base = run(
      { type: 'selectHost', hostKind: 'self-hosted' },
      field('workspaceSlug', 'acme'),
      field('apiToken', 'token')
    )
    expect(canSubmitPlaneCredentials(base)).toBe(false)
    const withUrl = run(
      { type: 'selectHost', hostKind: 'self-hosted' },
      field('serverUrl', 'https://plane.example.com'),
      field('apiBaseUrl', 'https://api.example.com'),
      field('workspaceSlug', 'acme'),
      field('apiToken', 'token')
    )
    expect(toPlaneConnectArgs(withUrl)).toEqual({
      hostKind: 'self-hosted',
      serverUrl: 'https://plane.example.com',
      workspaceSlug: 'acme',
      apiToken: 'token'
    })
    const advanced = planeConnectFormReducer(withUrl, { type: 'toggleAdvanced' })
    expect(toPlaneConnectArgs(advanced)).toMatchObject({ apiBaseUrl: 'https://api.example.com' })
  })

  it('requires consent for plain http to a remote host and drops it when the URL changes', () => {
    const state = run(
      { type: 'selectHost', hostKind: 'self-hosted' },
      field('serverUrl', 'http://plane.example.com'),
      field('workspaceSlug', 'acme'),
      field('apiToken', 'token')
    )
    expect(needsInsecureHttpConsent(state)).toBe(true)
    expect(canSubmitPlaneCredentials(state)).toBe(false)
    const agreed = planeConnectFormReducer(state, { type: 'acknowledgeInsecureHttp', value: true })
    expect(toPlaneConnectArgs(agreed)).toMatchObject({ insecureHttpAcknowledged: true })
    const edited = planeConnectFormReducer(agreed, field('serverUrl', 'http://other.example.com'))
    expect(edited.insecureHttpAcknowledged).toBe(false)
    expect(canSubmitPlaneCredentials(edited)).toBe(false)
  })

  it('does not ask for consent on loopback http', () => {
    const state = run(
      { type: 'selectHost', hostKind: 'self-hosted' },
      field('serverUrl', 'http://localhost:8080')
    )
    expect(needsInsecureHttpConsent(state)).toBe(false)
  })

  it('fills the slug from a pasted browser URL and flags a Cloud URL in the self-hosted form', () => {
    const selfHosted = run(
      { type: 'selectHost', hostKind: 'self-hosted' },
      field('serverUrl', 'https://plane.example.com/acme/projects/')
    )
    expect(selfHosted.workspaceSlug).toBe('acme')
    const cloud = run(
      { type: 'selectHost', hostKind: 'self-hosted' },
      field('serverUrl', 'https://app.plane.so/acme/projects/')
    )
    expect(isCloudUrlInSelfHostedForm(cloud)).toBe(true)
  })

  it('clears the token when switching host kind and after connecting', () => {
    const typed = run({ type: 'selectHost', hostKind: 'cloud' }, field('apiToken', 'secret'))
    expect(
      planeConnectFormReducer(typed, { type: 'selectHost', hostKind: 'self-hosted' }).apiToken
    ).toBe('')
    const connected = planeConnectFormReducer(typed, {
      type: 'connected',
      projects: [PROJECT],
      scope: null
    })
    expect(connected).toMatchObject({ step: 'scope', apiToken: '', projects: [PROJECT] })
  })

  it('keeps the error until the user edits a field', () => {
    const failed = run(
      { type: 'selectHost', hostKind: 'cloud' },
      { type: 'submitStarted' },
      { type: 'submitFailed', error: { kind: 'auth', field: 'apiToken' } }
    )
    expect(failed).toMatchObject({ submitting: false, error: { kind: 'auth' } })
    expect(planeConnectFormReducer(failed, field('apiToken', 'new')).error).toBeNull()
  })

  it('only saves a scope that names at least one project or all of them', () => {
    expect(getPlaneScopeToSave(null)).toBeNull()
    expect(getPlaneScopeToSave({ mode: 'selected', projectIds: [] })).toBeNull()
    expect(getPlaneScopeToSave({ mode: 'selected', projectIds: [PROJECT.id] })).toEqual({
      mode: 'selected',
      projectIds: [PROJECT.id]
    })
    expect(getPlaneScopeToSave({ mode: 'all' })).toEqual({ mode: 'all' })
  })

  it('opens straight on the scope step when editing projects', () => {
    expect(
      planeConnectFormReducer(INITIAL_PLANE_CONNECT_FORM, {
        type: 'editScope',
        projects: [PROJECT],
        scope: { mode: 'all' }
      })
    ).toMatchObject({ step: 'scope', scope: { mode: 'all' }, apiToken: '' })
  })

  it('drops projects that left the live list when it reloads', () => {
    const editing = planeConnectFormReducer(INITIAL_PLANE_CONNECT_FORM, {
      type: 'editScope',
      projects: [PROJECT],
      scope: { mode: 'selected', projectIds: [PROJECT.id, 'gone'] }
    })
    expect(
      planeConnectFormReducer(editing, { type: 'projectsLoaded', projects: [PROJECT] }).scope
    ).toEqual({ mode: 'selected', projectIds: [PROJECT.id] })
  })
})
