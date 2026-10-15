import { translate } from '@/i18n/i18n'
import { PLANE_ALL_WORKSPACES } from '@/store/slices/plane-slice-contract'
import type {
  PlaneConnection,
  PlaneConnectionEntry,
  PlaneConnectionStatus
} from '../../../../../shared/plane-types'

/** Where a workspace is served, named the same way for Cloud and self-hosted servers. */
export function getPlaneServerLabel(connection: PlaneConnection): string {
  if (connection.hostKind === 'cloud') {
    return translate('plane.workspaceSwitcher.cloud', 'Plane Cloud')
  }
  try {
    return new URL(connection.webBaseUrl).host
  } catch {
    return connection.webBaseUrl
  }
}

/** e.g. "acme · plane.example.com" or "acme · Plane Cloud". */
export function getPlaneWorkspaceLabel(connection: PlaneConnection): string {
  return `${connection.workspaceSlug} · ${getPlaneServerLabel(connection)}`
}

/**
 * The workspace the Tasks tab shows: the remembered choice while it still exists, else the
 * host's active connection. "All workspaces" only makes sense with two or more.
 */
export function resolvePlaneTasksWorkspace(
  choice: string | null,
  entries: readonly PlaneConnectionEntry[],
  activeConnectionId: string
): string {
  if (entries.length < 2) {
    return entries[0]?.connection.id ?? activeConnectionId
  }
  if (choice === PLANE_ALL_WORKSPACES) {
    return choice
  }
  return entries.some((entry) => entry.connection.id === choice) && choice
    ? choice
    : activeConnectionId
}

/** What the Tasks source chip names for Plane: the chosen workspace's slug, or all of them. */
export function getPlaneTasksSourceLabel(
  status: PlaneConnectionStatus,
  choice: string | null
): string | null {
  if (!status.connected) {
    return null
  }
  const workspaceId = resolvePlaneTasksWorkspace(choice, status.connections, status.connection.id)
  if (workspaceId === PLANE_ALL_WORKSPACES) {
    return translate('plane.workspaceSwitcher.all', 'All workspaces')
  }
  const chosen = status.connections.find((entry) => entry.connection.id === workspaceId)
  return (chosen?.connection ?? status.connection).workspaceSlug
}

export type PlaneWorkspaceBlock = {
  connection: PlaneConnection
  reason: 'credential' | 'needs-scope'
}

/** Splits workspaces into those the merged view can list and those that need the user first. */
export function partitionPlaneWorkspaces(entries: readonly PlaneConnectionEntry[]): {
  listable: PlaneConnection[]
  blocked: PlaneWorkspaceBlock[]
} {
  const listable: PlaneConnection[] = []
  const blocked: PlaneWorkspaceBlock[] = []
  for (const entry of entries) {
    if (entry.credentialError) {
      blocked.push({ connection: entry.connection, reason: 'credential' })
    } else if (entry.connection.projectScope === null) {
      blocked.push({ connection: entry.connection, reason: 'needs-scope' })
    } else {
      listable.push(entry.connection)
    }
  }
  return { listable, blocked }
}
