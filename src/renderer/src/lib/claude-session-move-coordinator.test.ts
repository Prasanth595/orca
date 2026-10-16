import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import type { ClaudeRateLimitAccountsState } from '../../../shared/managed-account-types'
import { getDefaultSettings } from '../../../shared/constants'
import { useAppStore } from '@/store'
import {
  installClaudeSessionMoveCoordinator,
  listClaudeSessionsOnOtherLogin,
  moveClaudeSessionsToSelectedAccount,
  resetClaudeSessionMoveForTests
} from './claude-session-move-coordinator'

const restartPaneForAccountMove = vi.hoisted(() => vi.fn(() => true))
const hasPaneAccountMoveRestart = vi.hoisted(() => vi.fn(() => true))
type Inspection = {
  foregroundProcess: string | null
  hasChildProcesses: boolean
  childProcessEvidence?: 'children' | 'no-children' | 'unverifiable'
  foregroundProcessEvidence?: {
    verdict: 'unverifiable'
    reason: string
    authorityGeneration: string
    observationEpoch: number
    capturedAgeMs: number
    ptyId: string
    ptyIncarnationId: string
  }
}
const foreground = vi.hoisted(() => ({ process: 'claude' }))
const inspect = vi.hoisted(() =>
  vi.fn(async (): Promise<Inspection> => ({
    foregroundProcess: foreground.process,
    hasChildProcesses: true
  }))
)
const confirm = vi.hoisted(() => vi.fn(async (): Promise<string | null> => 'claude'))
vi.mock('@/runtime/runtime-terminal-inspection', () => ({
  inspectRuntimeTerminalProcess: inspect,
  confirmRuntimeTerminalForegroundProcess: confirm
}))
type MoveStartup = { command: string; startupCommandDelivery: 'shell-ready'; launchAgent: 'claude' }
const buildClaudeSessionMoveStartup = vi.hoisted(() =>
  vi.fn((): MoveStartup | null => ({
    command: 'claude --resume session-1',
    startupCommandDelivery: 'shell-ready',
    launchAgent: 'claude'
  }))
)
vi.mock('@/components/terminal-pane/pane-account-move-restarts', () => ({
  restartPaneForAccountMove,
  hasPaneAccountMoveRestart
}))
vi.mock('./codex-account-restart-startup', () => ({ buildClaudeSessionMoveStartup }))
vi.mock('@/lib/local-preflight-context', () => ({
  getLocalProjectExecutionRuntimeContext: () => undefined
}))

const NOW = 50_000_000
const LEAF = '11111111-1111-4111-8111-111111111111'
const PANE_KEY = `tab-1:${LEAF}`
const ON_A = '/Users/me/orca/claude-profiles/acct-a/home/projects/-repo/session-1.jsonl'
const ON_B = '/Users/me/orca/claude-profiles/acct-b/home/projects/-repo/session-1.jsonl'

let roster: ClaudeRateLimitAccountsState
const list = vi.fn(async (): Promise<ClaudeRateLimitAccountsState> => roster)

function selected(accountId: string): ClaudeRateLimitAccountsState {
  return {
    accounts: [
      {
        id: 'acct-a',
        email: 'a@example.test',
        authMethod: 'subscription-oauth',
        createdAt: 1,
        updatedAt: 1,
        lastAuthenticatedAt: 1
      },
      {
        id: 'acct-b',
        email: 'b@example.test',
        authMethod: 'subscription-oauth',
        createdAt: 1,
        updatedAt: 1,
        lastAuthenticatedAt: 1
      }
    ],
    activeAccountId: accountId,
    activeAccountIdsByRuntime: { host: accountId, wsl: {} }
  }
}

