import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useAppStore } from '@/store'
import type { TerminalFullscreenTarget } from '@/store/slices/ui'
import { createTerminalPaneFullscreenActions } from './terminal-pane-fullscreen'
import type { TerminalPaneProjectionController } from './use-terminal-pane-projection'

export function useTerminalPaneFullscreen(controller: TerminalPaneProjectionController) {
  const {
    contextMenu,
    contextMenuLeafId,
    expandedPaneIdRef,
    fullscreenLeafId,
    isolatedPaneKey,
    isVisible,
    managerRef,
    paneCount,
    refreshPaneSizes,
    restoreExpandedLayout,
    setExpandedPane,
    tabId,
    toggleExpandPane,
    worktreeId
  } = controller
  const hostedTargetRef = useRef<TerminalFullscreenTarget | null>(null)
  const actions = useMemo(
    () =>
      createTerminalPaneFullscreenActions({
        managerRef,
        expandedPaneIdRef,
        hostedTargetRef,
        worktreeId,
        tabId,
        toggleExpandPane,
        setExpandedPane,
        restoreExpandedLayout,
        refreshPaneSizes
      }),
    [
      managerRef,
      expandedPaneIdRef,
      worktreeId,
      tabId,
      toggleExpandPane,
      setExpandedPane,
      restoreExpandedLayout,
      refreshPaneSizes
    ]
  )

  // Why layout effects: the pane must be restored before the chrome's same-frame refit.
  useLayoutEffect(() => {
    actions.release(useAppStore.getState().terminalFullscreen)
  }, [actions, fullscreenLeafId])

  // Fullscreen ends when its terminal leaves the screen. An Activity portal still reports
  // isVisible, and a closed pane only shows as its leaf leaving the manager.
  useLayoutEffect(() => {
    if (fullscreenLeafId === null) {
      return
    }
    const paneMounted = (managerRef.current?.getNumericIdForLeaf(fullscreenLeafId) ?? null) !== null
    if (!isVisible || isolatedPaneKey !== null || !paneMounted) {
      useAppStore.getState().exitTerminalFullscreen()
    }
  }, [fullscreenLeafId, isVisible, isolatedPaneKey, managerRef, paneCount])

  // A closed tab takes its fullscreen with it.
  useEffect(
    () => () => {
      const hosted = hostedTargetRef.current
      if (hosted && useAppStore.getState().terminalFullscreen === hosted) {
        useAppStore.getState().exitTerminalFullscreen()
      }
    },
    []
  )

  const toggleFullscreen = (): void => {
    const pane = contextMenu.resolveMenuPane()
    if (!pane) {
      return
    }
    if (pane.leafId === fullscreenLeafId) {
      actions.exit(pane)
      useAppStore.getState().exitTerminalFullscreen()
      return
    }
    useAppStore.getState().enterTerminalFullscreen(actions.enter(pane))
  }

  return {
    menuPaneIsFullscreen: contextMenuLeafId !== null && contextMenuLeafId === fullscreenLeafId,
    toggleFullscreen
  }
}
