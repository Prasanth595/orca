import type {
  PlaneConnectParams,
  PlaneSetProjectScopeParams
} from '../../shared/rpc-contract/plane-params'
import type {
  PlaneConnectResult,
  PlaneConnection,
  PlaneConnectionStatus,
  PlaneProject
} from '../../shared/plane-types'
import { forgetPlaneApiFlavor, rememberPlaneApiFlavor } from './plane-api-flavor'
import {
  deletePlaneToken,
  getActivePlaneConnection,
  getPlaneCredentialError,
  getPlaneTokenProtection,
  readPlaneConnectionFile,
  savePlaneToken,
  writePlaneConnectionFile
} from './plane-connection-store'
import { PlaneVerificationError, verifyPlaneConnection } from './plane-credential-verification'
import { forgetPlaneProjectMetadata } from './plane-project-metadata'
import { forgetPlaneProjects, getPlaneProjects, primePlaneProjects } from './plane-projects'
import { redactPlaneSecrets } from './plane-redact'
import { getActivePlaneSession, PlaneNotConnectedError } from './plane-session'

// Why one module: IPC (local) and runtime RPC (remote host) both call these, so the two
// paths cannot drift on validation, persistence or what the result exposes.

export function planeStatus(): PlaneConnectionStatus {
  const connection = getActivePlaneConnection()
  if (!connection) {
    return { connected: false }
  }
  const credentialError = getPlaneCredentialError(connection.id)
  return {
    connected: true,
    connection,
    ...(credentialError ? { credentialError } : {}),
    credentialProtection: getPlaneTokenProtection(connection.id)
  }
}

function forgetConnection(connectionId: string): void {
  deletePlaneToken(connectionId)
  forgetPlaneApiFlavor(connectionId)
  forgetPlaneProjects(connectionId)
  forgetPlaneProjectMetadata(connectionId)
}

export async function planeConnect(
  params: PlaneConnectParams,
  signal?: AbortSignal
): Promise<PlaneConnectResult> {
  try {
    const verified = await verifyPlaneConnection(params, signal)
    const previous = readPlaneConnectionFile()
    const sameConnection = previous.connections.find((c) => c.id === verified.connection.id)
    const connection: PlaneConnection = {
      ...verified.connection,
      // Reconnecting the same account keeps its scope; a new one starts by choosing.
      projectScope: sameConnection?.projectScope ?? null,
      connectedAt: Date.now()
    }
    savePlaneToken(connection.id, params.apiToken)
    // Why replace the others: v1 shows one connection, and a hidden one would keep a token
    // nobody can disconnect.
    for (const other of previous.connections) {
      if (other.id !== connection.id) {
        forgetConnection(other.id)
      }
    }
    writePlaneConnectionFile({
      version: 1,
      activeConnectionId: connection.id,
      connections: [connection]
    })
    forgetPlaneProjects(connection.id)
    primePlaneProjects(connection.id, verified.projects)
    if (verified.flavor) {
      rememberPlaneApiFlavor(connection.id, verified.flavor)
    }
    return { ok: true, status: planeStatus(), projects: verified.projects }
  } catch (error) {
    if (error instanceof PlaneVerificationError) {
      return {
        ok: false,
        error: error.kind,
        message: redactPlaneSecrets(error.message, [params.apiToken]),
        ...(error.field ? { field: error.field } : {})
      }
    }
    throw error
  }
}

export function planeDisconnect(): PlaneConnectionStatus {
  const file = readPlaneConnectionFile()
  for (const connection of file.connections) {
    forgetConnection(connection.id)
  }
  writePlaneConnectionFile({ version: 1, activeConnectionId: null, connections: [] })
  return planeStatus()
}

export function planeSetProjectScope(params: PlaneSetProjectScopeParams): PlaneConnectionStatus {
  const file = readPlaneConnectionFile()
  const active = file.connections.find((c) => c.id === file.activeConnectionId)
  if (!active) {
    throw new PlaneNotConnectedError()
  }
  writePlaneConnectionFile({
    ...file,
    connections: file.connections.map((c) =>
      c.id === active.id ? { ...c, projectScope: params.scope } : c
    )
  })
  return planeStatus()
}

/** Every live project, unscoped: the scope picker needs the full list. */
export function planeListProjects(
  options: { refresh?: boolean; signal?: AbortSignal } = {}
): Promise<PlaneProject[]> {
  const session = getActivePlaneSession()
  return getPlaneProjects(
    session.connection.id,
    session.target,
    session.connection.workspaceSlug,
    options
  )
}
