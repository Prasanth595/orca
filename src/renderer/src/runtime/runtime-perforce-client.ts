import { useAppStore } from '@/store'
import { tryRuntimeTargetForWorktreeOwner } from '@/store/slices/worktrees/listing/worktree-owner-target'
import type { PerforceApi } from '../../../preload/api/perforce-api'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import { normalizePerforceSettings } from '../../../shared/perforce/perforce-settings'
import type { PerforceDetectResult } from '../../../shared/perforce/perforce-types'
import { callRuntimeRpc } from './runtime-rpc-client'
import { RuntimeRpcCallError } from './runtime-rpc-result'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'

/** Where a Perforce workspace lives; `worktreeId` lets runtime-hosted (SSH) workspaces route. */
export type PerforceClientTarget = {
  worktreePath: string
  connectionId?: string
  worktreeId?: string | null
}

export const PERFORCE_SERVER_TOO_OLD_MESSAGE =
  'The Orca server on this host does not support Perforce yet. Update the server to use Perforce here.'

// Why: submit and sync can wait on the Perforce server; reads finish well inside this.
const PERFORCE_RPC_TIMEOUT_MS = 120_000

type ClientApi = {
  [Operation in keyof PerforceApi]: (
    args: Parameters<PerforceApi[Operation]>[0] & PerforceClientTarget
  ) => ReturnType<PerforceApi[Operation]>
}

/** The runtime environment that hosts this worktree, or null when IPC (local) serves it. */
function hostedRuntimeTarget(worktreeId: string | null | undefined): RuntimeClientTarget | null {
  if (!worktreeId) {
    return null
  }
  // Why the owner, not focus: the workspace's own host runs p4; an unresolved owner stays on IPC.
  const target = tryRuntimeTargetForWorktreeOwner(useAppStore.getState(), worktreeId)
  return target?.kind === 'environment' ? target : null
}

function ipcArgs<A extends PerforceClientTarget>(args: A): Omit<A, 'worktreeId'> {
  const { worktreeId: _worktreeId, ...rest } = args
  return rest
}

async function route<T>(
  args: PerforceClientTarget & Readonly<Record<string, unknown>>,
  operation: string,
  local: () => Promise<T>
): Promise<T> {
  const target = hostedRuntimeTarget(args.worktreeId)
  if (!target || !args.worktreeId) {
    return local()
  }
  const { worktreePath: _path, connectionId: _connection, worktreeId, ...rest } = args
  try {
    return await callRuntimeRpc<T>(
      target,
      `perforce.${operation}`,
      {
        ...rest,
        worktree: toRuntimeWorktreeSelector(worktreeId),
        settings: normalizePerforceSettings(useAppStore.getState().settings?.perforce)
      },
      { timeoutMs: PERFORCE_RPC_TIMEOUT_MS }
    )
  } catch (error) {
    if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
      throw new Error(PERFORCE_SERVER_TOO_OLD_MESSAGE)
    }
    throw error
  }
}

async function detect(
  args: PerforceClientTarget & Parameters<PerforceApi['detect']>[0]
): Promise<PerforceDetectResult> {
  try {
    return await route(args, 'detect', () => window.api.perforce.detect(ipcArgs(args)))
  } catch (error) {
    // An older server is "not Perforce" rather than a broken panel.
    if (error instanceof Error && error.message === PERFORCE_SERVER_TOO_OLD_MESSAGE) {
      return { isWorkspace: false, reason: 'error', message: error.message }
    }
    throw error
  }
}

/**
 * Same surface as `window.api.perforce`, routed to the workspace's owner: this app's IPC for local
 * workspaces, the hosting orcad's `perforce.*` RPC methods for runtime-hosted (SSH) ones.
 */
