import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { revealFloatingWorkspacePanel } from '@/lib/floating-workspace-panel-reveal'
import { activateStructuredAgentSessionTab } from '@/lib/structured-agent-session-tab-activation'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { getPendingWorktreeAgentActivation } from '@/lib/worktree-agent-activation-gate'
import { jumpToWorktreeFromSidebar } from '@/lib/worktree-jump-navigation'
import { useAppStore } from '@/store'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import {
  getSettingsFocusedExecutionHostId,
  getWorktreeExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { findKnownWorktreeById } from '@/store/slices/worktrees/listing/detected-worktree-meta'
import type { AppState } from '@/store/types'
import type { AgentPaneThread } from './activity-thread-types'

// Same focused-host fallback the Agents scope filter uses; defaulting to `local` here would
// look up a hostless runtime-owned workspace on the wrong host and silently drop the jump.
function getActivityThreadExecutionHostId(
  thread: AgentPaneThread,
  defaultHostId: ExecutionHostId
): ExecutionHostId {
  return getWorktreeExecutionHostId(thread.worktree, thread.repo ?? undefined, defaultHostId)
}

type ActivityThreadWorkspaceCatalog = Pick<
  AppState,
  'worktreesByRepo' | 'detectedWorktreesByRepo' | 'folderWorkspaces' | 'floatingWorkspacePath'
> & { defaultHostId: ExecutionHostId }

function readActivityThreadWorkspaceCatalog(): ActivityThreadWorkspaceCatalog {
  const state = useAppStore.getState()
  return { ...state, defaultHostId: getSettingsFocusedExecutionHostId(state.settings) }
}

export function hasActivityThreadWorkspace(
  thread: AgentPaneThread,
  catalog: ActivityThreadWorkspaceCatalog = readActivityThreadWorkspaceCatalog()
): boolean {
  return Boolean(
    findKnownWorktreeById(
      catalog,
      thread.worktree.id,
      getActivityThreadExecutionHostId(thread, catalog.defaultHostId)
    )
  )
}

let latestThreadActivation = 0

/** Restore the selected thread before focusing its exact surface; newer navigation wins. */
export function activateActivityThreadTarget(thread: AgentPaneThread): void {
  const activation = ++latestThreadActivation
  const isFloatingTerminal = thread.worktree.id === FLOATING_TERMINAL_WORKTREE_ID
  const executionHostId = getActivityThreadExecutionHostId(
    thread,
    getSettingsFocusedExecutionHostId(useAppStore.getState().settings)
  )
  if (
    !isFloatingTerminal &&
    activateAndRevealWorkspace(thread.worktree.id, {
      executionHostId,
      revealInSidebar: false,
      clearSidebarFilters: false
    }) === false
  ) {
    return
  }
  const pending = isFloatingTerminal ? null : getPendingWorktreeAgentActivation(thread.worktree.id)
  if (!pending) {
    focusActivityThreadTarget(thread)
    return
  }
  // Sleeping recovery is asynchronous; a residency check before it finishes drops the target.
  void pending.then(
    (outcome) => {
      const state = useAppStore.getState()
      if (
        outcome === 'blocked' ||
        activation !== latestThreadActivation ||
        state.activeWorktreeId !== thread.worktree.id ||
        (state.activeWorkspaceExecutionHostId ?? 'local') !== executionHostId ||
        state.activeView !== 'terminal' ||
        !state.getKnownWorktreeById(thread.worktree.id, executionHostId)
      ) {
        return
      }
      focusActivityThreadTarget(thread)
    },
    () => undefined
  )
}

function focusActivityThreadTarget(thread: AgentPaneThread): void {
  if (activateStructuredAgentSessionTab({ worktreeId: thread.worktree.id, tabId: thread.tab.id })) {
    return
  }
  // Recovery may have just revived the selected tab; retained rows must not focus a sibling.
  const activated = useAppStore.getState()
  const liveTabs = activated.tabsByWorktree[thread.worktree.id] ?? []
  if (!liveTabs.some((tab) => tab.id === thread.tab.id)) {
    // Retained threads outlive their tab; the workspace is still activated, but there is
    // no pane to focus and focusing a sibling would be worse than focusing nothing.
    return
  }
  // Floating tabs have no catalog workspace; reveal their panel without changing the main workspace.
  if (thread.worktree.id === FLOATING_TERMINAL_WORKTREE_ID) {
    revealFloatingWorkspacePanel(activated)
  }
  activated.setActiveTabType('terminal', thread.worktree.id)
  const parsed = parsePaneKey(thread.paneKey)
  activateTabAndFocusPane(
    thread.tab.id,
    parsed && parsed.tabId === thread.tab.id ? parsed.leafId : null,
    { flashFocusedPane: true, scrollToBottomIfOutputSinceLastView: true }
  )
}

export function createActivityThreadActions({
  getMarkAllReadThreads,
  acknowledgeAgents,
  unacknowledgeAgents,
  setSelectedPaneKey
}: {
  /** Getter (not a snapshot) so the handlers keep one identity for the row memo
   *  bail-outs while bulk actions still see the current thread set. This is the
   *  badge-coherent set (child-filter only), not the search/scope-narrowed one,
   *  so Mark all read always drives the Agents badge to zero. */
  getMarkAllReadThreads: () => AgentPaneThread[]
  acknowledgeAgents: (paneKeys: string[], reads?: undefined, intent?: 'explicit') => void
  unacknowledgeAgents: (paneKeys: string[]) => void
  setSelectedPaneKey: (paneKey: string | null) => void
}): {
  markThreadRead: (thread: AgentPaneThread) => void
  markThreadUnread: (thread: AgentPaneThread) => void
  markThreadsRead: (threads: readonly AgentPaneThread[]) => void
  markThreadsUnread: (threads: readonly AgentPaneThread[]) => void
  selectThread: (thread: AgentPaneThread) => void
  jumpToWorkspace: (thread: AgentPaneThread) => void
  markAllThreadsRead: () => void
} {
  const markThreadsRead = (threads: readonly AgentPaneThread[]): void => {
    acknowledgeAgents(
      threads.map((thread) => thread.paneKey),
      undefined,
      'explicit'
    )
  }

  const markThreadsUnread = (threads: readonly AgentPaneThread[]): void => {
    unacknowledgeAgents(threads.map((thread) => thread.paneKey))
  }

  const markThreadRead = (thread: AgentPaneThread): void => markThreadsRead([thread])

  const markThreadUnread = (thread: AgentPaneThread): void => markThreadsUnread([thread])

  const selectThread = (thread: AgentPaneThread): void => {
    setSelectedPaneKey(thread.paneKey)
    activateActivityThreadTarget(thread)
  }

  const jumpToWorkspace = (thread: AgentPaneThread): void => {
    const catalog = readActivityThreadWorkspaceCatalog()
    if (!hasActivityThreadWorkspace(thread, catalog)) {
      return
    }
    markThreadRead(thread)
    jumpToWorktreeFromSidebar(thread.worktree.id, {
      executionHostId: getActivityThreadExecutionHostId(thread, catalog.defaultHostId)
    })
  }

  const markAllThreadsRead = (): void => {
    const unreadKeys = getMarkAllReadThreads()
      .filter((t) => t.unread)
      .map((t) => t.paneKey)
    if (unreadKeys.length === 0) {
      return
    }
    acknowledgeAgents(unreadKeys, undefined, 'explicit')
  }

  return {
    markThreadRead,
    markThreadUnread,
    markThreadsRead,
    markThreadsUnread,
    selectThread,
    jumpToWorkspace,
    markAllThreadsRead
  }
}
