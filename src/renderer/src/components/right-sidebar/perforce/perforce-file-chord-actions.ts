import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { isFolderRepo } from '../../../../../shared/repo-kind'
import { normalizePerforceSettings } from '../../../../../shared/perforce/perforce-settings'
import type { PerforceChordAction } from '../../../../../shared/perforce/perforce-file-chord'
import { refreshPerforceOpenedFiles } from './perforce-opened-files'
import { isKnownPerforceWorkspace } from './use-perforce-workspace'
import { translate } from '@/i18n/i18n'
import { perforceClient } from '@/runtime/runtime-perforce-client'

export type PerforceChordFile = {
  worktreeId: string
  worktreePath: string
  connectionId: string | undefined
  relativePath: string
}

/** The Perforce workspace file in the active editor tab, or null when no chord applies. */
export function readActivePerforceFile(): PerforceChordFile | null {
  const state = useAppStore.getState()
  if (state.activeTabType !== 'editor') {
    return null
  }
  const file = state.openFiles.find((candidate) => candidate.id === state.activeFileId)
  const isFileTab =
    file?.mode === 'edit' || (file?.mode === 'diff' && file.diffSource === 'unstaged')
  const worktree = file ? state.getKnownWorktreeById(file.worktreeId) : null
  const repo = worktree ? state.repos.find((candidate) => candidate.id === worktree.repoId) : null
  if (!file || !isFileTab || !worktree || !repo || !isFolderRepo(repo)) {
    return null
  }
  const connectionId = repo.connectionId ?? undefined
  return isKnownPerforceWorkspace(worktree.path, connectionId)
    ? {
        worktreeId: worktree.id,
        worktreePath: worktree.path,
        connectionId,
        relativePath: file.relativePath.replaceAll('\\', '/')
      }
    : null
}

async function openForEdit(file: PerforceChordFile): Promise<void> {
  const result = await perforceClient.edit({
    worktreeId: file.worktreeId,
    worktreePath: file.worktreePath,
    connectionId: file.connectionId,
    filePaths: [file.relativePath]
  })
  if (result.success) {
    toast.success(
      translate('perforce.ui.openedForEdit', 'Opened for edit: {{path}}', {
        path: file.relativePath
      })
    )
  } else {
    toast.error(
      result.error ?? translate('perforce.ui.perforceCommandFailed', 'Perforce command failed')
    )
  }
}

async function revertFile(file: PerforceChordFile): Promise<void> {
  const target = {
    worktreeId: file.worktreeId,
    worktreePath: file.worktreePath,
    connectionId: file.connectionId
  }
  const status = await perforceClient.status(target)
  const entry = status.entries.find((candidate) => candidate.path === file.relativePath)
  if (!entry) {
    toast.info(
      translate('perforce.ui.noChangesToRevert', 'No changes to revert in {{path}}', {
        path: file.relativePath
      })
    )
    return
  }
  const settings = normalizePerforceSettings(useAppStore.getState().settings?.perforce)
  if (
    settings.confirmDestructiveActions &&
    !window.confirm(
      translate(
        'perforce.ui.revertFileConfirm',
        'Revert changes to {{path}}? This cannot be undone.',
        { path: file.relativePath }
      )
    )
  ) {
    return
  }
  const result = await perforceClient.discard({ ...target, entries: [entry] })
  if (result.success) {
    toast.success(
      translate('perforce.ui.revertedFile', 'Reverted: {{path}}', { path: file.relativePath })
    )
  } else {
    toast.error(
      result.error ?? translate('perforce.ui.perforceCommandFailed', 'Perforce command failed')
    )
  }
}

export async function runPerforceChordAction(
  action: PerforceChordAction,
  file: PerforceChordFile
): Promise<void> {
  try {
    await (action === 'edit' ? openForEdit(file) : revertFile(file))
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
  // Why: the "E" tab marker and panel poll on a timer; refresh now so the change shows immediately.
  void refreshPerforceOpenedFiles(file.worktreePath, file.connectionId, file.worktreeId)
}
