import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentHookServer } from '../agent-hooks/server'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { AgentRunAccountSettings } from '../agent-accounts/agent-run-accounts'
import type { CodexManagedAccount } from '../../shared/managed-account-types'
import {
  _internals as registryInternals,
  recordCodexPaneAccount
} from '../codex/codex-pane-account-registry'
import { paneKeyPtyId, ptyPaneKey, rememberPaneKeyForPty } from '../ipc/pty/pane/key-state'
import {
  getAgentRunAccounts,
  installAgentRunAccounts
} from '../agent-accounts/agent-run-accounts-installed'
import { startAgentRunAccounts } from './main-process-agent-run-accounts'

const PANE = 'tab-1:11111111-1111-4111-8111-111111111111'

let userDataPath: string
let previousUserDataPath: string | undefined

function codexAccount(id: string): CodexManagedAccount {
  return {
    id,
    email: `${id}@example.com`,
    managedHomePath: `/data/codex-accounts/${id}/home`,
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1
  }
}

beforeEach(() => {
  previousUserDataPath = process.env.ORCA_USER_DATA_PATH
  userDataPath = mkdtempSync(join(tmpdir(), 'orca-run-accounts-'))
  process.env.ORCA_USER_DATA_PATH = userDataPath
  registryInternals.resetCache()
})

afterEach(() => {
  installAgentRunAccounts(undefined)
  ptyPaneKey.clear()
  paneKeyPtyId.clear()
  rmSync(userDataPath, { recursive: true, force: true })
  if (previousUserDataPath === undefined) {
    delete process.env.ORCA_USER_DATA_PATH
  } else {
    process.env.ORCA_USER_DATA_PATH = previousUserDataPath
  }
  registryInternals.resetCache()
})

describe('startAgentRunAccounts', () => {
  it('publishes a terminal agent account onto its status row and reacts to account changes', () => {
    const server = new AgentHookServer()
    let settings: AgentRunAccountSettings = {
      codexManagedAccounts: [codexAccount('acc-a')],
      claudeManagedAccounts: [],
      activeClaudeManagedAccountId: null,
      activeClaudeManagedAccountIdsByRuntime: undefined
    }
    const settingsListeners: ((updates: Partial<GlobalSettings>) => void)[] = []
    startAgentRunAccounts({
      server,
      getSettings: () => settings,
      onSettingsChanged: (listener) => settingsListeners.push(listener),
      claudeRouter: null
    })
    expect(getAgentRunAccounts()).toBeDefined()
    rememberPaneKeyForPty('pty-1', PANE)
    recordCodexPaneAccount('pty-1', {
      selectionKey: 'host',
      accountId: 'acc-a',
      homeRoute: 'account-home'
    })

    server.ingestTerminalStatus({
      paneKey: PANE,
      tabId: 'tab-1',
      worktreeId: 'wt',
      connectionId: null,
      payload: { state: 'working', prompt: 'go', agentType: 'codex' }
    })
    expect(server.getRunAccountRow(PANE)?.runAccount).toEqual({
      provider: 'codex',
      lane: 'host',
      accountId: 'acc-a',
      mode: 'follow'
    })

    settings = { ...settings, codexManagedAccounts: [] }
    for (const listener of settingsListeners) {
      listener({ codexManagedAccounts: [] })
    }
    expect(server.getRunAccountRow(PANE)?.runAccount).toBeUndefined()
  })
})
