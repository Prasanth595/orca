import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { perforceClient } from '@/runtime/runtime-perforce-client'
import { normalizePerforceSettings } from '../../../../../shared/perforce/perforce-settings'
import { isKnownPerforceWorkspace } from './use-perforce-workspace'

export const PERFORCE_SAVE_DECLINED_MESSAGE =
  'Save cancelled: the file is not opened for edit in Perforce.'

/**
 * Runtime-hosted (SSH) twin of the desktop's checkout-on-write: Perforce leaves synced files
 * read-only, so ask before opening one for edit on its host. Declining cancels the save; probe
 * failures fall through to the normal write, which reports a still-read-only file.
 */
export async function checkoutHostedPerforceFileBeforeSave(file: {
  worktreeId: string
  worktreePath: string | null | undefined
  relativePath: string
}): Promise<void> {
  const { worktreeId, worktreePath, relativePath } = file
  if (!worktreePath || !isKnownPerforceWorkspace(worktreePath, undefined)) {
    return
  }
  const behavior = normalizePerforceSettings(
    useAppStore.getState().settings?.perforce
  ).saveReadOnlyBehavior
  if (behavior === 'never') {
    return
  }
  const target = { worktreeId, worktreePath, filePath: relativePath }
  try {
    if (!(await perforceClient.isReadOnlyFile(target))) {
      return
    }
  } catch {
    return
  }
  if (
    behavior === 'ask' &&
    !window.confirm(
      translate(
        'perforce.ui.openHostedFileForEdit',
        '{{path}} is not opened for edit in Perforce. Open it for edit and save?',
        { path: relativePath }
      )
    )
  ) {
    throw new Error(PERFORCE_SAVE_DECLINED_MESSAGE)
  }
  try {
    await perforceClient.checkoutIfReadOnly(target)
  } catch {
    // The write reports the failure if the file stayed read-only.
  }
}
