import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { getConcealedRepoIdsFromState } from '@/store/concealed-repo-selector'
import { getRepoIdFromWorktreeId } from '../../../shared/worktree/id'
import type { IncognitoLockState } from '../../../shared/incognito-projects'
import type { AppState } from '@/store/types'

function applyLockState(state: IncognitoLockState): void {
  useAppStore.getState().setIncognitoProjectsUnlocked(state.unlocked)
}

// Why: a hidden sidebar row must not leave its workspace on screen, whether it was hidden by locking,
// by "Make incognito" while locked, or by a session restore that reopens it.
function leaveConcealedWorkspace(state: AppState): void {
  if (
    state.activeWorktreeId &&
    getConcealedRepoIdsFromState(state).has(getRepoIdFromWorktreeId(state.activeWorktreeId))
  ) {
    state.setActiveWorktree(null)
  }
}

/** Mirrors main's incognito unlock into the store and keeps concealed workspaces off screen. */
export function useIncognitoProjectsLockSync(): void {
  useEffect(() => {
    let disposed = false
    leaveConcealedWorkspace(useAppStore.getState())
    const unsubscribeStore = useAppStore.subscribe(leaveConcealedWorkspace)
    const unsubscribe = window.api.incognitoProjects.onStateChanged(applyLockState)
    void window.api.incognitoProjects
      .getState()
      .then((state) => {
        if (!disposed) {
          applyLockState(state)
        }
      })
      .catch(() => {})
    return () => {
      disposed = true
      unsubscribeStore()
      unsubscribe()
    }
  }, [])
}
