import type { StateCreator } from 'zustand'
import {
  addWorkspaceGridViewMember,
  removeWorkspaceGridViewMember
} from '@/lib/workspace-grid-view-membership'
import type { AppState } from '../types'
import {
  loadWorkspaceGridViewMemberIds,
  saveWorkspaceGridViewMemberIds
} from './workspace-grid-view-storage'

export type WorkspaceGridViewSlice = {
  /** Workspaces shown together on the grid view, in cell order. Window presentation only: never
   *  sent to paired hosts or mobile clients. */
  workspaceGridViewMemberIds: readonly string[]
  addWorkspaceToGridView: (workspaceId: string) => void
  removeWorkspaceFromGridView: (workspaceId: string) => void
}

export const createWorkspaceGridViewSlice: StateCreator<
  AppState,
  [],
  [],
  WorkspaceGridViewSlice
> = (set, get) => {
  const commit = (next: readonly string[]): void => {
    if (next === get().workspaceGridViewMemberIds) {
      return
    }
    set({ workspaceGridViewMemberIds: next })
    saveWorkspaceGridViewMemberIds(next)
  }

  return {
    workspaceGridViewMemberIds: loadWorkspaceGridViewMemberIds(),

    addWorkspaceToGridView: (workspaceId) => {
      const { workspaceGridViewMemberIds, activeWorktreeId } = get()
      commit(addWorkspaceGridViewMember(workspaceGridViewMemberIds, workspaceId, activeWorktreeId))
    },

    removeWorkspaceFromGridView: (workspaceId) => {
      commit(removeWorkspaceGridViewMember(get().workspaceGridViewMemberIds, workspaceId))
    }
  }
}
