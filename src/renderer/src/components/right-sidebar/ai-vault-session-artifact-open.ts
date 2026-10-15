import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { detectLanguage } from '@/lib/language-detect'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { translate } from '@/i18n/i18n'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import type { AiVaultSessionArtifact } from '../../../../shared/ai-vault-types'
import type { AppState } from '@/store/types'

/** Checks whether the given worktree or folder workspace is still present in the store. */
function worktreeStillExists(state: AppState, worktreeId: string): boolean {
  if (findWorktreeById(state.worktreesByRepo ?? {}, worktreeId)) {
    return true
  }
  return (state.folderWorkspaces ?? []).some(
    (workspace) => folderWorkspaceKey(workspace.id) === worktreeId
  )
}

/**
 * Open an Antigravity artifact file inside Orca as a read-only editor tab.
 * Follows the same `openFile` contract as the View Log action.
 */
export async function openAiVaultSessionArtifactInOrca(
  artifact: AiVaultSessionArtifact
): Promise<void> {
  const filePath = artifact.filePath?.trim()
  if (!filePath) {
    return
  }
  const state = useAppStore.getState()
  const worktreeId = state.activeWorktreeId
  if (!worktreeId) {
    toast.error(
      translate(
        'auto.components.right.sidebar.aiVaultSessionArtifactOpen.workspaceGone',
        "Couldn't open artifact - workspace is no longer available."
      )
    )
    return
  }
  if (!worktreeStillExists(state, worktreeId)) {
    toast.error(
      translate(
        'auto.components.right.sidebar.aiVaultSessionArtifactOpen.workspaceGone',
        "Couldn't open artifact - workspace is no longer available."
      )
    )
    return
  }
  const targetGroupId = state.activeGroupIdByWorktree?.[worktreeId] ?? undefined
  state.openFile(
    {
      filePath,
      relativePath: filePath,
      worktreeId,
      runtimeEnvironmentId: null,
      language: detectLanguage(filePath),
      mode: 'edit',
      readOnly: true
    },
    {
      preview: false,
      forceContentReload: true,
      forceReadOnly: true,
      suppressActiveRuntimeFallback: true,
      targetGroupId
    }
  )
}
