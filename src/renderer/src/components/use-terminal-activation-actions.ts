import { useCallback } from 'react'
import { useAppStore } from '../store'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { TOGGLE_TERMINAL_PANE_EXPAND_EVENT } from '@/constants/terminal'
import { activateWebRuntimeSessionTab } from '@/runtime/web-runtime-session-tab-lifecycle'
import { isWebRuntimeSessionActive } from '@/runtime/web-runtime-session-environment'
import { browserWorkspaceHasRemoteOwner } from '@/runtime/remote-browser-tab-ownership'
import { getActiveWorktreeRuntimeEnvironmentId } from './terminal-workspace-model'
import type { TerminalBulkCloseController } from './use-terminal-bulk-close-actions'

type TerminalActivationActionsController = Pick<
  TerminalBulkCloseController,
  'activeWorktreeId' | 'setActiveBrowserTab' | 'setActiveTab' | 'setActiveTabType'
>

export function useTerminalActivationActions(controller: TerminalActivationActionsController) {
  const { activeWorktreeId, setActiveBrowserTab, setActiveTab, setActiveTabType } = controller
  const handleActivateTab = useCallback(
    (tabId: string) => {
      const runtimeEnvironmentId = getActiveWorktreeRuntimeEnvironmentId(activeWorktreeId)
      if (activeWorktreeId && isWebRuntimeSessionActive(runtimeEnvironmentId)) {
        void activateWebRuntimeSessionTab({
          worktreeId: activeWorktreeId,
          tabId,
          environmentId: runtimeEnvironmentId
        })
      }
      setActiveTab(tabId)
      setActiveTabType('terminal', activeWorktreeId)
      const activeLeafId =
        useAppStore.getState().terminalLayoutsByTabId[tabId]?.activeLeafId ?? null
      focusTerminalTabSurface(tabId, activeLeafId)
    },
    [activeWorktreeId, setActiveTab, setActiveTabType]
  )

  const handleTogglePaneExpand = useCallback(
    (tabId: string) => {
      setActiveTab(tabId)
      requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent(TOGGLE_TERMINAL_PANE_EXPAND_EVENT, { detail: { tabId } })
        )
      })
    },
    [setActiveTab]
  )

  const handleActivateBrowserTab = useCallback(
    (tabId: string) => {
      const state = useAppStore.getState()
      const runtimeEnvironmentId = getActiveWorktreeRuntimeEnvironmentId(activeWorktreeId)
      if (
        activeWorktreeId &&
        isWebRuntimeSessionActive(runtimeEnvironmentId) &&
        browserWorkspaceHasRemoteOwner(state, tabId, runtimeEnvironmentId)
      ) {
        void activateWebRuntimeSessionTab({
          worktreeId: activeWorktreeId,
          tabId,
          environmentId: runtimeEnvironmentId
        })
      }
      setActiveBrowserTab(tabId)
      setActiveTabType('browser', activeWorktreeId)
    },
    [activeWorktreeId, setActiveBrowserTab, setActiveTabType]
  )

  return { handleActivateTab, handleTogglePaneExpand, handleActivateBrowserTab }
}

export type TerminalActivationController = TerminalBulkCloseController &
  ReturnType<typeof useTerminalActivationActions>