function seed(
  row: Partial<AgentStatusEntry>,
  settings: { claudeMoveIdleSessions?: boolean } = {}
): void {
  useAppStore.setState({
    settings: { ...getDefaultSettings('/tmp'), ...settings },
    tabsByWorktree: {
      'wt-1': [
        {
          id: 'tab-1',
          ptyId: null,
          worktreeId: 'wt-1',
          title: 'Claude',
          launchAgent: 'claude',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1
        }
      ]
    },
    terminalLayoutsByTabId: {
      'tab-1': {
        root: { type: 'leaf', leafId: LEAF },
        activeLeafId: LEAF,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF]: 'pty-1' }
      }
    },
    ptyIdsByTabId: { 'tab-1': ['pty-1'] },
    sleepingAgentSessionsByPaneKey: {},
    lastTerminalInputAtByPaneKey: {},
    agentStatusByPaneKey: {
      [PANE_KEY]: {
        state: 'done',
        prompt: 'ship it',
        updatedAt: NOW - 120_000,
        stateStartedAt: NOW - 120_000,
        paneKey: PANE_KEY,
        tabId: 'tab-1',
        worktreeId: 'wt-1',
        agentType: 'claude',
        providerSession: { key: 'session_id', id: 'session-1', transcriptPath: ON_A },
        stateHistory: [],
        ...row
      }
    }
  })
}

function setRow(row: Partial<AgentStatusEntry>): void {
  const current = useAppStore.getState().agentStatusByPaneKey[PANE_KEY]
  if (!current) {
    throw new Error('No Claude row to update')
  }
  useAppStore.setState({
    agentStatusByPaneKey: {
      [PANE_KEY]: { ...current, stateStartedAt: Date.now() - 120_000, ...row }
    }
  })
}

function switchTo(accountId: string): void {
  roster = selected(accountId)
  useAppStore.setState((s) => ({
    settings: s.settings ? { ...s.settings, activeClaudeManagedAccountId: accountId } : s.settings
  }))
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1_000)
}

