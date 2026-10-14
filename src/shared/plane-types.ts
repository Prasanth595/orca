import type { SecretAtRestProtection } from './secret-at-rest-protection'

// Why no token field anywhere here: every type in this module may cross to the renderer.

export type PlaneHostKind = 'cloud' | 'self-hosted'

/** The path Plane serves work items under; `issues` is the older name for the same resource. */
export type PlaneApiFlavor = 'work-items' | 'issues'
export const PLANE_API_FLAVORS: readonly PlaneApiFlavor[] = ['work-items', 'issues']

export type PlaneProjectScope =
  // Resolved against the live project list on every refresh, so new projects appear.
  | { mode: 'all' }
  // Non-empty, unique project UUIDs.
  | { mode: 'selected'; projectIds: string[] }

export type PlaneViewer = { id: string; displayName: string; email: string | null }

export type PlaneConnection = {
  id: string
  hostKind: PlaneHostKind
  /** Origin plus optional path prefix, without `/api/v1` or a trailing slash. */
  apiBaseUrl: string
  webBaseUrl: string
  /** Lowercase. */
  workspaceSlug: string
  viewer: PlaneViewer
  /** Null when the user must choose, including a saved selection that no longer resolves. */
  projectScope: PlaneProjectScope | null
  insecureHttpAcknowledged?: true
  connectedAt: number
}

export type PlaneConnectionFile = {
  version: 1
  activeConnectionId: string | null
  connections: PlaneConnection[]
}

export type PlaneConnectionStatus =
  | { connected: false; credentialError?: string }
  | {
      connected: true
      connection: PlaneConnection
      credentialError?: string
      credentialProtection: SecretAtRestProtection | null
    }

export type PlaneProject = { id: string; name: string; identifier: string }

export const PLANE_STATE_GROUPS = [
  'backlog',
  'unstarted',
  'started',
  'completed',
  'cancelled',
  'triage'
] as const
export type PlaneStateGroup = (typeof PLANE_STATE_GROUPS)[number]

export type PlaneState = {
  id: string
  name: string
  group: PlaneStateGroup
  color: string
  sequence: number
}

export type PlaneMember = { id: string; displayName: string }

export const PLANE_PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const
export type PlanePriority = (typeof PLANE_PRIORITIES)[number]

export type PlaneLabel = { id: string; name: string; color: string }

export type PlaneWorkItem = {
  connectionId: string
  id: string
  projectId: string
  projectIdentifier: string
  sequenceId: number
  /** `${projectIdentifier}-${sequenceId}`, e.g. WEB-12. */
  identifier: string
  name: string
  state: PlaneState | null
  priority: PlanePriority
  assignees: PlaneMember[]
  labels: PlaneLabel[]
  createdAt: string
  updatedAt: string
  url: string
}

export type PlaneWorkItemDetail = PlaneWorkItem & { descriptionText: string; truncated: boolean }

export type PlaneComment = { id: string; authorName: string; text: string; createdAt: string }

export const PLANE_API_ERROR_KINDS = [
  'auth',
  'forbidden',
  'not_found',
  'rate_limited',
  'network',
  'tls',
  'redirect',
  'invalid_response',
  // Any other 4xx, e.g. a 400 for a state the item cannot move to.
  'rejected'
] as const
export type PlaneApiErrorKind = (typeof PLANE_API_ERROR_KINDS)[number]

export type PlaneListError = { projectId?: string; kind: PlaneApiErrorKind }

export type PlaneWorkItemList = {
  items: PlaneWorkItem[]
  errors: PlaneListError[]
  missingProjectIds: string[]
  truncatedProjectIds: string[]
  /** Where "load more" resumes, for each project in `truncatedProjectIds`. */
  nextCursorByProject?: Record<string, string>
  totalCapped: boolean
  /** The saved scope is missing or no longer usable; the user must choose projects. */
  needsScope?: true
}

export type PlaneUrlErrorKind =
  | 'empty'
  | 'invalid_url'
  | 'unsupported_protocol'
  | 'credentials_in_url'

export type PlaneConnectErrorKind =
  | PlaneApiErrorKind
  | PlaneUrlErrorKind
  // Plain http to a non-loopback host without the user's explicit consent.
  | 'insecure_http_unconfirmed'
  // The token works but the workspace slug does not resolve for it.
  | 'workspace_not_found'

export type PlaneConnectResult =
  | { ok: true; status: PlaneConnectionStatus; projects: PlaneProject[] }
  | {
      ok: false
      error: PlaneConnectErrorKind
      message: string
      field?: 'serverUrl' | 'apiBaseUrl' | 'workspaceSlug' | 'apiToken'
    }

export type PlaneOperationErrorKind =
  | PlaneApiErrorKind
  // No active connection on the executing host.
  | 'not_connected'
  // The saved token exists but this host cannot decrypt it (e.g. keychain access denied).
  | 'credential_unreadable'

export type PlaneOperationError = { kind: PlaneOperationErrorKind; message: string }

/** Every Plane read and write answers in this shape over IPC and runtime RPC alike. */
export type PlaneResult<T> = { ok: true; value: T } | { ok: false; error: PlaneOperationError }
