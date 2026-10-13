import type { ExecutionHostScope } from '../../../shared/execution-host'
import { toast } from 'sonner'

import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  activateAndRevealFolderWorkspace,
  activateAndRevealWorktree
} from '@/lib/worktree-activation'
import { folderWorkspaceToWorktree } from '../../../shared/folder-workspace-worktree'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import type { FeishuBitableRecordReference } from '../../../shared/feishu-bitable-task-contract'
import { findFeishuBitableRecordWorkspaceAttachment } from './feishu-bitable-record-workspace-attachment'

/**
 * Opens the workspace already attached to a Bitable record, or starts a new
 * one. Re-reads worktrees from the store so a workspace created since the
 * last render is still honoured instead of starting a duplicate.
 */
export function openFeishuBitableRecordWorkspaceOrStart(
  reference: FeishuBitableRecordReference,
  startWorkspace: () => void,
  sourceHostId?: ExecutionHostScope
): 'opened' | 'started' | 'failed' {
  const state = useAppStore.getState()
  const attached = findFeishuBitableRecordWorkspaceAttachment(
    [...state.allWorktrees(), ...state.folderWorkspaces.map(folderWorkspaceToWorktree)],
    reference,
    sourceHostId
  )
  if (!attached) {
    startWorkspace()
    return 'started'
  }

  const workspaceScope = parseWorkspaceKey(attached.id)
  const activation =
    workspaceScope?.type === 'folder'
      ? activateAndRevealFolderWorkspace(workspaceScope.folderWorkspaceId, {
          navigationIntent: 'user-open',
          ...(attached.hostId ? { executionHostId: attached.hostId } : {})
        })
      : activateAndRevealWorktree(attached.id, {
          navigationIntent: 'user-open',
          ...(attached.hostId ? { executionHostId: attached.hostId } : {})
        })
  if (activation === false) {
    toast.error(
      translate(
        'auto.lib.feishuBitable.record.workspace.open',
        'Unable to open the workspace attached to this record.'
      )
    )
    return 'failed'
  }
  return 'opened'
}
