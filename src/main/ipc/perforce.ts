import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { PerforceBackend } from '../../shared/perforce/perforce-backend'
import {
  PERFORCE_OPERATION_NAMES,
  PERFORCE_OPERATIONS,
  type PerforceOperationArgs
} from '../../shared/perforce/perforce-operations'
import { normalizePerforceSettings } from '../../shared/perforce/perforce-settings'
import { resolvePerforceBackend, setPerforceSettingsSource } from '../perforce/perforce-ssh-backend'
import type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/commit-message-agent-environment'
import { registerPerforceDescriptionGeneration } from './perforce-description-generation'
import { resolveRegisteredWorktreePath } from './registered-worktree-roots-cache'

type WorktreeArgs = PerforceOperationArgs & { worktreePath: string; connectionId?: string }

/** Resolves where the workspace lives and hands its operations to the matching backend. */
async function withWorkspace<T>(
  store: Store,
  args: WorktreeArgs,
  run: (backend: PerforceBackend, cwd: string) => T
): Promise<Awaited<T>> {
  // Why: SSH paths belong to the remote host; only local paths are checked against registered roots.
  const cwd = args.connectionId
    ? args.worktreePath
    : await resolveRegisteredWorktreePath(args.worktreePath, store)
  return await run(resolvePerforceBackend(args.connectionId), cwd)
}

export function registerPerforceHandlers(
  store: Store,
  commitMessageAgentEnv?: CommitMessageAgentEnvironmentResolvers
): void {
  setPerforceSettingsSource(() => normalizePerforceSettings(store.getSettings().perforce))
  registerPerforceDescriptionGeneration(store, commitMessageAgentEnv)

  for (const name of PERFORCE_OPERATION_NAMES) {
    ipcMain.handle(`perforce:${name}`, (_event, args: WorktreeArgs) =>
      withWorkspace(store, args, (backend, cwd) => PERFORCE_OPERATIONS[name](backend, cwd, args))
    )
  }
}
