import type { AppState } from '@/store'
import { claudeAccountIdFromTranscriptPath } from '../../../shared/claude-transcript-account'
import type { ClaudeRateLimitAccountsState } from '../../../shared/managed-account-types'
import { isRemoteRuntimePtyId } from '../../../shared/remote-runtime-pty-id'
import { makePaneKey } from '../../../shared/stable-pane-id'
import { getEligiblePane, toRuntimePtyId } from './agent-hibernation-pane-eligibility'

export type ClaudeSessionMoveView = Pick<
  AppState,
  | 'tabsByWorktree'
  | 'terminalLayoutsByTabId'
  | 'ptyIdsByTabId'
  | 'agentStatusByPaneKey'
  | 'sleepingAgentSessionsByPaneKey'
  | 'lastTerminalInputAtByPaneKey'
>

export type ClaudeSessionOnOtherLogin = {
  paneKey: string
  tabId: string
  leafId: string
  ptyId: string
  worktreeId: string
  sessionId: string
  /** The selected account's login, so a move is recorded against where it went. */
  targetLogin: string
}

export type ClaudeSessionMoveGates = {
  now: number
  idleMs: number
  foregroundTabIds: ReadonlySet<string>
  foregroundLastSeenAtByTabId: Record<string, number | undefined>
  mobileLockedPtyIds: Set<string>
  ptyBindingFirstSeenAtByPaneKey: Record<string, number | undefined>
  boundaryResolvedAtByPaneKey: Record<string, number | undefined>
}

type ClaudeLogin = { email: string; organizationUuid?: string | null }

// Why the login and not the folder: usage limits follow the login, and two folders can hold the
// same one (an account whose login is System default's runs from the System default folder).
function isSameLogin(a: ClaudeLogin, b: ClaudeLogin): boolean {
  return (
    a.email.toLowerCase() === b.email.toLowerCase() &&
    (!a.organizationUuid || !b.organizationUuid || a.organizationUuid === b.organizationUuid)
  )
}

function loginOf(
  accounts: ClaudeRateLimitAccountsState,
  accountId: string | null
): ClaudeLogin | null {
  if (accountId === null) {
    return accounts.systemDefaultEmail ? { email: accounts.systemDefaultEmail } : null
  }
  const account = accounts.accounts.find((candidate) => candidate.id === accountId)
  return account ? { email: account.email, organizationUuid: account.organizationUuid } : null
}

/** Claude sessions on this host still running on a login other than the selected one. */
export function findClaudeSessionsOnOtherLogin(
  view: ClaudeSessionMoveView,
  accounts: ClaudeRateLimitAccountsState,
  isOnThisHost: (worktreeId: string) => boolean
): ClaudeSessionOnOtherLogin[] {
  const selectedAccountId = accounts.activeAccountIdsByRuntime
    ? accounts.activeAccountIdsByRuntime.host
    : accounts.activeAccountId
  const selected = loginOf(accounts, selectedAccountId)
  if (!selected) {
    return []
  }
  const sessions: ClaudeSessionOnOtherLogin[] = []
  for (const [worktreeId, tabs] of Object.entries(view.tabsByWorktree)) {
    if (!isOnThisHost(worktreeId)) {
      continue
    }
    for (const tab of tabs) {
      const ptyIdsByLeafId = view.terminalLayoutsByTabId[tab.id]?.ptyIdsByLeafId ?? {}
      for (const [leafId, ptyId] of Object.entries(ptyIdsByLeafId)) {
        const paneKey = makePaneKey(tab.id, leafId)
        const entry = view.agentStatusByPaneKey[paneKey]
        const providerSession = entry?.providerSession
        if (
          entry?.agentType !== 'claude' ||
          !providerSession?.transcriptPath ||
          !ptyId ||
          isRemoteRuntimePtyId(ptyId)
        ) {
          continue
        }
        const login = loginOf(
          accounts,
          claudeAccountIdFromTranscriptPath(providerSession.transcriptPath)
        )
        if (!login || isSameLogin(login, selected)) {
          continue
        }
        sessions.push({
          paneKey,
          tabId: tab.id,
          leafId,
          ptyId,
          worktreeId,
          sessionId: providerSession.id,
          targetLogin: selected.email
        })
      }
    }
  }
  return sessions
}

/** Whether restarting the session now loses nothing: hibernation's own test for a pane it may stop. */
export function isClaudeSessionMovableNow(
  view: ClaudeSessionMoveView,
  session: ClaudeSessionOnOtherLogin,
  gates: ClaudeSessionMoveGates
): boolean {
  if (gates.foregroundTabIds.has(session.tabId)) {
    return false
  }
  const entry = view.agentStatusByPaneKey[session.paneKey]
  const tab = view.tabsByWorktree[session.worktreeId]?.find(
    (candidate) => candidate.id === session.tabId
  )
  if (!entry || !tab) {
    return false
  }
  const eligible = getEligiblePane({
    entry,
    tab,
    layout: view.terminalLayoutsByTabId[session.tabId],
    livePtyIds: new Set((view.ptyIdsByTabId[session.tabId] ?? []).map(toRuntimePtyId)),
    sleepingAgentSessionsByPaneKey: view.sleepingAgentSessionsByPaneKey,
    lastTerminalInputAtByPaneKey: view.lastTerminalInputAtByPaneKey,
    foregroundTerminalLastSeenAtByTabId: gates.foregroundLastSeenAtByTabId,
    ptyBindingFirstSeenAtByPaneKey: gates.ptyBindingFirstSeenAtByPaneKey,
    boundaryResolvedAtByPaneKey: gates.boundaryResolvedAtByPaneKey,
    mobileLockedPtyIds: gates.mobileLockedPtyIds,
    now: gates.now,
    idleMs: gates.idleMs,
    allowEndedTurn: true
  })
  return eligible !== null
}
