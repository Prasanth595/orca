import { localPerforceBackend, type PerforceBackend } from '../../shared/perforce/perforce-backend'
import { runWithPerforceSettings } from '../../shared/perforce/p4-settings-context'
import {
  DEFAULT_PERFORCE_SETTINGS,
  type PerforceSettings
} from '../../shared/perforce/perforce-settings'

let settingsSource: () => PerforceSettings = () => DEFAULT_PERFORCE_SETTINGS

/** Wired once at startup so every local p4 call sees the current Settings > Perforce values. */
export function setPerforceSettingsSource(source: () => PerforceSettings): void {
  settingsSource = source
}

export function getPerforceSettings(): PerforceSettings {
  return settingsSource()
}

function scoped<Args extends unknown[], Result>(
  run: (...args: Args) => Result
): (...args: Args) => Result {
  return (...args) => runWithPerforceSettings(settingsSource(), () => run(...args))
}

function createLocalPerforceBackend(): PerforceBackend {
  const local = localPerforceBackend
  return {
    detect: scoped(local.detect),
    status: scoped(local.status),
    history: scoped(local.history),
    diff: scoped(local.diff),
    open: scoped(local.open),
    close: scoped(local.close),
    edit: scoped(local.edit),
    discard: scoped(local.discard),
    submit: scoped(local.submit),
    sync: scoped(local.sync),
    shelve: scoped(local.shelve),
    unshelve: scoped(local.unshelve),
    deleteShelf: scoped(local.deleteShelf),
    unshelveFiles: scoped(local.unshelveFiles),
    shelveAndRevertFiles: scoped(local.shelveAndRevertFiles),
    unshelveFrom: scoped(local.unshelveFrom),
    createChangelist: scoped(local.createChangelist),
    editDescription: scoped(local.editDescription),
    moveToChangelist: scoped(local.moveToChangelist),
    deleteChangelist: scoped(local.deleteChangelist),
    deleteChangelistWithFiles: scoped(local.deleteChangelistWithFiles),
    checkoutIfReadOnly: scoped(local.checkoutIfReadOnly),
    isReadOnlyFile: scoped(local.isReadOnlyFile),
    diffText: scoped(local.diffText),
    info: scoped(local.info)
  }
}

const settingsLocalBackend = createLocalPerforceBackend()

export const PERFORCE_SSH_UNSUPPORTED_MESSAGE =
  'This SSH workspace is not served by an Orca server, so Perforce cannot run on its host. Open it through its managed server.'

function unsupported(): Promise<never> {
  return Promise.reject(new Error(PERFORCE_SSH_UNSUPPORTED_MESSAGE))
}

/**
 * A bare `connectionId` names a direct SSH target, which this app no longer serves (orcad-served
 * SSH workspaces route through perforce.* RPC instead). Detection reports "not a workspace" so the
 * UI falls back to plain folder behavior; any mutation fails loudly.
 */
const sshUnsupportedPerforceBackend: PerforceBackend = {
  detect: async () => ({
    isWorkspace: false,
    reason: 'error',
    message: PERFORCE_SSH_UNSUPPORTED_MESSAGE
  }),
  status: unsupported,
  history: unsupported,
  diff: unsupported,
  open: unsupported,
  close: unsupported,
  edit: unsupported,
  discard: unsupported,
  submit: unsupported,
  sync: unsupported,
  shelve: unsupported,
  unshelve: unsupported,
  unshelveFrom: unsupported,
  deleteShelf: unsupported,
  shelveAndRevertFiles: unsupported,
  unshelveFiles: unsupported,
  createChangelist: unsupported,
  editDescription: unsupported,
  moveToChangelist: unsupported,
  deleteChangelist: unsupported,
  deleteChangelistWithFiles: unsupported,
  checkoutIfReadOnly: unsupported,
  isReadOnlyFile: unsupported,
  diffText: unsupported,
  info: unsupported
}

/** Picks where p4 runs: this machine for local workspaces; SSH workspaces are unsupported. */
export function resolvePerforceBackend(connectionId?: string | null): PerforceBackend {
  return connectionId ? sshUnsupportedPerforceBackend : settingsLocalBackend
}
