import type { PlaneHostKind, PlaneProject, PlaneProjectScope } from '../../../../shared/plane-types'
import { getPlaneConnectUrls } from './plane-connect-form-selectors'
import type { PlaneErrorKind } from './plane-error-copy'
import {
  addPlaneWorkspaceChips,
  parsePlaneSlugEntries,
  updatePlaneWorkspaceChip,
  type PlaneWorkspaceChip
} from './plane-workspace-chips'

export type PlaneConnectField = 'serverUrl' | 'apiBaseUrl' | 'workspaceSlug' | 'apiToken'
export type PlaneTextField = 'serverUrl' | 'apiBaseUrl' | 'apiToken'

/** A scope while it is being chosen; a `selected` draft may still be empty. */
export type PlaneScopeDraft = { mode: 'all' } | { mode: 'selected'; projectIds: string[] } | null

export type PlaneConnectFormError = { kind: PlaneErrorKind; field?: PlaneConnectField }

/** A saved connection whose token, kept on the host, adds more workspaces on its server. */
export type PlaneReuseSource = { connectionId: string; slug: string; server: string }

export type PlaneScopeWorkspace = {
  connectionId: string
  slug: string
  projects: PlaneProject[]
  scope: PlaneScopeDraft
}

export type PlaneConnectFormState = {
  step: 'credentials' | 'scope'
  reuseFrom: PlaneReuseSource | null
  hostKind: PlaneHostKind | null
  serverUrl: string
  apiBaseUrl: string
  advancedOpen: boolean
  slugDraft: string
  chips: PlaneWorkspaceChip[]
  apiToken: string
  insecureHttpAcknowledged: boolean
  submitting: boolean
  error: PlaneConnectFormError | null
  workspaces: PlaneScopeWorkspace[]
}

export type PlaneConnectFormAction =
  | { type: 'reset' }
  | { type: 'addWorkspace'; source: PlaneReuseSource }
  | { type: 'editScope'; workspaces: PlaneScopeWorkspace[] }
  | { type: 'selectHost'; hostKind: PlaneHostKind }
  | { type: 'setField'; field: PlaneTextField; value: string }
  | { type: 'toggleAdvanced' }
  | { type: 'acknowledgeInsecureHttp'; value: boolean }
  | { type: 'setSlugDraft'; value: string }
  | { type: 'commitSlugDraft' }
  | { type: 'pasteSlugs'; text: string }
  | { type: 'removeChip'; slug: string }
  | { type: 'chipStarted'; slug: string }
  | {
      type: 'chipConnected'
      slug: string
      connectionId: string
      projects: PlaneProject[]
      scope: PlaneProjectScope | null
    }
  | { type: 'chipFailed'; slug: string; error: PlaneErrorKind }
  | { type: 'submitStarted' }
  | { type: 'submitFinished' }
  | { type: 'submitFailed'; error: PlaneConnectFormError }
  | { type: 'goToScope' }
  | { type: 'setScope'; connectionId: string; scope: PlaneScopeDraft }
  | { type: 'projectsLoaded'; connectionId: string; projects: PlaneProject[] }

export const INITIAL_PLANE_CONNECT_FORM: PlaneConnectFormState = {
  step: 'credentials',
  reuseFrom: null,
  hostKind: null,
  serverUrl: '',
  apiBaseUrl: '',
  advancedOpen: false,
  slugDraft: '',
  chips: [],
  apiToken: '',
  insecureHttpAcknowledged: false,
  submitting: false,
  error: null,
  workspaces: []
}

function withField(
  state: PlaneConnectFormState,
  field: PlaneTextField,
  value: string
): PlaneConnectFormState {
  const next = { ...state, [field]: value, error: null }
  // Why: consent covers the URL the user saw; a different URL needs a fresh yes.
  if (field === 'serverUrl' || field === 'apiBaseUrl') {
    next.insecureHttpAcknowledged = false
  }
  const urls = field === 'serverUrl' ? getPlaneConnectUrls(next) : null
  if (urls?.ok && urls.slugSuggestion && state.chips.length === 0) {
    next.chips = addPlaneWorkspaceChips([], [urls.slugSuggestion])
  }
  return next
}

