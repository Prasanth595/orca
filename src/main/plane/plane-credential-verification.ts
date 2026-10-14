import type { PlaneConnectParams } from '../../shared/rpc-contract/plane-params'
import type {
  PlaneApiFlavor,
  PlaneConnectErrorKind,
  PlaneConnection,
  PlaneProject,
  PlaneViewer
} from '../../shared/plane-types'
import { normalizePlaneConnectionUrls } from '../../shared/plane-url'
import { isPlaneApiError } from './plane-api-error'
import { detectPlaneApiFlavor } from './plane-api-flavor'
import { getPlaneConnectionId } from './plane-connection-id'
import { planeApiPath, planeRequest, type PlaneHttpTarget } from './plane-http'
import { fetchPlaneProjects } from './plane-projects'

type VerificationField = 'serverUrl' | 'apiBaseUrl' | 'workspaceSlug' | 'apiToken'

export class PlaneVerificationError extends Error {
  readonly kind: PlaneConnectErrorKind
  readonly field?: VerificationField

  constructor(kind: PlaneConnectErrorKind, message: string, field?: VerificationField) {
    super(message)
    this.name = 'PlaneVerificationError'
    this.kind = kind
    if (field) {
      this.field = field
    }
  }
}

export type VerifiedPlaneConnection = {
  connection: Omit<PlaneConnection, 'projectScope' | 'connectedAt'>
  projects: PlaneProject[]
  /** Null when the workspace has no project to probe yet; the first listing probes then. */
  flavor: PlaneApiFlavor | null
}

const URL_ERROR_MESSAGES = {
  empty: 'Enter the Plane server URL.',
  invalid_url: 'Enter a valid Plane server URL.',
  unsupported_protocol: 'Use an http or https URL.',
  credentials_in_url: 'Remove the user name and password from the URL.'
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toViewer(raw: unknown): PlaneViewer {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) {
    throw new PlaneVerificationError('invalid_response', 'Plane returned an unexpected account.')
  }
  const name = [raw.display_name, raw.first_name, raw.email].find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  )
  return {
    id: raw.id,
    displayName: name?.trim() ?? raw.id,
    email: typeof raw.email === 'string' && raw.email ? raw.email : null
  }
}

// Why rewrap: the stage decides what a status means, e.g. a 404 on projects is the slug.
function stageError(error: unknown, stage: 'viewer' | 'projects' | 'flavor'): never {
  if (!isPlaneApiError(error)) {
    throw error
  }
  if (stage === 'viewer' && error.kind === 'auth') {
    throw new PlaneVerificationError('auth', error.message, 'apiToken')
  }
  if (stage === 'projects' && (error.kind === 'not_found' || error.kind === 'forbidden')) {
    throw new PlaneVerificationError(
      'workspace_not_found',
      'This token has no access to a Plane workspace with that slug.',
      'workspaceSlug'
    )
  }
  throw new PlaneVerificationError(error.kind, error.message)
}

/**
 * Checks URL, token, workspace and API flavor in that order, without saving anything.
 * Throws PlaneVerificationError, or the caller's abort.
 */
export async function verifyPlaneConnection(
  params: PlaneConnectParams,
  signal?: AbortSignal
): Promise<VerifiedPlaneConnection> {
  const urls = normalizePlaneConnectionUrls(
    params.hostKind === 'cloud'
      ? { hostKind: 'cloud' }
      : {
          hostKind: 'self-hosted',
          serverUrl: params.serverUrl ?? '',
          ...(params.apiBaseUrl ? { apiBaseUrl: params.apiBaseUrl } : {})
        }
  )
  if (!urls.ok) {
    throw new PlaneVerificationError(urls.error, URL_ERROR_MESSAGES[urls.error], urls.field)
  }
  if (urls.insecure && params.insecureHttpAcknowledged !== true) {
    throw new PlaneVerificationError(
      'insecure_http_unconfirmed',
      'Confirm sending the token over unencrypted HTTP, or use https.',
      'serverUrl'
    )
  }
  const target: PlaneHttpTarget = { apiBaseUrl: urls.apiBaseUrl, apiToken: params.apiToken }
  const slug = params.workspaceSlug

  const viewer = await planeRequest(target, planeApiPath('users', 'me'), { signal }).then(
    toViewer,
    (error: unknown) => stageError(error, 'viewer')
  )
  const projects = await fetchPlaneProjects(target, slug, signal).catch((error: unknown) =>
    stageError(error, 'projects')
  )
  const flavor = projects[0]
    ? await detectPlaneApiFlavor(target, slug, projects[0].id, signal).catch((error: unknown) =>
        stageError(error, 'flavor')
      )
    : null

  return {
    connection: {
      id: getPlaneConnectionId(urls.apiBaseUrl, slug, viewer.id),
      hostKind: urls.hostKind,
      apiBaseUrl: urls.apiBaseUrl,
      webBaseUrl: urls.webBaseUrl,
      workspaceSlug: slug,
      viewer,
      ...(urls.insecure ? { insecureHttpAcknowledged: true } : {})
    },
    projects,
    flavor
  }
}