describe('Claude session moves', () => {
  let uninstall: () => void = () => {}

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW })
    vi.stubGlobal('window', { ...globalThis.window, api: { claudeAccounts: { list } } })
    roster = selected('acct-b')
    restartPaneForAccountMove.mockClear()
    hasPaneAccountMoveRestart.mockClear()
    inspect.mockClear()
    confirm.mockClear()
    list.mockClear()
    foreground.process = 'claude'
    buildClaudeSessionMoveStartup.mockClear()
    resetClaudeSessionMoveForTests()
  })

  afterEach(() => {
    uninstall()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reopens a finished session on the selected account when you ask', async () => {
    seed({})

    await moveClaudeSessionsToSelectedAccount()

    expect(restartPaneForAccountMove).toHaveBeenCalledWith(
      'pty-1',
      expect.objectContaining({ command: 'claude --resume session-1' })
    )
    // The menu stops counting it, though its row still names the old account until it reports.
    expect(listClaudeSessionsOnOtherLogin(useAppStore.getState())).toEqual([])
  })

  it('moves a busy session once its turn ends', async () => {
    seed({ state: 'working' })
    uninstall = installClaudeSessionMoveCoordinator()
    await moveClaudeSessionsToSelectedAccount()
    expect(restartPaneForAccountMove).not.toHaveBeenCalled()

    setRow({ state: 'done' })
    await settle()

    expect(restartPaneForAccountMove).toHaveBeenCalledOnce()
  })

  it('drops the move when the account switches back before the turn ends', async () => {
    seed({ state: 'working' })
    uninstall = installClaudeSessionMoveCoordinator()
    await moveClaudeSessionsToSelectedAccount()

    switchTo('acct-a')
    await settle()
    // Why switch again: the earlier answer was about a switch that was undone, so it must not
    // carry over to a later one.
    switchTo('acct-b')
    await settle()
    setRow({ state: 'done' })
    await settle()

    expect(restartPaneForAccountMove).not.toHaveBeenCalled()
  })

  it('moves idle background sessions on its own only when the setting is on', async () => {
    roster = selected('acct-a')
    seed({})
    uninstall = installClaudeSessionMoveCoordinator()
    switchTo('acct-b')
    await settle()
    expect(restartPaneForAccountMove).not.toHaveBeenCalled()

    useAppStore.setState((s) => ({
      settings: s.settings ? { ...s.settings, claudeMoveIdleSessions: true } : s.settings
    }))
    await settle()

    expect(restartPaneForAccountMove).toHaveBeenCalledOnce()
  })

  it('moves a session once, even if it still reads as the old account', async () => {
    seed({}, { claudeMoveIdleSessions: true })
    uninstall = installClaudeSessionMoveCoordinator()
    await moveClaudeSessionsToSelectedAccount()
    setRow({})
    await settle()

    expect(restartPaneForAccountMove).toHaveBeenCalledOnce()
  })

  it('leaves a session it cannot resume', async () => {
    buildClaudeSessionMoveStartup.mockReturnValueOnce(null)
    seed({})

    await moveClaudeSessionsToSelectedAccount()

    expect(restartPaneForAccountMove).not.toHaveBeenCalled()
  })

  it('leaves a pane where Claude is no longer what runs, such as tmux or the shell', async () => {
    foreground.process = 'tmux'
    seed({})

    await moveClaudeSessionsToSelectedAccount()

    expect(restartPaneForAccountMove).not.toHaveBeenCalled()
  })

  it('moves again once the session has reported from the account it moved to', async () => {
    seed({}, { claudeMoveIdleSessions: true })
    uninstall = installClaudeSessionMoveCoordinator()
    await moveClaudeSessionsToSelectedAccount()
    setRow({ providerSession: { key: 'session_id', id: 'session-1', transcriptPath: ON_B } })
    switchTo('acct-a')
    await settle()
    setRow({ providerSession: { key: 'session_id', id: 'session-1', transcriptPath: ON_A } })
    switchTo('acct-b')
    await settle()

    expect(restartPaneForAccountMove).toHaveBeenCalledTimes(3)
  })

  it('does not act on an old account list when reading the new one fails, and tries again', async () => {
    roster = selected('acct-a')
    seed({}, { claudeMoveIdleSessions: true })
    uninstall = installClaudeSessionMoveCoordinator()
    await moveClaudeSessionsToSelectedAccount()
    list
      .mockRejectedValueOnce(new Error('main is busy'))
      .mockRejectedValueOnce(new Error('still busy'))
    switchTo('acct-b')
    await settle()
    expect(restartPaneForAccountMove).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(16_000)

    expect(restartPaneForAccountMove).toHaveBeenCalledOnce()
  })

  it('keeps the account list from the latest switch when replies arrive out of order', async () => {
    roster = selected('acct-a')
    seed({ providerSession: { key: 'session_id', id: 'session-1', transcriptPath: ON_A } })
    uninstall = installClaudeSessionMoveCoordinator()
    let answerSlowly: (state: ClaudeRateLimitAccountsState) => void = () => {}
    list.mockImplementationOnce(
      () => new Promise<ClaudeRateLimitAccountsState>((resolve) => (answerSlowly = resolve))
    )
    switchTo('acct-b')
    switchTo('acct-a')
    await settle()
    answerSlowly(selected('acct-b'))
    await settle()

    expect(listClaudeSessionsOnOtherLogin(useAppStore.getState())).toEqual([])
  })

  it('retries a session you asked to move when its pane was not ready', async () => {
    restartPaneForAccountMove.mockReturnValueOnce(false)
    seed({})
    uninstall = installClaudeSessionMoveCoordinator()
    await moveClaudeSessionsToSelectedAccount()

    await vi.advanceTimersByTimeAsync(16_000)

    expect(restartPaneForAccountMove).toHaveBeenCalledTimes(2)
  })

  it('keeps text you start typing while it checks the pane', async () => {
    let answer: (inspection: Inspection) => void = () => {}
    inspect.mockImplementationOnce(() => new Promise<Inspection>((resolve) => (answer = resolve)))
    seed({})
    const moving = moveClaudeSessionsToSelectedAccount()
    await vi.advanceTimersByTimeAsync(0)
    useAppStore.setState({ lastTerminalInputAtByPaneKey: { [PANE_KEY]: Date.now() } })
    answer({ foregroundProcess: 'claude', hasChildProcesses: true })
    await moving

    expect(restartPaneForAccountMove).not.toHaveBeenCalled()
  })

  it('tries again after the pane could not be checked', async () => {
    inspect.mockRejectedValueOnce(new Error('pty is busy'))
    seed({})
    uninstall = installClaudeSessionMoveCoordinator()
    await moveClaudeSessionsToSelectedAccount()
    expect(restartPaneForAccountMove).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(16_000)

    expect(restartPaneForAccountMove).toHaveBeenCalledOnce()
  })

  it('keeps your Move request when the account list could not be read', async () => {
    seed({})
    uninstall = installClaudeSessionMoveCoordinator()
    list.mockRejectedValueOnce(new Error('main is busy'))
    await moveClaudeSessionsToSelectedAccount()
    expect(restartPaneForAccountMove).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(16_000)

    expect(restartPaneForAccountMove).toHaveBeenCalledOnce()
  })

  it('drops the move when the account switches back while it checks the pane', async () => {
    let answer: (inspection: Inspection) => void = () => {}
    inspect.mockImplementationOnce(() => new Promise<Inspection>((resolve) => (answer = resolve)))
    seed({})
    uninstall = installClaudeSessionMoveCoordinator()
    const moving = moveClaudeSessionsToSelectedAccount()
    await vi.advanceTimersByTimeAsync(0)
    switchTo('acct-a')
    await settle()
    answer({ foregroundProcess: 'claude', hasChildProcesses: true })
    await moving

    expect(restartPaneForAccountMove).not.toHaveBeenCalled()
  })

  it('stops an automatic move you turn off while it checks the pane', async () => {
    let answer: (inspection: Inspection) => void = () => {}
    inspect.mockImplementationOnce(() => new Promise<Inspection>((resolve) => (answer = resolve)))
    roster = selected('acct-a')
    seed({}, { claudeMoveIdleSessions: true })
    uninstall = installClaudeSessionMoveCoordinator()
    switchTo('acct-b')
    await settle()
    useAppStore.setState((s) => ({
      settings: s.settings ? { ...s.settings, claudeMoveIdleSessions: false } : s.settings
    }))
    answer({ foregroundProcess: 'claude', hasChildProcesses: true })
    await settle()

    expect(restartPaneForAccountMove).not.toHaveBeenCalled()
  })

  it("tries again when the pane's processes could not be read", async () => {
    inspect.mockResolvedValueOnce({
      foregroundProcess: 'zsh',
      hasChildProcesses: false,
      childProcessEvidence: 'unverifiable'
    })
    seed({})
    uninstall = installClaudeSessionMoveCoordinator()
    await moveClaudeSessionsToSelectedAccount()
    expect(restartPaneForAccountMove).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(16_000)

    expect(restartPaneForAccountMove).toHaveBeenCalledOnce()
  })

  it('does not use the old account list while a new one is being read', async () => {
    let answer: (inspection: Inspection) => void = () => {}
    inspect.mockImplementationOnce(() => new Promise<Inspection>((resolve) => (answer = resolve)))
    seed({})
    uninstall = installClaudeSessionMoveCoordinator()
    const moving = moveClaudeSessionsToSelectedAccount()
    await vi.advanceTimersByTimeAsync(0)
    list.mockImplementationOnce(() => new Promise<ClaudeRateLimitAccountsState>(() => {}))
    switchTo('acct-a')
    answer({ foregroundProcess: 'claude', hasChildProcesses: true })
    await moving

    expect(restartPaneForAccountMove).not.toHaveBeenCalled()
  })

  it('tries again when the foreground could not be verified, rather than giving up on the session', async () => {
    inspect.mockResolvedValueOnce({
      foregroundProcess: 'zsh',
      hasChildProcesses: false,
      foregroundProcessEvidence: {
        verdict: 'unverifiable',
        reason: 'process_table_unavailable',
        authorityGeneration: 'gen-1',
        observationEpoch: 1,
        capturedAgeMs: 0,
        ptyId: 'pty-1',
        ptyIncarnationId: 'inc-1'
      }
    })
    seed({})
    uninstall = installClaudeSessionMoveCoordinator()
    await moveClaudeSessionsToSelectedAccount()
    expect(restartPaneForAccountMove).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(16_000)

    expect(restartPaneForAccountMove).toHaveBeenCalledOnce()
  })

  it('does not trust a cached claude name the pane could not verify', async () => {
    inspect.mockResolvedValueOnce({
      foregroundProcess: 'claude',
      hasChildProcesses: true,
      foregroundProcessEvidence: {
        verdict: 'unverifiable',
        reason: 'process_table_unavailable',
        authorityGeneration: 'gen-1',
        observationEpoch: 1,
        capturedAgeMs: 0,
        ptyId: 'pty-1',
        ptyIncarnationId: 'inc-1'
      }
    })
    seed({})

    await moveClaudeSessionsToSelectedAccount()

    expect(restartPaneForAccountMove).not.toHaveBeenCalled()
  })

  it('moves a session whose pane reads as the shell for a moment while Claude still runs', async () => {
    foreground.process = 'zsh'
    seed({})

    await moveClaudeSessionsToSelectedAccount()

    expect(restartPaneForAccountMove).toHaveBeenCalledOnce()
  })

  it('moves a Claude the fresh read finds running under node', async () => {
    inspect.mockResolvedValueOnce({ foregroundProcess: 'zsh', hasChildProcesses: false })
    confirm.mockResolvedValueOnce('node')
    seed({})

    await moveClaudeSessionsToSelectedAccount()

    expect(restartPaneForAccountMove).toHaveBeenCalledOnce()
  })

  it('leaves the pane when the fresh read finds another agent there', async () => {
    foreground.process = 'zsh'
    confirm.mockResolvedValueOnce('codex')
    seed({})

    await moveClaudeSessionsToSelectedAccount()

    expect(restartPaneForAccountMove).not.toHaveBeenCalled()
  })

  it('leaves the pane once a fresh read confirms the shell', async () => {
    foreground.process = 'zsh'
    confirm.mockResolvedValueOnce('zsh')
    seed({})

    await moveClaudeSessionsToSelectedAccount()

    expect(restartPaneForAccountMove).not.toHaveBeenCalled()
    expect(listClaudeSessionsOnOtherLogin(useAppStore.getState())).toEqual([])
  })

  it('tries again when a fresh read of a shell reading cannot tell', async () => {
    foreground.process = 'zsh'
    confirm.mockResolvedValueOnce(null)
    seed({})
    uninstall = installClaudeSessionMoveCoordinator()
    await moveClaudeSessionsToSelectedAccount()
    expect(restartPaneForAccountMove).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(16_000)

    expect(restartPaneForAccountMove).toHaveBeenCalledOnce()
  })

  it('does not read the processes of a pane that is not mounted', async () => {
    hasPaneAccountMoveRestart.mockReturnValueOnce(false)
    seed({})

    await moveClaudeSessionsToSelectedAccount()

    expect(inspect).not.toHaveBeenCalled()
  })

  it('does not read the accounts again when an unrelated setting is saved', async () => {
    seed({}, { claudeMoveIdleSessions: true })
    uninstall = installClaudeSessionMoveCoordinator()
    await settle()
    list.mockClear()

    // A save stores the whole settings object main returns, so every field comes back new.
    useAppStore.setState((s) => ({
      settings: s.settings
        ? structuredClone({ ...s.settings, terminalInactivePaneOpacity: 0.5 })
        : s.settings
    }))
    await settle()

    expect(list).not.toHaveBeenCalled()
  })

  it('reads the accounts again when an account signs in again', async () => {
    const account = (updatedAt: number) => ({
      id: 'acct-a',
      email: 'a@example.test',
      managedAuthPath: '',
      authMethod: 'subscription-oauth' as const,
      createdAt: 1,
      updatedAt,
      lastAuthenticatedAt: updatedAt
    })
    seed({}, { claudeMoveIdleSessions: true })
    useAppStore.setState((s) => ({
      settings: s.settings ? { ...s.settings, claudeManagedAccounts: [account(1)] } : s.settings
    }))
    uninstall = installClaudeSessionMoveCoordinator()
    await settle()
    list.mockClear()

    useAppStore.setState((s) => ({
      settings: s.settings ? { ...s.settings, claudeManagedAccounts: [account(2)] } : s.settings
    }))
    await settle()

    expect(list).toHaveBeenCalledOnce()
  })

  it("reads the accounts again when only this machine's selection changes", async () => {
    seed({}, { claudeMoveIdleSessions: true })
    uninstall = installClaudeSessionMoveCoordinator()
    await settle()
    list.mockClear()

    useAppStore.setState((s) => ({
      settings: s.settings
        ? { ...s.settings, activeClaudeManagedAccountIdsByRuntime: { host: 'acct-a', wsl: {} } }
        : s.settings
    }))
    await settle()

    expect(list).toHaveBeenCalledOnce()
  })
})
