import type { PlaneConnection } from '../../shared/plane-types'
import { getPlaneConnection, readPlaneToken } from './plane-connection-store'
import type { PlaneHttpTarget } from './plane-http'

/** Main-process only: `target` carries the token, so a session never crosses IPC or RPC. */
export type PlaneSession = { connection: PlaneConnection; target: PlaneHttpTarget }

export class PlaneNotConnectedError extends Error {
  constructor() {
    super('Plane is not connected.')
    this.name = 'PlaneNotConnectedError'
  }
}

export function planeSessionFor(connection: PlaneConnection, apiToken: string): PlaneSession {
  return { connection, target: { apiBaseUrl: connection.apiBaseUrl, apiToken } }
}

/**
 * The session for `connectionId`, or the active connection when it is absent. Throws
 * PlaneNotConnectedError, or CredentialDecryptionError for an unreadable token.
 */
export function getPlaneSession(connectionId?: string): PlaneSession {
  const connection = getPlaneConnection(connectionId)
  const token = connection ? readPlaneToken(connection.id) : null
  if (!connection || !token) {
    throw new PlaneNotConnectedError()
  }
  return planeSessionFor(connection, token)
}

/** `/workspaces/{slug}/…` segments for the session's workspace. */
export function workspaceSegments(session: PlaneSession, ...rest: string[]): string[] {
  return ['workspaces', session.connection.workspaceSlug, ...rest]
}
