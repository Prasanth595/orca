import type { PlaneConnectArgs } from '../../../../preload/api/plane-api'
import { normalizePlaneWorkspaceSlug } from '../../../../shared/plane-ids'
import type { PlaneHostKind, PlaneProject, PlaneProjectScope } from '../../../../shared/plane-types'
import {
  normalizePlaneConnectionUrls,
  type PlaneConnectionUrls
} from '../../../../shared/plane-url'
import type { PlaneErrorKind } from './plane-error-copy'

export type PlaneConnectField = 'serverUrl' | 'apiBaseUrl' | 'workspaceSlug' | 'apiToken'

/** A scope while it is being chosen; a `selected` draft may still be empty. */
export type PlaneScopeDraft = { mode: 'all' } | { mode: 'selected'; projectIds: string[] } | null

export type PlaneConnectFormError = { kind: PlaneErrorKind; field?: PlaneConnectField }

export type PlaneConnectFormState = {
  step: 'credentials' | 'scope'
  hostKind: PlaneHostKind | null
  serverUrl: string
  apiBaseUrl: string
  advancedOpen: boolean
  workspaceSlug: string
  apiToken: string
  insecureHttpAcknowledged: boolean
  submitting: boolean
  error: PlaneConnectFormError | null
  projects: PlaneProject[]
  scope: PlaneScopeDraft
}

export type PlaneConnectFormAction =
  | { type: 'reset' }
  | { type: 'editScope'; projects: PlaneProject[]; scope: PlaneProjectScope | null }
  | { type: 'selectHost'; hostKind: PlaneHostKind }
  | { type: 'setField'; field: PlaneConnectField; value: string }
  | { type: 'toggleAdvanced' }
  | { type: 'acknowledgeInsecureHttp'; value: boolean }
  | { type: 'submitStarted' }
  | { type: 'submitFailed'; error: PlaneConnectFormError }
  | { type: 'connected'; projects: PlaneProject[]; scope: PlaneProjectScope | null }
  | { type: 'setScope'; scope: PlaneScopeDraft }
  | { type: 'projectsLoaded'; projects: PlaneProject[] }

export const INITIAL_PLANE_CONNECT_FORM: PlaneConnectFormState = {
  step: 'credentials',
  hostKind: null,
  serverUrl: '',
  apiBaseUrl: '',
  advancedOpen: false,
  workspaceSlug: '',
  apiToken: '',
  insecureHttpAcknowledged: false,
  submitting: false,
  error: null,
  projects: [],
  scope: null
}

export function getPlaneConnectUrls(state: PlaneConnectFormState): PlaneConnectionUrls | null {
  if (state.hostKind === 'cloud') {
    return normalizePlaneConnectionUrls({ hostKind: 'cloud' })
  }
  if (state.hostKind === 'self-hosted' && state.serverUrl.trim()) {
    return normalizePlaneConnectionUrls({
      hostKind: 'self-hosted',
      serverUrl: state.serverUrl,
      ...(state.advancedOpen ? { apiBaseUrl: state.apiBaseUrl } : {})
    })
  }
  return null
}

/** Plain http to a non-loopback host: the user must agree before the token is sent. */
export function needsInsecureHttpConsent(state: PlaneConnectFormState): boolean {
  const urls = getPlaneConnectUrls(state)
  return urls?.ok === true && urls.insecure
}

/** A Plane Cloud URL typed into the self-hosted form. */
export function isCloudUrlInSelfHostedForm(state: PlaneConnectFormState): boolean {
  const urls = getPlaneConnectUrls(state)
  return state.hostKind === 'self-hosted' && urls?.ok === true && urls.hostKind === 'cloud'
}

export function canSubmitPlaneCredentials(state: PlaneConnectFormState): boolean {
  const urls = getPlaneConnectUrls(state)
  return (
    !state.submitting &&
    urls?.ok === true &&
    normalizePlaneWorkspaceSlug(state.workspaceSlug) !== null &&
    /^\S+$/.test(state.apiToken.trim()) &&
    (!urls.insecure || state.insecureHttpAcknowledged)
  )
}

