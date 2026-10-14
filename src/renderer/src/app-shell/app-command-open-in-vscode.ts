import { resolveWorktreeRowOpenInRuntimeOwner } from '@/lib/worktree-row-open-in-owner'
import { resolveWorktreeOperationRoute } from '@/lib/worktree-operation-route'
import { findKnownWorktreeById } from '@/store/slices/worktrees/listing/detected-worktree-meta'
import { openWorktreePath } from '../components/sidebar/WorktreeOpenInMenu'
import { useAppStore } from '../store'
import type { AppShortcutState } from './app-command-handlers'
import type { KeybindingActionId } from '../../../shared/keybindings'

export function openActiveWorkspaceInVSCode(
  state: AppShortcutState,
  floatingWorkspaceFocused: boolean,
  claim: (actionId: KeybindingActionId, run: () => void) => boolean
): boolean {
  const { workspaceChromeActive, activeWorktreeId } = state
  if (!workspaceChromeActive || floatingWorkspaceFocused || !activeWorktreeId) {
    return false
  }
  const store = useAppStore.getState()
  const route = resolveWorktreeOperationRoute(store, activeWorktreeId)
  if (!route?.executionHostId) {
    return false
  }
  const worktree = findKnownWorktreeById(store, activeWorktreeId, route.executionHostId)
  if (!worktree?.path) {
    return false
  }
  const owner = resolveWorktreeRowOpenInRuntimeOwner(store, worktree)
  return claim('workspace.openInVSCode', () => {
    void openWorktreePath({
      target: 'external-editor',
      worktreePath: worktree.path,
      command: 'code',
      ...owner
    })
  })
}
