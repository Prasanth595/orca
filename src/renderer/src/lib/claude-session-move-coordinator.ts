import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { restartPaneForAccountMove } from '@/components/terminal-pane/pane-account-move-restarts'
import { inspectRuntimeTerminalProcess } from '@/runtime/runtime-terminal-inspection'
import { recognizeAgentProcess } from '../../../shared/agent-process-recognition'
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
/** Panes already moved, or left alone, toward a login; a new report from the session lifts it. */
const settledMoves = new Map<string, { transcriptPath: string; targetLogin: string }>()
let accounts: ClaudeRateLimitAccountsState | null = null
let wakeRetry: (() => void) | null = null

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
  // Why forget on failure: the old list may name the account we just switched away from.
  accounts = await window.api.claudeAccounts.list().catch(() => null)
}

function isSettled(session: ClaudeSessionOnOtherLogin): boolean {
  const settled = settledMoves.get(session.paneKey)
  return (
    settled?.transcriptPath === session.transcriptPath &&
    settled.targetLogin === session.targetLogin
  )
}

function settle(session: ClaudeSessionOnOtherLogin): void {
  settledMoves.set(session.paneKey, {
    transcriptPath: session.transcriptPath,
    targetLogin: session.targetLogin
  })
  approvedPaneKeys.delete(session.paneKey)
}

// Why ask the process: the pane may now run tmux or the shell, and restarting it there would cut
// off a Claude that lives on outside the pane, or start one nobody runs any more.
async function isRunningClaude(ptyId: string): Promise<boolean> {
  const inspection = await inspectRuntimeTerminalProcess(ptyId).catch(() => null)
  return recognizeAgentProcess(inspection?.foregroundProcess)?.agent === 'claude'
}

/** Claude sessions on this machine still to move to the selected login. */
export function listClaudeSessionsOnOtherLogin(state: AppState): ClaudeSessionOnOtherLogin[] {
  // Why drop settled ones: a moved session reads as the old login until it reports again, and one
  // that cannot be resumed has nothing for the button to do.
  return accounts
    ? findClaudeSessionsOnOtherLogin(state, accounts, (worktreeId) =>
        isOnThisHost(state, worktreeId)
      ).filter((session) => !isSettled(session))
    : []
}

/** Moves every session on another login, each one as soon as it can go without losing anything. */
export async function moveClaudeSessionsToSelectedAccount(): Promise<void> {
  await refreshClaudeMoveAccounts()
  for (const session of listClaudeSessionsOnOtherLogin(useAppStore.getState())) {
    approvedPaneKeys.add(session.paneKey)
  }
  // Why wake the retry: a pane that cannot go yet may free up with no store change to notice it.
  if ((await movePanes()) > 0) {
    wakeRetry?.()
  }
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
async function movePanes(): Promise<number> {
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
    const approved = approvedPaneKeys.has(session.paneKey)
    if (isSettled(session) || (!approved && !automatic)) {
      continue
    }
    if (!isClaudeSessionMovableNow(view, session, gatesFor(approved))) {
      waiting += 1
      continue
    }
    if (!(await isRunningClaude(session.ptyId))) {
      settle(session)
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
      settle(session)
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
    const pendingWork =
      approvedPaneKeys.size > 0 || useAppStore.getState().settings?.claudeMoveIdleSessions === true
    // Why recheck while any wait: idle time runs out, and a failed accounts read clears, without a
    // store change to wake us.
    if ((await movePanes()) > 0 || (!accounts && pendingWork)) {
      schedule(RECHECK_MS)
    }
  }
  wakeRetry = () => schedule(RECHECK_MS)
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
    wakeRetry = null
  }
}
