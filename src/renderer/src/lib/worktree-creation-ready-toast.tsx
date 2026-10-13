import { ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getIndexedRepoMap } from '@/store/worktree-repo-index'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { resolveWorktreeDisplayName } from '@/lib/worktree-default-display-name'
import { getKnownExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import { isFolderRepo } from '../../../shared/repo-kind'
import { worktreeIdsEqual } from '../../../shared/worktree/id'
import type { Worktree } from '../../../shared/worktree/types'

/** Announces a create that finished after the user left its creation surface, instead of pulling them to it. */
export function showWorktreeCreationReadyToast(
  worktree: Pick<
    Worktree,
    'id' | 'repoId' | 'displayName' | 'branch' | 'path' | 'hostId' | 'identity'
  >
): void {
  const executionHostId = worktree.identity?.executionHostId ?? worktree.hostId
  const isViewingWorktree = (state: ReturnType<typeof useAppStore.getState>): boolean =>
    state.activeView === 'terminal' &&
    state.activePendingCreationId === null &&
    state.activeWorktreeId !== null &&
    worktreeIdsEqual(state.activeWorktreeId, worktree.id) &&
    (executionHostId === undefined ||
      getKnownExecutionHostIdForWorktree(state, state.activeWorktreeId) === executionHostId)
  if (isViewingWorktree(useAppStore.getState())) {
    return
  }

  const name = resolveWorktreeDisplayName(worktree)
  const repo = getIndexedRepoMap(useAppStore.getState().repos).get(worktree.repoId)
  // Why: a folder repo's workspace is not a git worktree, so its title and button say workspace.
  const isFolder = repo !== undefined && isFolderRepo(repo)
  const title = isFolder
    ? translate(
        'components.workspace.creation.workspaceReadyToast',
        'Workspace {{name}} is ready',
        {
          name
        }
      )
    : translate('components.workspace.creation.worktreeReadyToast', 'Worktree {{name}} is ready', {
        name
      })
  const goToLabel = isFolder
    ? translate('components.workspace.creation.goToWorkspace', 'Go to workspace')
    : translate('components.workspace.creation.goToWorktree', 'Go to worktree')
  let retired = false
  const retire = (): void => {
    retired = true
    unsubscribe()
  }
  const unsubscribe = useAppStore.subscribe((state) => {
    if (isViewingWorktree(state)) {
      // Navigation can change the view before replacing the remembered workspace.
      queueMicrotask(() => {
        if (!retired && isViewingWorktree(useAppStore.getState())) {
          retire()
          toast.dismiss(toastId)
        }
      })
    }
  })
  const toastId = toast.success(title, {
    // Keep the way back until the user opens the workspace or dismisses the toast.
    duration: Infinity,
    onDismiss: retire,
    onAutoClose: retire,
    action: {
      label: (
        <span className="inline-flex items-center gap-1.5">
          <ExternalLink className="size-3" />
          {goToLabel}
        </span>
      ),
      onClick: () => {
        retire()
        activateAndRevealWorktree(worktree.id, {
          sidebarRevealBehavior: 'auto',
          navigationIntent: 'user-open',
          ...(executionHostId ? { executionHostId } : {})
        })
      }
    }
  })
}