export function toPlaneConnectArgs(state: PlaneConnectFormState): PlaneConnectArgs | null {
  if (!canSubmitPlaneCredentials(state) || !state.hostKind) {
    return null
  }
  const base = { workspaceSlug: state.workspaceSlug.trim(), apiToken: state.apiToken.trim() }
  if (state.hostKind === 'cloud') {
    return { hostKind: 'cloud', ...base }
  }
  const apiBaseUrl = state.advancedOpen ? state.apiBaseUrl.trim() : ''
  return {
    hostKind: 'self-hosted',
    serverUrl: state.serverUrl.trim(),
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
    ...base,
    ...(needsInsecureHttpConsent(state) ? { insecureHttpAcknowledged: true } : {})
  }
}

/** Where Plane lists personal access tokens for this workspace, once the URL is known. */
export function getPlaneTokenSettingsUrl(state: PlaneConnectFormState): string | null {
  const urls = getPlaneConnectUrls(state)
  if (urls?.ok !== true) {
    return null
  }
  const slug = normalizePlaneWorkspaceSlug(state.workspaceSlug)
  return slug
    ? `${urls.webBaseUrl}/${encodeURIComponent(slug)}/settings/account/api-tokens`
    : urls.webBaseUrl
}

export function getPlaneScopeToSave(draft: PlaneScopeDraft): PlaneProjectScope | null {
  if (!draft) {
    return null
  }
  return draft.mode === 'all' || draft.projectIds.length > 0 ? draft : null
}

function withField(
  state: PlaneConnectFormState,
  field: PlaneConnectField,
  value: string
): PlaneConnectFormState {
  const next = { ...state, [field]: value, error: null }
  // Why: consent covers the URL the user saw; a different URL needs a fresh yes.
  if (field === 'serverUrl' || field === 'apiBaseUrl') {
    next.insecureHttpAcknowledged = false
  }
  const urls = field === 'serverUrl' ? getPlaneConnectUrls(next) : null
  if (urls?.ok && urls.slugSuggestion && !state.workspaceSlug.trim()) {
    next.workspaceSlug = urls.slugSuggestion
  }
  return next
}

export function planeConnectFormReducer(
  state: PlaneConnectFormState,
  action: PlaneConnectFormAction
): PlaneConnectFormState {
  switch (action.type) {
    case 'reset':
      return INITIAL_PLANE_CONNECT_FORM
    case 'editScope':
      return {
        ...INITIAL_PLANE_CONNECT_FORM,
        step: 'scope',
        projects: action.projects,
        scope: action.scope
      }
    case 'selectHost':
      if (state.submitting || state.hostKind === action.hostKind) {
        return state
      }
      // Why: a token typed for one server must not ride along to another.
      return {
        ...state,
        hostKind: action.hostKind,
        apiToken: '',
        insecureHttpAcknowledged: false,
        error: null
      }
    case 'setField':
      return withField(state, action.field, action.value)
    case 'toggleAdvanced':
      return { ...state, advancedOpen: !state.advancedOpen, insecureHttpAcknowledged: false }
    case 'acknowledgeInsecureHttp':
      return { ...state, insecureHttpAcknowledged: action.value, error: null }
    case 'submitStarted':
      return { ...state, submitting: true, error: null }
    case 'submitFailed':
      return { ...state, submitting: false, error: action.error }
    case 'connected':
      // Why: the token has done its job; drop it from memory before the scope step.
      return {
        ...state,
        step: 'scope',
        apiToken: '',
        submitting: false,
        error: null,
        projects: action.projects,
        scope: action.scope
      }
    case 'setScope':
      return { ...state, scope: action.scope, error: null }
    case 'projectsLoaded': {
      // Why: a project that left the live list can no longer be chosen or saved.
      const liveIds = new Set(action.projects.map((project) => project.id))
      const scope =
        state.scope?.mode === 'selected'
          ? {
              mode: 'selected' as const,
              projectIds: state.scope.projectIds.filter((id) => liveIds.has(id))
            }
          : state.scope
      return { ...state, projects: action.projects, scope }
    }
  }
}
