import { resolve } from 'node:path'
import { agentRunAccountsEqual, type AgentRunAccount } from '../../shared/agent-run-account'
import { normalizeAgentProviderSession } from '../../shared/agent-session-resume'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { EnrichedAgentHookEventPayload } from '../agent-hooks/server'
import type { AgentRunAccountRow } from '../agent-hooks/server/server-run-account'
import type { CodexPaneAccountRecord } from '../codex/codex-pane-account-registry'
import { getSelectedClaudeAccountIdForTarget } from '../claude-accounts/runtime-selection'
import {
  computeAgentRunAccount,
  runAccountProvider,
  type ClaudePaneObservation,
  type ClaudeStatusLineReport
} from './agent-run-account-compute'
import {
  adoptClaudeSession,
  adoptCodexSession,
  keptConversationAccount,
  type KeptConversationLookup
} from './agent-run-account-adoption'

// Why: launch facts only bridge a spawn to its first row; losing the oldest one only
// delays that pane's facet until it reports a new session.
const MAX_TRACKED_PANES = 2048

export type AgentRunAccountSettings = Pick<
  GlobalSettings,
  | 'claudeManagedAccounts'
  | 'codexManagedAccounts'
  | 'activeClaudeManagedAccountId'
  | 'activeClaudeManagedAccountIdsByRuntime'
>

export type AgentRunAccountStatusRow = Pick<
  EnrichedAgentHookEventPayload,
  'paneKey' | 'connectionId' | 'providerSession' | 'runAccount' | 'structuredHost'
> & { payload: { agentType?: string } }

export type AgentRunAccountsDeps = {
  republish: (paneKey: string, runAccount: AgentRunAccount | null) => boolean
  getRow: (paneKey: string) => AgentRunAccountRow | null
  listRows: () => readonly AgentRunAccountStatusRow[]
  getSettings: () => AgentRunAccountSettings
  getPtyIdForPaneKey: (paneKey: string) => string | undefined
  readCodexRecord: (ptyId: string) => CodexPaneAccountRecord | null
  claudeFolders: {
    accountHome: (accountId: string) => string
    systemDefaultHome: () => string
    coveredBySystemDefault: (accountId: string) => boolean
  } | null
  kept: KeptConversationLookup
  now?: () => number
}

export type PaneLaunchFact = {
  paneKey: string
  /** Selection lane the spawn resolved ('host' | 'wsl:<distro>'). */
  lane: string
  /** False for a reattach, which never re-resolves accounts. */
  fresh: boolean
  /** Set when the pane was started with a per-account Claude pointer (kept start). */
  claudeShellAccount?: { accountId: string | null }
  /** The provider session a kept start resumed; Claude may report it under a new id. */
  resumedSessionId?: string
}

type ClaudePaneState = ClaudePaneObservation & {
  sessionId: string | null
  /** Account the pane's own pointer names, for panes started kept. */
  pointerAccountId?: string | null
  lastConfigDir?: string | null
}

function setBounded<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key)
  map.set(key, value)
  if (map.size > MAX_TRACKED_PANES) {
    const oldest = map.keys().next().value
    if (typeof oldest === 'string') {
      map.delete(oldest)
    }
  }
}

function sessionIdOf(row: Pick<AgentRunAccountStatusRow, 'providerSession'>): string | null {
  return normalizeAgentProviderSession(row.providerSession)?.id ?? null
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const resolved = resolve(value)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  return normalize(left) === normalize(right)
}

/**
 * The single producer of the run-account facet on Agent Status rows. It joins what a
 * spawn knew (launch facts, the Codex launch record) with what the agent later reports
 * (session ids, the Claude statusline folder) and republishes only when the facet changes.
 */
export class AgentRunAccounts {
  private readonly launches = new Map<string, PaneLaunchFact>()
  private readonly claudePanes = new Map<string, ClaudePaneState>()

  constructor(private readonly deps: AgentRunAccountsDeps) {}

  notePaneLaunch(fact: PaneLaunchFact): void {
    setBounded(this.launches, fact.paneKey, fact)
    if (fact.fresh) {
      // Why: a fresh spawn starts a new process, so nothing observed for the old one applies.
      this.claudePanes.delete(fact.paneKey)
    }
    this.refresh(fact.paneKey)
  }

  noteStatus(row: AgentRunAccountStatusRow): void {
    const provider = runAccountProvider(row.payload.agentType)
    if (row.connectionId === null && !row.structuredHost) {
      if (provider === 'claude') {
        this.observeClaudeSession(row)
      } else if (provider === 'codex') {
        const ptyId = this.deps.getPtyIdForPaneKey(row.paneKey)
        adoptCodexSession({
          kept: this.deps.kept,
          record: ptyId ? this.deps.readCodexRecord(ptyId) : null,
          sessionId: sessionIdOf(row),
          transcriptPath: row.providerSession?.transcriptPath,
          now: this.now()
        })
      }
    }
    this.publish(row)
  }

  noteClaudeStatusLine(event: { paneKey: string; configDir: string | null }): void {
    const state = this.claudePanes.get(event.paneKey)
    if (!state || state.lastConfigDir === event.configDir) {
      return
    }
    state.lastConfigDir = event.configDir
    state.statusLine = this.accountForClaudeConfigDir(event.configDir, state.accountId)
    this.refresh(event.paneKey)
  }