// Why: a pasted browser URL also names its server, which fills an empty server field.
function withPastedSlugs(state: PlaneConnectFormState, text: string): PlaneConnectFormState {
  const entries = parsePlaneSlugEntries(text)
  const next = {
    ...state,
    chips: addPlaneWorkspaceChips(state.chips, entries.slugs),
    slugDraft: entries.invalid.join(' '),
    error: null
  }
  const server = entries.server
  if (!server || state.reuseFrom || state.serverUrl.trim() || state.hostKind === 'cloud') {
    return next
  }
  return server.hostKind === 'cloud'
    ? { ...next, hostKind: 'cloud', apiToken: '', insecureHttpAcknowledged: false }
    : { ...next, hostKind: 'self-hosted', serverUrl: server.serverUrl }
}

function withConnectedChip(
  state: PlaneConnectFormState,
  action: Extract<PlaneConnectFormAction, { type: 'chipConnected' }>
): PlaneConnectFormState {
  const workspace: PlaneScopeWorkspace = {
    connectionId: action.connectionId,
    slug: action.slug,
    projects: action.projects,
    // Why 'all' by default: a new workspace shows its work right away; the user can narrow it.
    scope: action.scope ?? { mode: 'all' }
  }
  return {
    ...state,
    chips: updatePlaneWorkspaceChip(state.chips, action.slug, {
      status: 'connected',
      connectionId: action.connectionId,
      projectCount: action.projects.length
    }),
    workspaces: [
      ...state.workspaces.filter((w) => w.connectionId !== action.connectionId),
      workspace
    ]
  }
}

function withWorkspace(
  state: PlaneConnectFormState,
  connectionId: string,
  patch: (workspace: PlaneScopeWorkspace) => PlaneScopeWorkspace
): PlaneConnectFormState {
  return {
    ...state,
    error: null,
    workspaces: state.workspaces.map((w) => (w.connectionId === connectionId ? patch(w) : w))
  }
}

export function planeConnectFormReducer(
  state: PlaneConnectFormState,
  action: PlaneConnectFormAction
): PlaneConnectFormState {
  switch (action.type) {
    case 'reset':
      return INITIAL_PLANE_CONNECT_FORM
    case 'addWorkspace':
      return { ...INITIAL_PLANE_CONNECT_FORM, reuseFrom: action.source }
    case 'editScope':
      return { ...INITIAL_PLANE_CONNECT_FORM, step: 'scope', workspaces: action.workspaces }
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
    case 'setSlugDraft':
      // Why: a comma or space ends a slug, so typing "a, b" leaves two chips and an empty field.
      return /[\s,]/.test(action.value)
        ? withPastedSlugs(state, action.value)
        : { ...state, slugDraft: action.value, error: null }
    case 'commitSlugDraft':
      return withPastedSlugs(state, state.slugDraft)
    case 'pasteSlugs':
      return withPastedSlugs(state, `${state.slugDraft} ${action.text}`)
    case 'removeChip':
      return {
        ...state,
        chips: state.chips.filter((chip) => chip.slug !== action.slug),
        workspaces: state.workspaces.filter((w) => w.slug !== action.slug)
      }
    case 'chipStarted':
      return {
        ...state,
        chips: updatePlaneWorkspaceChip(state.chips, action.slug, { status: 'connecting' })
      }
    case 'chipConnected':
      return withConnectedChip(state, action)
    case 'chipFailed':
      return {
        ...state,
        chips: updatePlaneWorkspaceChip(state.chips, action.slug, {
          status: 'failed',
          error: action.error
        })
      }
    case 'submitStarted':
      return { ...state, submitting: true, error: null }
    case 'submitFinished':
      return { ...state, submitting: false }
    case 'submitFailed':
      // Why: a form-wide failure (token, URL, network) says nothing about the chip in flight.
      return {
        ...state,
        submitting: false,
        error: action.error,
        chips: state.chips.map((chip) =>
          chip.status === 'connecting' ? { slug: chip.slug, status: 'pending' } : chip
        )
      }
    case 'goToScope':
      // Why: the token has done its job; drop it from memory before the scope step.
      return { ...state, step: 'scope', apiToken: '', submitting: false, error: null }
    case 'setScope':
      return withWorkspace(state, action.connectionId, (w) => ({ ...w, scope: action.scope }))
    case 'projectsLoaded':
      // Why: a project that left the live list can no longer be chosen or saved.
      return withWorkspace(state, action.connectionId, (w) => {
        const liveIds = new Set(action.projects.map((project) => project.id))
        const scope: PlaneScopeDraft =
          w.scope?.mode === 'selected'
            ? { mode: 'selected', projectIds: w.scope.projectIds.filter((id) => liveIds.has(id)) }
            : w.scope
        return { ...w, projects: action.projects, scope }
      })
  }
}
