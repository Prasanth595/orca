import type { PlaneApiFlavor } from '../../shared/plane-types'
import { isPlaneApiError } from './plane-api-error'
import { planeApiPath, planeRequest, type PlaneHttpTarget } from './plane-http'

const flavorByConnection = new Map<string, PlaneApiFlavor>()

function probe(
  target: PlaneHttpTarget,
  workspaceSlug: string,
  projectId: string,
  flavor: PlaneApiFlavor,
  signal?: AbortSignal
): Promise<unknown> {
  const path = planeApiPath('workspaces', workspaceSlug, 'projects', projectId, flavor)
  return planeRequest(target, path, { query: { per_page: '1' }, signal })
}

// Why only a missing route counts: a missing project or a permission gap says nothing about
// which path serves work items.
function isMissingRoute(error: unknown): boolean {
  return isPlaneApiError(error) && error.kind === 'not_found' && error.routeMissing === true
}

/**
 * Asks a real project which path serves work items: `work-items`, or the older `issues`.
 * Any other failure is rethrown, because it does not tell the two apart.
 */
export async function detectPlaneApiFlavor(
  target: PlaneHttpTarget,
  workspaceSlug: string,
  projectId: string,
  signal?: AbortSignal
): Promise<PlaneApiFlavor> {
  try {
    await probe(target, workspaceSlug, projectId, 'work-items', signal)
    return 'work-items'
  } catch (error) {
    if (!isMissingRoute(error)) {
      throw error
    }
  }
  await probe(target, workspaceSlug, projectId, 'issues', signal)
  return 'issues'
}

export function cachedPlaneApiFlavor(connectionId: string): PlaneApiFlavor | null {
  return flavorByConnection.get(connectionId) ?? null
}

export function rememberPlaneApiFlavor(connectionId: string, flavor: PlaneApiFlavor): void {
  flavorByConnection.set(connectionId, flavor)
}

export function forgetPlaneApiFlavor(connectionId?: string): void {
  if (connectionId) {
    flavorByConnection.delete(connectionId)
  } else {
    flavorByConnection.clear()
  }
}

/** The cached flavor for a connection, probing `projectId` once when none is known yet. */
export async function resolvePlaneApiFlavor(
  connectionId: string,
  target: PlaneHttpTarget,
  workspaceSlug: string,
  projectId: string,
  signal?: AbortSignal
): Promise<PlaneApiFlavor> {
  const cached = cachedPlaneApiFlavor(connectionId)
  if (cached) {
    return cached
  }
  const flavor = await detectPlaneApiFlavor(target, workspaceSlug, projectId, signal)
  rememberPlaneApiFlavor(connectionId, flavor)
  return flavor
}