  /** Recomputes one pane's facet from its stored row. */
  refresh(paneKey: string): AgentRunAccount | null {
    const row = this.deps.getRow(paneKey)
    if (!row) {
      return null
    }
    return this.publish({
      paneKey: row.paneKey,
      connectionId: row.connectionId,
      providerSession: row.providerSession,
      runAccount: row.runAccount,
      payload: { agentType: row.agentType }
    })
  }

  refreshAll(): void {
    for (const row of this.deps.listRows()) {
      this.publish(row)
    }
  }

  private publish(row: AgentRunAccountStatusRow): AgentRunAccount | null {
    const next = this.compute(row)
    if (!agentRunAccountsEqual(row.runAccount, next)) {
      this.deps.republish(row.paneKey, next)
    }
    return next
  }

  private compute(row: AgentRunAccountStatusRow): AgentRunAccount | null {
    const provider = runAccountProvider(row.payload.agentType)
    const settings = this.deps.getSettings()
    const ptyId = provider === 'codex' ? this.deps.getPtyIdForPaneKey(row.paneKey) : undefined
    return computeAgentRunAccount({
      agentType: row.payload.agentType,
      connectionId: row.connectionId,
      structured: Boolean(row.structuredHost),
      providerSessionId: sessionIdOf(row),
      hasManagedAccounts:
        provider === 'codex'
          ? settings.codexManagedAccounts.length > 0
          : settings.claudeManagedAccounts.length > 0,
      lane: this.launches.get(row.paneKey)?.lane,
      codexRecord: ptyId ? this.deps.readCodexRecord(ptyId) : null,
      claude: provider === 'claude' ? (this.claudePanes.get(row.paneKey) ?? null) : null,
      current: row.runAccount ?? undefined,
      claudeKeptAccountId:
        provider === 'claude'
          ? keptConversationAccount(this.deps.kept, 'claude', sessionIdOf(row))
          : undefined
    })
  }

  private observeClaudeSession(row: AgentRunAccountStatusRow): void {
    const sessionId = sessionIdOf(row)
    const existing = this.claudePanes.get(row.paneKey)
    if (existing && (sessionId === null || sessionId === existing.sessionId)) {
      return
    }
    const fact = this.launches.get(row.paneKey)
    if (!existing) {
      const persisted = row.runAccount?.provider === 'claude' ? row.runAccount : undefined
      const shellRoute = fact?.claudeShellAccount
        ? 'account'
        : (persisted?.shellRoute ?? 'selected')
      const pointerAccountId =
        fact?.claudeShellAccount?.accountId ??
        (shellRoute === 'account' ? persisted?.accountId : undefined)
      // Why: only a session this runtime saw start may be dated to the selection now;
      // one that was already running keeps what an earlier runtime recorded, or nothing.
      const accountId = fact?.fresh
        ? this.claudeStartAccount(shellRoute, pointerAccountId)
        : persisted?.accountId
      setBounded(this.claudePanes, row.paneKey, {
        sessionId,
        shellRoute,
        pointerAccountId,
        accountId
      })
      this.adoptClaude(row, fact?.fresh ? fact.resumedSessionId : undefined, accountId)
      return
    }
    const accountId = this.claudeStartAccount(existing.shellRoute, existing.pointerAccountId)
    setBounded(this.claudePanes, row.paneKey, {
      sessionId,
      shellRoute: existing.shellRoute,
      pointerAccountId: existing.pointerAccountId,
      accountId
    })
    this.adoptClaude(row, existing.sessionId, accountId)
  }

  private adoptClaude(
    row: AgentRunAccountStatusRow,
    previousSessionId: string | null | undefined,
    accountId: string | null | undefined
  ): void {
    adoptClaudeSession({
      kept: this.deps.kept,
      previousSessionId,
      sessionId: sessionIdOf(row),
      accountId,
      transcriptPath: row.providerSession?.transcriptPath,
      now: this.now()
    })
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  /** The account a `claude` started now in this pane reads: its own pointer, or the selection. */
  private claudeStartAccount(
    shellRoute: 'selected' | 'account',
    pointerAccountId: string | null | undefined
  ): string | null | undefined {
    if (shellRoute === 'account') {
      return pointerAccountId
    }
    return getSelectedClaudeAccountIdForTarget(this.deps.getSettings(), { runtime: 'host' })
  }

  private accountForClaudeConfigDir(
    configDir: string | null,
    startAccountId: string | null | undefined
  ): ClaudeStatusLineReport {
    const folders = this.deps.claudeFolders
    if (!folders) {
      return 'unknown-folder'
    }
    try {
      if (!configDir || samePath(configDir, folders.systemDefaultHome())) {
        // Why: an account saved before per-account folders runs on System default's login.
        return {
          accountId:
            startAccountId && folders.coveredBySystemDefault(startAccountId) ? startAccountId : null
        }
      }
      for (const account of this.deps.getSettings().claudeManagedAccounts) {
        if (
          account.managedAuthRuntime !== 'wsl' &&
          samePath(configDir, folders.accountHome(account.id))
        ) {
          return { accountId: account.id }
        }
      }
    } catch (error) {
      console.warn('[agent-run-accounts] Could not map a Claude config folder:', error)
    }
    return 'unknown-folder'
  }
}