async function generateDescription(
  args: PerforceClientTarget & Parameters<PerforceApi['generateDescription']>[0]
): ReturnType<PerforceApi['generateDescription']> {
  const local = ipcArgs(args)
  if (!hostedRuntimeTarget(args.worktreeId)) {
    return window.api.perforce.generateDescription(local)
  }
  // Why: the agent and its credentials live on this desktop; only the diff is read on the host.
  const patch = await route(
    { worktreePath: args.worktreePath, worktreeId: args.worktreeId, filePaths: args.filePaths },
    'diffText',
    async () => ''
  )
  return window.api.perforce.generateDescription({ ...local, connectionId: undefined, patch })
}

export const perforceClient: ClientApi & {
  isReadOnlyFile: typeof isReadOnlyFile
  checkoutIfReadOnly: typeof checkoutIfReadOnly
} = {
  isReadOnlyFile,
  checkoutIfReadOnly,
  detect,
  generateDescription,
  info: (a) => route(a, 'info', () => window.api.perforce.info(ipcArgs(a))),
  status: (a) => route(a, 'status', () => window.api.perforce.status(ipcArgs(a))),
  history: (a) => route(a, 'history', () => window.api.perforce.history(ipcArgs(a))),
  open: (a) => route(a, 'open', () => window.api.perforce.open(ipcArgs(a))),
  edit: (a) => route(a, 'edit', () => window.api.perforce.edit(ipcArgs(a))),
  close: (a) => route(a, 'close', () => window.api.perforce.close(ipcArgs(a))),
  discard: (a) => route(a, 'discard', () => window.api.perforce.discard(ipcArgs(a))),
  submit: (a) => route(a, 'submit', () => window.api.perforce.submit(ipcArgs(a))),
  sync: (a) => route(a, 'sync', () => window.api.perforce.sync(ipcArgs(a))),
  shelve: (a) => route(a, 'shelve', () => window.api.perforce.shelve(ipcArgs(a))),
  unshelve: (a) => route(a, 'unshelve', () => window.api.perforce.unshelve(ipcArgs(a))),
  unshelveFrom: (a) => route(a, 'unshelveFrom', () => window.api.perforce.unshelveFrom(ipcArgs(a))),
  shelveAndRevertFiles: (a) =>
    route(a, 'shelveAndRevertFiles', () => window.api.perforce.shelveAndRevertFiles(ipcArgs(a))),
  unshelveFiles: (a) =>
    route(a, 'unshelveFiles', () => window.api.perforce.unshelveFiles(ipcArgs(a))),
  deleteChangelistWithFiles: (a) =>
    route(a, 'deleteChangelistWithFiles', () =>
      window.api.perforce.deleteChangelistWithFiles(ipcArgs(a))
    ),
  deleteShelf: (a) => route(a, 'deleteShelf', () => window.api.perforce.deleteShelf(ipcArgs(a))),
  createChangelist: (a) =>
    route(a, 'createChangelist', () => window.api.perforce.createChangelist(ipcArgs(a))),
  editDescription: (a) =>
    route(a, 'editDescription', () => window.api.perforce.editDescription(ipcArgs(a))),
  moveToChangelist: (a) =>
    route(a, 'moveToChangelist', () => window.api.perforce.moveToChangelist(ipcArgs(a))),
  deleteChangelist: (a) =>
    route(a, 'deleteChangelist', () => window.api.perforce.deleteChangelist(ipcArgs(a))),
  describeChange: (a) =>
    route(a, 'describeChange', () => window.api.perforce.describeChange(ipcArgs(a)))
}

/** Read-only probe used before saving; only runtime-hosted workspaces need it (main checks local saves). */
function isReadOnlyFile(args: PerforceClientTarget & { filePath: string }): Promise<boolean> {
  return route(args, 'isReadOnlyFile', async () => false)
}

function checkoutIfReadOnly(args: PerforceClientTarget & { filePath: string }): Promise<void> {
  return route(args, 'checkoutIfReadOnly', async () => undefined)
}

/** True when the worktree is hosted by a runtime environment (p4 runs on that host). */
export function isRuntimeHostedPerforceWorktree(worktreeId: string | null | undefined): boolean {
  return hostedRuntimeTarget(worktreeId) !== null
}
