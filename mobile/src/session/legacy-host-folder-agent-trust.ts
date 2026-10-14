import type { RpcClient } from '../transport/rpc-client'
import { readMobileRuntimeHostPlatform } from '../transport/mobile-runtime-host-platform'
import {
  nativeChatRepoListRead,
  newTabFolderWorkspaceListRead,
  newTabHostStatusRead,
  newTabProjectGroupListRead
} from './mobile-session-read-operations'

/**
 * Whether a host that discards the workspace id still answers for this folder: only when every
 * repo, project group and folder it holds runs on that host, and the host is not Windows (where a
 * folder may run in WSL). Placement is never inferred here; anything less certain is the caller's
 * "update the desktop" answer.
 */
export async function legacyHostAnswersForFolder(
  client: RpcClient,
  worktreeId: string
): Promise<boolean> {
  const [repos, groups, folders, status] = await Promise.all([
    nativeChatRepoListRead.request(client).then(nativeChatRepoListRead.interpret),
    newTabProjectGroupListRead.request(client).then(newTabProjectGroupListRead.interpret),
    newTabFolderWorkspaceListRead.request(client).then(newTabFolderWorkspaceListRead.interpret),
    newTabHostStatusRead.request(client).then(newTabHostStatusRead.interpret)
  ])
  if (!repos.accepted || !groups.accepted || !folders.accepted || !status.accepted) {
    return false
  }
  const hostPlatform = readMobileRuntimeHostPlatform(status.value)
  const folderWorkspaceId = worktreeId.slice('folder:'.length)
  return (
    hostPlatform !== null &&
    hostPlatform !== 'win32' &&
    folders.value.some((folder) => folder.id === folderWorkspaceId) &&
    [...repos.value, ...groups.value, ...folders.value].every(runsOnHost)
  )
}

function runsOnHost(row: Record<string, unknown>): boolean {
  const { connectionId, executionHostId } = row
  // Why fail closed: a malformed placement value is unknown placement, not local.
  const noConnection =
    connectionId === undefined ||
    connectionId === null ||
    (typeof connectionId === 'string' && connectionId.trim() === '')
  const localHost =
    executionHostId === undefined || executionHostId === null || executionHostId === 'local'
  return noConnection && localHost
}
