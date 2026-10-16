import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import type { TerminalFullscreenTarget } from '@/store/slices/ui'
import type { TopLevelView } from '../../../../shared/ui-chrome-types'

type FullscreenPaneManager = Pick<PaneManager, 'getNumericIdForLeaf' | 'setActivePane'> & {
  getPanes: () => readonly unknown[]
}

type FullscreenPane = { id: number; leafId: string; terminal: { focus: () => void } }

type TerminalPaneFullscreenState = {
  managerRef: React.RefObject<FullscreenPaneManager | null>
  expandedPaneIdRef: React.MutableRefObject<number | null>
  /** The target this pane put on screen, until its layout is restored. */
  hostedTargetRef: React.MutableRefObject<TerminalFullscreenTarget | null>
  worktreeId: string
  tabId: string
  toggleExpandPane: (paneId: number) => void
  setExpandedPane: (paneId: number | null) => void
  restoreExpandedLayout: () => void
  refreshPaneSizes: (focusActive: boolean) => void
}

/** Only terminals of the workspace in the main window's workspace view can go fullscreen. */
export function canOfferTerminalFullscreen({
  activeView,
  activeWorktreeId,
  worktreeId,
  isolatedPaneKey
}: {
  activeView: TopLevelView
  activeWorktreeId: string | null
  worktreeId: string
  isolatedPaneKey: string | null
}): boolean {
  return activeView === 'terminal' && worktreeId === activeWorktreeId && isolatedPaneKey === null
}

/** This tab's fullscreen leaf, or null. */
export function selectTerminalFullscreenLeafId(
  target: TerminalFullscreenTarget | null,
  worktreeId: string,
  tabId: string
): string | null {
  return target?.worktreeId === worktreeId && target.tabId === tabId ? target.leafId : null
}

export function createTerminalPaneFullscreenActions(state: TerminalPaneFullscreenState) {
  const expandForFullscreen = (paneId: number): boolean => {
    const paneCount = state.managerRef.current?.getPanes().length ?? 0
    if (paneCount <= 1 || state.expandedPaneIdRef.current === paneId) {
      return false
    }
    state.toggleExpandPane(paneId)
    return state.expandedPaneIdRef.current === paneId
  }

  // A pane that was expanded before fullscreen, or collapsed since, keeps its layout.
  const restore = (target: TerminalFullscreenTarget, focus: boolean): void => {
    const paneId = state.managerRef.current?.getNumericIdForLeaf(target.leafId) ?? null
    if (target.expandedPane && paneId !== null && state.expandedPaneIdRef.current === paneId) {
      state.setExpandedPane(null)
      state.restoreExpandedLayout()
    }
    state.refreshPaneSizes(focus)
  }

  /** Restores this tab's fullscreen pane, without moving focus, once `stored` stops being it. */
  const release = (stored: TerminalFullscreenTarget | null): void => {
    const hosted = state.hostedTargetRef.current
    if (hosted === null || hosted === stored) {
      return
    }
    state.hostedTargetRef.current = null
    restore(hosted, false)
  }

  /** Makes `pane` this tab's fullscreen pane and returns the target to store. */
  const enter = (pane: FullscreenPane): TerminalFullscreenTarget => {
    // Moving fullscreen within this tab restores the previous pane first.
    release(null)
    state.managerRef.current?.setActivePane(pane.id)
    const target = {
      worktreeId: state.worktreeId,
      tabId: state.tabId,
      leafId: pane.leafId,
      expandedPane: expandForFullscreen(pane.id)
    }
    // Why: the open menu blocks setActivePane's focus.
    pane.terminal.focus()
    state.hostedTargetRef.current = target
    return target
  }

  /** Exit Fullscreen from the menu: restores the pane and leaves it focused. */
  const exit = (pane: FullscreenPane): void => {
    const hosted = state.hostedTargetRef.current
    state.hostedTargetRef.current = null
    state.managerRef.current?.setActivePane(pane.id)
    if (hosted) {
      restore(hosted, true)
    }
    pane.terminal.focus()
  }

  return { enter, exit, release }
}
