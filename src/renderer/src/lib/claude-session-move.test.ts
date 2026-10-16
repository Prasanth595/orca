import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import type {
  ClaudeManagedAccountSummary,
  ClaudeRateLimitAccountsState
} from '../../../shared/managed-account-types'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import {
  findClaudeSessionsOnOtherLogin,
  isClaudeSessionMovableNow,
  type ClaudeSessionMoveGates,
  type ClaudeSessionMoveView
} from './claude-session-move'

const NOW = 5_000_000
const LEAF = '11111111-1111-4111-8111-111111111111'
const PROFILES = '/Users/me/Library/Application Support/orca/claude-profiles'

function account(id: string, email: string): ClaudeManagedAccountSummary {
  return {
    id,
    email,
    authMethod: 'subscription-oauth',
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1
  }
}

function accounts(
  activeAccountId: string | null,
  systemDefaultEmail = 'me@example.test'
): ClaudeRateLimitAccountsState {
  return {
    accounts: [account('acct-a', 'a@example.test'), account('acct-b', 'b@example.test')],
    activeAccountId,
    activeAccountIdsByRuntime: { host: activeAccountId, wsl: {} },
    systemDefaultEmail
  }
}

function tab(): TerminalTab {
  return {
    id: 'tab-1',
    ptyId: null,
    worktreeId: 'wt-1',
    title: 'Claude',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

function claudeRow(
  transcriptPath: string | undefined,
  overrides: Partial<AgentStatusEntry> = {}
): AgentStatusEntry {
  return {
    state: 'done',
    prompt: 'ship it',
    updatedAt: NOW - 1_000,
    stateStartedAt: NOW - 1_000,
    paneKey: `tab-1:${LEAF}`,
    tabId: 'tab-1',
    worktreeId: 'wt-1',
    agentType: 'claude',
    providerSession: {
      key: 'session_id',
      id: 'session-1',
      ...(transcriptPath ? { transcriptPath } : {})
    },
    stateHistory: [],
    ...overrides
  }
}

function view(
  row: AgentStatusEntry,
  extra: Partial<ClaudeSessionMoveView> = {}
): ClaudeSessionMoveView {
  return {
    tabsByWorktree: { 'wt-1': [tab()] },
    terminalLayoutsByTabId: {
      'tab-1': {
        root: { type: 'leaf', leafId: LEAF },
        activeLeafId: LEAF,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF]: 'pty-1' }
      }
    },
    ptyIdsByTabId: { 'tab-1': ['pty-1'] },
    agentStatusByPaneKey: { [row.paneKey]: row },
    sleepingAgentSessionsByPaneKey: {},
    lastTerminalInputAtByPaneKey: {},
    ...extra
  }
}

const onThisHost = (): boolean => true
const onA = `${PROFILES}/acct-a/home/projects/-repo/session-1.jsonl`
const onB = `${PROFILES}/acct-b/home/projects/-repo/session-1.jsonl`
const onSystemDefault = '/Users/me/.claude/projects/-repo/session-1.jsonl'

function gates(overrides: Partial<ClaudeSessionMoveGates> = {}): ClaudeSessionMoveGates {
  return {
    now: NOW,
    idleMs: 0,
    foregroundTabIds: new Set(),
    foregroundLastSeenAtByTabId: {},
    mobileLockedPtyIds: new Set(),
    ptyBindingFirstSeenAtByPaneKey: {},
    boundaryResolvedAtByPaneKey: {},
    ...overrides
  }
}

describe('findClaudeSessionsOnOtherLogin', () => {
  it('finds a session still on the account it started on after a switch', () => {
    expect(
      findClaudeSessionsOnOtherLogin(view(claudeRow(onA)), accounts('acct-b'), onThisHost)
    ).toEqual([
      {
        paneKey: `tab-1:${LEAF}`,
        tabId: 'tab-1',
        leafId: LEAF,
        ptyId: 'pty-1',
        worktreeId: 'wt-1',
        sessionId: 'session-1',
        targetLogin: 'b@example.test'
      }
    ])
  })

  it('leaves a session that already runs on the selected login', () => {
    expect(
      findClaudeSessionsOnOtherLogin(view(claudeRow(onB)), accounts('acct-b'), onThisHost)
    ).toEqual([])
  })

  it('moves a System default session when another login is selected', () => {
    expect(
      findClaudeSessionsOnOtherLogin(
        view(claudeRow(onSystemDefault)),
        accounts('acct-a'),
        onThisHost
      )
    ).toHaveLength(1)
  })

  it('counts an account that holds the System default login as already in use there', () => {
    // Why: Orca runs an account whose login is System default's from the System default folder.
    expect(
      findClaudeSessionsOnOtherLogin(
        view(claudeRow(onSystemDefault)),
        accounts('acct-a', 'A@example.test'),
        onThisHost
      )
    ).toEqual([])
  })

  it('skips what it cannot place', () => {
    const unplaced = [
      claudeRow(onA, { agentType: 'codex' }),
      claudeRow(undefined),
      claudeRow(`${PROFILES}/acct-removed/home/projects/-repo/session-1.jsonl`)
    ]
    for (const row of unplaced) {
      expect(findClaudeSessionsOnOtherLogin(view(row), accounts('acct-b'), onThisHost)).toEqual([])
    }
    expect(
      findClaudeSessionsOnOtherLogin(
        view(claudeRow(onSystemDefault)),
        accounts('acct-b', ''),
        onThisHost
      )
    ).toEqual([])
    expect(
      findClaudeSessionsOnOtherLogin(view(claudeRow(onA)), accounts('acct-b'), () => false)
    ).toEqual([])
  })
})

describe('isClaudeSessionMovableNow', () => {
  function movable(
    row: AgentStatusEntry,
    extra: Partial<ClaudeSessionMoveView> = {},
    gateOverrides: Partial<ClaudeSessionMoveGates> = {}
  ): boolean {
    const sessionView = view(row, extra)
    const [session] = findClaudeSessionsOnOtherLogin(sessionView, accounts('acct-b'), onThisHost)
    return isClaudeSessionMovableNow(sessionView, session, gates(gateOverrides))
  }

  it('moves a finished session', () => {
    expect(movable(claudeRow(onA))).toBe(true)
  })

  it('waits while the session works or asks you something', () => {
    expect(movable(claudeRow(onA, { state: 'working' }))).toBe(false)
    expect(movable(claudeRow(onA, { state: 'waiting' }))).toBe(false)
  })

  it('waits while subagents still run', () => {
    expect(
      movable(claudeRow(onA, { subagents: [{ id: 'child-1', state: 'working', startedAt: NOW }] }))
    ).toBe(false)
  })

  it('keeps text you typed but did not send', () => {
    expect(
      movable(claudeRow(onA), { lastTerminalInputAtByPaneKey: { [`tab-1:${LEAF}`]: NOW - 10 } })
    ).toBe(false)
  })

  it('moves a session whose turn died on an error, which is how a usage limit ends one', () => {
    expect(
      movable(
        claudeRow(onA, {
          mainAgent: { state: 'done', stateStartedAt: NOW - 1_000, outcome: 'failure' }
        })
      )
    ).toBe(true)
  })

  it('waits for the idle time, and leaves the tab on screen when told to', () => {
    expect(movable(claudeRow(onA), {}, { idleMs: 60_000 })).toBe(false)
    expect(movable(claudeRow(onA), {}, { foregroundTabIds: new Set(['tab-1']) })).toBe(false)
  })
})
