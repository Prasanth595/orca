import type { AppState } from '@/store'
import {
  confirmRuntimeTerminalForegroundProcess,
  type RuntimeTerminalProcessInspection
} from '@/runtime/runtime-terminal-inspection'
import {
  isAgentForegroundWrapperProcess,
  recognizeAgentProcess
} from '../../../shared/agent-process-recognition'
import { claudeAccountIdFromTranscriptPath } from '../../../shared/claude-transcript-account'
import type { ClaudeRateLimitAccountsState } from '../../../shared/managed-account-types'
import { isRemoteRuntimePtyId } from '../../../shared/remote-runtime-pty-id'
import { isShellProcess } from '../../../shared/shell-process-detection'
import { makePaneKey } from '../../../shared/stable-pane-id'
import { isClientOnlyUnverifiableInspection } from '../../../shared/terminal-process-inspection'
import type { TuiAgent } from '../../../shared/tui-agent'
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
  /** Where the session reports its transcript; it changes once a moved session reports again. */
  transcriptPath: string
  /** The selected login, email and organization, so a move is recorded against where it went. */
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

/** What names the selected login; a settings save hands back every field as a new object. */
export function claudeMoveAccountsKey(settings: AppState['settings']): string {
  return JSON.stringify([
    settings?.activeClaudeManagedAccountId,
    settings?.activeClaudeManagedAccountIdsByRuntime?.host,
    settings?.claudeManagedAccounts?.map((account) => [account.id, account.updatedAt])
  ])
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
    return accounts.systemDefaultEmail
      ? {
          email: accounts.systemDefaultEmail,
          organizationUuid: accounts.systemDefaultOrganizationUuid
        }
      : null
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
        const accountId = claudeAccountIdFromTranscriptPath(providerSession.transcriptPath)
        const login = loginOf(accounts, accountId)
        // Why a removed account counts: no saved login is served from its folder any more, so the
        // session cannot be on the selected one.
        const removed = accountId !== null && !login
        if (!removed && (!login || isSameLogin(login, selected))) {
          continue
        }
        sessions.push({
          paneKey,
          tabId: tab.id,
          leafId,
          ptyId,
          worktreeId,
          transcriptPath: providerSession.transcriptPath,
          targetLogin: `${selected.email.toLowerCase()}/${selected.organizationUuid ?? ''}`
        })
      }
    }
  }
  return sessions
}

/**
 * Whether Claude is what runs in the pane, much as Codex's restart prompt tests it: Claude by name,
 * or an agent wrapper such as node in a tab that launched Claude (an npm install runs it under node).
 * tmux, the shell, another agent or another program means a restart would cut off something else.
 */
export function isClaudeRunningInPane(
  inspection: Pick<
    RuntimeTerminalProcessInspection,
    'foregroundProcess' | 'hasChildProcesses'
  > | null,
  launchAgent: TuiAgent | undefined
): boolean {
  if (!inspection || isClientOnlyUnverifiableInspection(inspection)) {
    return false
  }
  const { foregroundProcess, hasChildProcesses } = inspection
  if (recognizeAgentProcess(foregroundProcess)?.agent === 'claude') {
    return true
  }
  if (launchAgent !== 'claude' || foregroundProcess === null || !hasChildProcesses) {
    return false
  }
  // Why not another agent: restarting a Codex someone started here as Claude would end it.
  return (
    !isShellProcess(foregroundProcess) &&
    recognizeAgentProcess(foregroundProcess) === null &&
    isAgentForegroundWrapperProcess(foregroundProcess)
  )
}

/**
 * Whether the inspection could not see this machine's pane processes, so it says nothing either
 * way, even when a cached name says claude. Windows marks the foreground evidence unverifiable on
 * every local answer, so there it goes by the child-process evidence, as agent completion does.
 */
export function isUnseenPaneInspection(
  inspection: RuntimeTerminalProcessInspection,
  platform: NodeJS.Platform
): boolean {
  return (
    isClientOnlyUnverifiableInspection(inspection) ||
    inspection.childProcessEvidence === 'unverifiable' ||
    (platform !== 'win32' && inspection.foregroundProcessEvidence?.verdict === 'unverifiable')
  )
}

/**
 * Whether Claude runs in the pane, or null when its processes could not be seen. A shell reading in
 * a tab that launched Claude is read again fresh, as Codex's restart does: the cached read can flap
 * to the shell for a live agent (#11064).
 */
export async function readClaudeInPane(
  ptyId: string,
  inspection: RuntimeTerminalProcessInspection | null,
  launchAgent: TuiAgent | undefined,
  platform: NodeJS.Platform
): Promise<boolean | null> {
  if (!inspection || isUnseenPaneInspection(inspection, platform)) {
    return null
  }
  const { foregroundProcess } = inspection
  if (
    launchAgent !== 'claude' ||
    foregroundProcess === null ||
    !isShellProcess(foregroundProcess)
  ) {
    return isClaudeRunningInPane(inspection, launchAgent)
  }
  const confirmed = await confirmRuntimeTerminalForegroundProcess(ptyId)
  // Why children: a foreground other than the shell runs under it, as the daemon's own read says.
  return confirmed === null
    ? null
    : isClaudeRunningInPane({ foregroundProcess: confirmed, hasChildProcesses: true }, launchAgent)
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
