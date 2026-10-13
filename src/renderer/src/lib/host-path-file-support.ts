import { useAppStore } from '@/store'
import {
  knownRuntimeEnvironmentServesFilesByPath,
  runtimeEnvironmentServesFilesByPath
} from '@/runtime/runtime-file-address'

/** The app already shows this paired or SSH host as unreachable; asking it would only wait. */
export function isRuntimeEnvironmentShownUnreachable(environmentId: string): boolean {
  return useAppStore.getState().runtimeStatusByEnvironmentId.get(environmentId)?.status === null
}

/**
 * Whether a host serves files by path, for something the user just did (open a file, Retry). Uses
 * the cached answer; with none, waits on the host (bounded) unless the app shows it unreachable.
 */
export async function hostServesFilesByPathForUserAction(environmentId: string): Promise<boolean> {
  const known = knownRuntimeEnvironmentServesFilesByPath(environmentId)
  if (known !== undefined) {
    return known
  }
  if (isRuntimeEnvironmentShownUnreachable(environmentId)) {
    return false
  }
  return runtimeEnvironmentServesFilesByPath(environmentId, { askAgainAfterFailure: true })
}
