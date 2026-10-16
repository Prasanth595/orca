import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { restartPaneForAccountMove } from '@/components/terminal-pane/pane-account-move-restarts'
import { getLocalProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import type { ClaudeRateLimitAccountsState } from '../../../shared/managed-account-types'
import { MIN_AGENT_HIBERNATION_IDLE_MS } from './agent-hibernation-planner'
import {
  getHibernationBoundaryResolvedAtByPaneKey,
  getHibernationPtyBindingFirstSeenAtByPaneKey
} from './agent-hibernation-pane-age'
import { buildClaudeSessionMoveStartup } from './codex-account-restart-startup'
import {
  findClaudeSessionsOnOtherLogin,
  isClaudeSessionMovableNow,
  type ClaudeSessionMoveGates,
  type ClaudeSessionOnOtherLogin
} from './claude-session-move'
import {
  getForegroundTerminalTabIds,
  getForegroundTerminalTabLastSeenAtById
} from './foreground-terminal-tabs'
import { getAllDrivers } from './pane-manager/mobile-driver-state'
import { mergePendingTerminalInputActivity } from './terminal-input-activity-coalescing'
import { getExecutionHostIdForWorktree } from './worktree-runtime-owner'

// Why hibernation's shortest idle time: a move nobody asked for restarts the pane, so it waits as
// long as the gentlest sleep would before touching it.
const AUTOMATIC_MOVE_IDLE_MS = MIN_AGENT_HIBERNATION_IDLE_MS
const SETTLE_MS = 500
const RECHECK_MS = 15_000

/** Sessions you asked to move that were still busy, by pane. */
const approvedPaneKeys = new Set<string>()
/** `session->login` pairs already moved, or given up on because they cannot be resumed. */
const settledMoves = new Set<string>()
let accounts: ClaudeRateLimitAccountsState | null = null

export function resetClaudeSessionMoveForTests(): void {
  approvedPaneKeys.clear()
  settledMoves.clear()
  accounts = null
}

// Why this machine only: a pane on WSL, SSH or a remote server runs on another host's selection.
function isOnThisHost(state: AppState, worktreeId: string): boolean {
  if (getExecutionHostIdForWorktree(state, worktreeId) !== LOCAL_EXECUTION_HOST_ID) {
    return false
  }
  const runtime = getLocalProjectExecutionRuntimeContext(state, worktreeId)
  return !(runtime?.status === 'resolved' && runtime.runtime.kind === 'wsl')
}

/** Re-reads this host's Claude accounts, which name the selected login. */
export async function refreshClaudeMoveAccounts(): Promise<void> {
  accounts = await window.api.claudeAccounts.list().catch(() => accounts)
}

/** Claude sessions on this machine still running on a login other than the selected one. */
export function listClaudeSessionsOnOtherLogin(state: AppState): ClaudeSessionOnOtherLogin[] {
  return accounts
    ? findClaudeSessionsOnOtherLogin(state, accounts, (worktreeId) =>
        isOnThisHost(state, worktreeId)
      )
    : []
}

/** Moves every session on another login, each one as soon as it can go without losing anything. */
export async function moveClaudeSessionsToSelectedAccount(): Promise<void> {
  await refreshClaudeMoveAccounts()
  for (const session of listClaudeSessionsOnOtherLogin(useAppStore.getState())) {
    approvedPaneKeys.add(session.paneKey)
  }
  movePanes()
}

function gatesFor(approved: boolean): ClaudeSessionMoveGates {
  const shared = {
    now: Date.now(),
    mobileLockedPtyIds: new Set(
      [...getAllDrivers()].filter(([, driver]) => driver.kind === 'mobile').map(([ptyId]) => ptyId)
    ),
    ptyBindingFirstSeenAtByPaneKey: getHibernationPtyBindingFirstSeenAtByPaneKey(),
    boundaryResolvedAtByPaneKey: getHibernationBoundaryResolvedAtByPaneKey()
  }
  // Why: a session you asked to move goes at once, even on screen; one moved on its own leaves the
  // tab you are looking at alone and waits for the idle time.
  return approved
    ? { ...shared, idleMs: 0, foregroundTabIds: new Set(), foregroundLastSeenAtByTabId: {} }
    : {
        ...shared,
        idleMs: AUTOMATIC_MOVE_IDLE_MS,
        foregroundTabIds: new Set(getForegroundTerminalTabIds()),
        foregroundLastSeenAtByTabId: getForegroundTerminalTabLastSeenAtById()
      }
}

/** Moves what can go now and returns how many sessions still wait their turn. */
function movePanes(): number {
  if (!accounts) {
    return 0
  }
  const state = useAppStore.getState()
  // Why: input stamps are coalesced, so unsent text must include the not-yet-flushed keystroke.
  const view = {
    ...state,
    lastTerminalInputAtByPaneKey: mergePendingTerminalInputActivity(
      state.lastTerminalInputAtByPaneKey
    )
  }
  const sessions = findClaudeSessionsOnOtherLogin(view, accounts, (worktreeId) =>
    isOnThisHost(state, worktreeId)
  )
  const stalePaneKeys = new Set(sessions.map((session) => session.paneKey))
  for (const paneKey of approvedPaneKeys) {
    // Why: the account switched back, or the pane closed, so the answer no longer applies.
    if (!stalePaneKeys.has(paneKey)) {
      approvedPaneKeys.delete(paneKey)
    }
  }
  const automatic = state.settings?.claudeMoveIdleSessions === true
  let waiting = 0
  for (const session of sessions) {
    const moveKey = `${session.sessionId}->${session.targetLogin}`
    const approved = approvedPaneKeys.has(session.paneKey)
    if (settledMoves.has(moveKey) || (!approved && !automatic)) {
      continue
    }
    if (!isClaudeSessionMovableNow(view, session, gatesFor(approved))) {
      waiting += 1
      continue
    }
    const startup = buildClaudeSessionMoveStartup({
      tabId: session.tabId,
      leafId: session.leafId,
      worktreeId: session.worktreeId,
      shellOverride: state.tabsByWorktree[session.worktreeId]?.find(
        (tab) => tab.id === session.tabId
      )?.shellOverride
    })
    // Why settle either way: a session that cannot be resumed is never restarted blank, and one
    // that comes back still reading as the old login must not restart again.
    if (!startup || restartPaneForAccountMove(session.ptyId, startup)) {
      settledMoves.add(moveKey)
      approvedPaneKeys.delete(session.paneKey)
    } else {
      waiting += 1
    }
  }
  return waiting
}

export function installClaudeSessionMoveCoordinator(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = (delayMs: number): void => {
    clearTimeout(timer)
    timer = setTimeout(() => void run(), delayMs)
  }
  const run = async (): Promise<void> => {
    if (!accounts) {
      await refreshClaudeMoveAccounts()
    }
    // Why recheck while any wait: idle time runs out without a store change to wake us.
    if (movePanes() > 0) {
      schedule(RECHECK_MS)
    }
  }
  const unsubscribe = useAppStore.subscribe((state, previous) => {
    const settings = state.settings
    const before = previous.settings
    if (
      settings?.activeClaudeManagedAccountId !== before?.activeClaudeManagedAccountId ||
      settings?.activeClaudeManagedAccountIdsByRuntime !==
        before?.activeClaudeManagedAccountIdsByRuntime ||
      settings?.claudeManagedAccounts !== before?.claudeManagedAccounts
    ) {
      void refreshClaudeMoveAccounts().then(() => schedule(SETTLE_MS))
      return
    }
    const changed =
      settings?.claudeMoveIdleSessions !== before?.claudeMoveIdleSessions ||
      state.agentStatusByPaneKey !== previous.agentStatusByPaneKey ||
      state.terminalLayoutsByTabId !== previous.terminalLayoutsByTabId
    if (changed && (approvedPaneKeys.size > 0 || settings?.claudeMoveIdleSessions === true)) {
      schedule(SETTLE_MS)
    }
  })
  return () => {
    unsubscribe()
    clearTimeout(timer)
  }
}
