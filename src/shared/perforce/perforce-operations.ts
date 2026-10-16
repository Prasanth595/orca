import type { PerforceBackend } from './perforce-backend'
import {
  requireChangelistId,
  requireChangelistTarget,
  requireDepotPaths,
  requireDescription,
  requireDiscardEntries,
  requireRelativePath,
  requireRelativePaths
} from './perforce-arguments'

/** Untrusted call arguments; every field is validated before it reaches a p4 argv. */
export type PerforceOperationArgs = Readonly<Record<string, unknown>>

type Operation = (backend: PerforceBackend, cwd: string, args: PerforceOperationArgs) => unknown

function historyLimit(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? Math.min(value, 200)
    : 30
}

/**
 * Every Perforce operation keyed by its IPC channel / RPC method suffix. The desktop IPC handlers
 * and the orcad RPC methods both dispatch through this table, so local and SSH workspaces validate
 * arguments identically.
 */
export const PERFORCE_OPERATIONS = {
  detect: (b, cwd) => b.detect(cwd),
  info: (b, cwd) => b.info(cwd),
  status: (b, cwd) => b.status(cwd),
  history: (b, cwd, a) => b.history(cwd, historyLimit(a.limit)),
  diff: (b, cwd, a) => b.diff(cwd, requireRelativePath(a.filePath)),
  diffText: (b, cwd, a) => b.diffText(cwd, requireRelativePaths(a.filePaths)),
  isReadOnlyFile: (b, cwd, a) => b.isReadOnlyFile(cwd, requireRelativePath(a.filePath)),
  checkoutIfReadOnly: (b, cwd, a) => b.checkoutIfReadOnly(cwd, requireRelativePath(a.filePath)),
  open: (b, cwd, a) => b.open(cwd, requireRelativePaths(a.filePaths)),
  edit: (b, cwd, a) => b.edit(cwd, requireRelativePaths(a.filePaths)),
  close: (b, cwd, a) => b.close(cwd, requireRelativePaths(a.filePaths)),
  discard: (b, cwd, a) => b.discard(cwd, requireDiscardEntries(a.entries)),
  submit: (b, cwd, a) => {
    const target = requireChangelistTarget(a.changelist)
    return b.submit(
      cwd,
      target,
      target === 'default' ? requireDescription(a.message, 'Submit description') : undefined
    )
  },
  sync: (b, cwd) => b.sync(cwd),
  shelve: (b, cwd, a) => b.shelve(cwd, requireChangelistId(a.changelist)),
  unshelve: (b, cwd, a) => b.unshelve(cwd, requireChangelistId(a.changelist)),
  unshelveFrom: (b, cwd, a) =>
    b.unshelveFrom(
      cwd,
      requireChangelistId(a.sourceChangelist),
      requireChangelistTarget(a.changelist)
    ),
  shelveAndRevertFiles: (b, cwd, a) =>
    b.shelveAndRevertFiles(
      cwd,
      requireChangelistId(a.changelist),
      requireRelativePaths(a.filePaths)
    ),
  unshelveFiles: (b, cwd, a) =>
    b.unshelveFiles(cwd, requireChangelistId(a.changelist), requireDepotPaths(a.depotPaths)),
  deleteChangelistWithFiles: (b, cwd, a) =>
    b.deleteChangelistWithFiles(cwd, requireChangelistId(a.changelist)),
  deleteShelf: (b, cwd, a) => b.deleteShelf(cwd, requireChangelistId(a.changelist)),
  createChangelist: (b, cwd, a) =>
    b.createChangelist(
      cwd,
      requireDescription(a.description, 'Changelist description'),
      Array.isArray(a.filePaths) && a.filePaths.length > 0 ? requireRelativePaths(a.filePaths) : []
    ),
  editDescription: (b, cwd, a) =>
    b.editDescription(
      cwd,
      requireChangelistId(a.changelist),
      requireDescription(a.description, 'Changelist description')
    ),
  moveToChangelist: (b, cwd, a) =>
    b.moveToChangelist(
      cwd,
      requireRelativePaths(a.filePaths),
      requireChangelistTarget(a.changelist)
    ),
  deleteChangelist: (b, cwd, a) => b.deleteChangelist(cwd, requireChangelistId(a.changelist))
} satisfies Record<string, Operation>

export type PerforceOperationName = keyof typeof PERFORCE_OPERATIONS

export function isPerforceOperationName(value: string): value is PerforceOperationName {
  return Object.hasOwn(PERFORCE_OPERATIONS, value)
}

export const PERFORCE_OPERATION_NAMES: readonly PerforceOperationName[] =
  Object.keys(PERFORCE_OPERATIONS).filter(isPerforceOperationName)
