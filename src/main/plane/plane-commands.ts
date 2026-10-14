import type {
  PlaneConnectParams,
  PlaneDisconnectParams,
  PlaneSetProjectScopeParams
} from '../../shared/rpc-contract/plane-params'
import type {
  PlaneConnectResult,
  PlaneConnection,
  PlaneConnectionEntry,
  PlaneConnectionStatus,
  PlaneProject
} from '../../shared/plane-types'
import { CredentialDecryptionError } from '../integration-credential-file'
import { forgetPlaneApiFlavor, rememberPlaneApiFlavor } from './plane-api-flavor'
import {
  deletePlaneToken,
  getPlaneConnection,
  getPlaneCredentialError,
  getPlaneTokenProtection,
  readPlaneConnectionFile,
  readPlaneToken,
  savePlaneToken,
  writePlaneConnectionFile
} from './plane-connection-store'
import {
  PlaneVerificationError,
  resolvePlaneConnectUrls,
  verifyPlaneWorkspace,
  type PlaneVerifiedUrls
} from './plane-credential-verification'
import { forgetPlaneProjectMetadata } from './plane-project-metadata'
import { forgetPlaneProjects, getPlaneProjects, primePlaneProjects } from './plane-projects'
import { redactPlaneSecrets } from './plane-redact'
import { getPlaneSession, PlaneNotConnectedError } from './plane-session'

// Why one module: IPC (local) and runtime RPC (remote host) both call these, so the two
// paths cannot drift on validation, persistence or what the result exposes.

function toEntry(connection: PlaneConnection): PlaneConnectionEntry {
  const credentialError = getPlaneCredentialError(connection.id)
  return {
    connection,
    ...(credentialError ? { credentialError } : {}),
    credentialProtection: getPlaneTokenProtection(connection.id)
  }
}

export function planeStatus(): PlaneConnectionStatus {
  const file = readPlaneConnectionFile()
  const entries = file.connections.map(toEntry)
  const active = entries.find((entry) => entry.connection.id === file.activeConnectionId)
  if (!active) {
    return { connected: false }
  }
  return { connected: true, ...active, connections: entries }
}

function forgetConnection(connectionId: string): void {
  deletePlaneToken(connectionId)
  forgetPlaneApiFlavor(connectionId)
  forgetPlaneProjects(connectionId)
  forgetPlaneProjectMetadata(connectionId)
}

type ConnectSource = { urls: PlaneVerifiedUrls; apiToken: string; secrets: string[] }

// Why the source's URLs on reuse: a saved token may only ever go back to its own server.
function connectSource(params: PlaneConnectParams): ConnectSource {
  if ('apiToken' in params) {
    return {
      urls: resolvePlaneConnectUrls(params),
      apiToken: params.apiToken,
      secrets: [params.apiToken]
    }
  }
  const source = getPlaneConnection(params.reuseTokenFromConnectionId)
  let apiToken: string | null = null
  try {
    apiToken = source ? readPlaneToken(source.id) : null
  } catch (error) {
    if (error instanceof CredentialDecryptionError) {
      throw new PlaneVerificationError('credential_unreadable', error.message)
    }
    throw error
  }
  if (!source || !apiToken) {
    throw new PlaneVerificationError('not_connected', 'That Plane connection is no longer saved.')
  }
  return {
    urls: {
      hostKind: source.hostKind,
      apiBaseUrl: source.apiBaseUrl,
      webBaseUrl: source.webBaseUrl,
      insecure: source.insecureHttpAcknowledged === true
    },
    apiToken,
    secrets: [apiToken]
  }
}

/** Adds the workspace, or updates it when the same account reconnects; others are untouched. */
export async function planeConnect(
  params: PlaneConnectParams,
  signal?: AbortSignal
): Promise<PlaneConnectResult> {
  let secrets: string[] = []
  try {
    const source = connectSource(params)
    secrets = source.secrets
    const verified = await verifyPlaneWorkspace(
      source.urls,
      source.apiToken,
      params.workspaceSlug,
      signal
    )
    const previous = readPlaneConnectionFile()
    const sameConnection = previous.connections.find((c) => c.id === verified.connection.id)
    const connection: PlaneConnection = {
      ...verified.connection,
      // Reconnecting the same account keeps its scope; a new workspace starts by choosing.
      projectScope: sameConnection?.projectScope ?? null,
      connectedAt: Date.now()
    }
    savePlaneToken(connection.id, source.apiToken)
    writePlaneConnectionFile({
      version: 1,
      activeConnectionId: previous.activeConnectionId ?? connection.id,
      connections: sameConnection
        ? previous.connections.map((c) => (c.id === connection.id ? connection : c))
        : [...previous.connections, connection]
    })
    forgetPlaneProjects(connection.id)
    primePlaneProjects(connection.id, verified.projects)
    if (verified.flavor) {
      rememberPlaneApiFlavor(connection.id, verified.flavor)
    }
    return { ok: true, status: planeStatus(), connection, projects: verified.projects }
  } catch (error) {
    if (error instanceof PlaneVerificationError) {
      return {
        ok: false,
        error: error.kind,
        message: redactPlaneSecrets(error.message, secrets),
        ...(error.field ? { field: error.field } : {})
      }
    }
    throw error
  }
}

/** Removes one workspace, or every workspace when no connectionId is given. */
export function planeDisconnect(params?: PlaneDisconnectParams): PlaneConnectionStatus {
  const file = readPlaneConnectionFile()
  const removed = params?.connectionId
    ? file.connections.filter((c) => c.id === params.connectionId)
    : file.connections
  for (const connection of removed) {
    forgetConnection(connection.id)
  }
  const removedIds = new Set(removed.map((c) => c.id))
  const connections = file.connections.filter((c) => !removedIds.has(c.id))
  writePlaneConnectionFile({
    version: 1,
    activeConnectionId: removedIds.has(file.activeConnectionId ?? '')
      ? (connections[0]?.id ?? null)
      : file.activeConnectionId,
    connections
  })
  return planeStatus()
}

export function planeSetProjectScope(params: PlaneSetProjectScopeParams): PlaneConnectionStatus {
  const file = readPlaneConnectionFile()
  const target = getPlaneConnection(params.connectionId)
  if (!target) {
    throw new PlaneNotConnectedError()
  }
  writePlaneConnectionFile({
    ...file,
    connections: file.connections.map((c) =>
      c.id === target.id ? { ...c, projectScope: params.scope } : c
    )
  })
  return planeStatus()
}

/** Every live project of one workspace, unscoped: the scope picker needs the full list. */
export function planeListProjects(
  options: { refresh?: boolean; connectionId?: string; signal?: AbortSignal } = {}
): Promise<PlaneProject[]> {
  const session = getPlaneSession(options.connectionId)
  return getPlaneProjects(session.connection.id, session.target, session.connection.workspaceSlug, {
    refresh: options.refresh,
    signal: options.signal
  })
}
