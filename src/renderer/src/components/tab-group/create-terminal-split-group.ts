import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { useAppStore } from '../../store'

export type TerminalSplitGroupDirection = 'left' | 'right' | 'up' | 'down'

export function recordTerminalTabGroupSplit(createdTerminal: TerminalTab | null | undefined): void {
  if (!createdTerminal) {
    return
  }
  useAppStore.getState().recordFeatureInteraction('terminal-pane-split')
}

export function createTerminalSplitGroup(
  worktreeId: string,
  groupId: string,
  direction: TerminalSplitGroupDirection
): TerminalTab | undefined {
  const store = useAppStore.getState()
  store.focusGroup(worktreeId, groupId)
  const newGroupId = store.createEmptySplitGroup(worktreeId, groupId, direction)
  if (!newGroupId) {
    return undefined
  }

  // Why: this split entry point always seeds a fresh terminal beside the source group.
  const terminal = store.createTab(worktreeId, newGroupId)
  recordTerminalTabGroupSplit(terminal)
  store.setActiveTab(terminal.id)
  store.setActiveTabType('terminal', worktreeId)
  return terminal
}
