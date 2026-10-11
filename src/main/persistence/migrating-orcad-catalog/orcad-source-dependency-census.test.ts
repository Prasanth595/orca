import { describe, expect, it } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/constants'
import type { SleepingAgentSessionRecord } from '../../../shared/agent-session-resume'
import {
  CLIENT_HOSTED_BROWSER_PAGE_RECORD_VERSION,
  type PersistedClientHostedBrowserPage
} from '../../../shared/client-hosted-browser-page-record'
import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../shared/terminal-tab-types'
import {
  ORCAD_MIGRATION_MANIFEST_VERSION,
  type OrcadMigrationManifest
} from '../../../shared/orcad-migration-manifest'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { Repo } from '../../../shared/repo-types'
import type { SshTarget } from '../../../shared/ssh-types'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import { worktreeWorkspaceKey } from '../../../shared/workspace-scope'
import { collectOrcadMigrationUntransferredDependencyCensus } from './orcad-source-dependency-census'

const TARGET: SshTarget = {
  id: 'ssh-prod',
  label: 'Production',
  host: 'prod.example.com',
  port: 22,
  username: 'deploy',
  generation: 8
}

const REPO: Repo = {
  id: 'repo-1',
  path: '/srv/repo',
  displayName: 'Repository',
  badgeColor: '#737373',
  addedAt: 1,
  connectionId: TARGET.id,
  executionHostId: `ssh:${TARGET.id}`,
  projectGroupId: 'group-1'
}

const FOLDER: FolderWorkspace = {
  id: 'folder-1',
  projectGroupId: 'group-1',
  name: 'Folder',
  folderPath: '/srv/folder',
  connectionId: TARGET.id,
  linkedTask: null,
  comment: '',
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 1,
  createdAt: 1,
  updatedAt: 1
}

const MANIFEST: OrcadMigrationManifest = {
  version: ORCAD_MIGRATION_MANIFEST_VERSION,
  migrationId: 'migration-1',
  createdAt: '2026-08-30T12:00:00.000Z',
  source: {
    sshTargetId: TARGET.id,
    sshTargetGeneration: TARGET.generation ?? null,
    targetLabel: TARGET.label
  },
  payload: {
    repositories: [REPO],
    projectGroups: [],
    folderWorkspaces: [FOLDER]
  },
  manifestSha256: 'a'.repeat(64)
}

describe('orcad migration source dependency census', () => {
  it('ignores client focus on another host copied into the source host partition', () => {
    const state = getDefaultPersistedState('/home/test')
    state.sshTargets = [TARGET]
    state.repos = [REPO]
    state.folderWorkspaces = [FOLDER]
    const localWorktreeId = 'local-repo::/home/test/local'
    state.workspaceSession = { ...state.workspaceSession, activeWorktreeId: localWorktreeId }
    state.workspaceSessionsByHostId = {
      [`ssh:${TARGET.id}`]: {
        ...state.workspaceSession,
        activeWorktreeId: localWorktreeId,
        activeWorkspaceKey: worktreeWorkspaceKey(localWorktreeId)
      }
    }

    expect(collectOrcadMigrationUntransferredDependencyCensus(state, MANIFEST)).toMatchObject({
      totalCount: 0
    })
  })

  it('allows a static catalog with no unrepresented dependent state', () => {
    const state = getDefaultPersistedState('/home/test')
    state.sshTargets = [TARGET]
    state.repos = [REPO]
    state.folderWorkspaces = [FOLDER]

    expect(collectOrcadMigrationUntransferredDependencyCensus(state, MANIFEST)).toMatchObject({
      totalCount: 0
    })
  })

  it('keeps another SSH target and its host partition outside the source fence', () => {
    const state = getDefaultPersistedState('/home/test')
    state.sshTargets = [TARGET, { ...TARGET, id: 'ssh-other', generation: 9 }]
    state.workspaceSessionsByHostId = {
      'ssh:ssh-other': {
        ...state.workspaceSession,
        tabsByWorktree: {
          'other-repo::/srv/worktree': [
            {
              id: 'tab-other',
              ptyId: 'pty-other',
              worktreeId: 'other-repo::/srv/worktree',
              title: 'Other',
              customTitle: null,
              color: null,
              sortOrder: 0,
              createdAt: 1
            }
          ]
        }
      }
    }

    expect(collectOrcadMigrationUntransferredDependencyCensus(state, MANIFEST).totalCount).toBe(0)
  })

  it('counts a lease that is not terminated as live terminal work', () => {
    const state = getDefaultPersistedState('/home/test')
    state.sshTargets = [TARGET]
    state.repos = [REPO]
    state.sshRemotePtyLeases = [
      { targetId: TARGET.id, ptyId: 'pty-1', state: 'detached', createdAt: 1, updatedAt: 1 },
      { targetId: TARGET.id, ptyId: 'pty-2', state: 'terminated', createdAt: 1, updatedAt: 2 }
    ]

    expect(collectOrcadMigrationUntransferredDependencyCensus(state, MANIFEST)).toMatchObject({
      totalCount: 1,
      counts: { 'terminal-lease': 1 }
    })
  })
})

const WORKTREE = `${REPO.id}::/srv/repo`

function sleepingAgentRecord(
  overrides: Partial<SleepingAgentSessionRecord> = {}
): SleepingAgentSessionRecord {
  return {
    paneKey: 'gone-tab:gone-leaf',
    tabId: 'gone-tab',
    worktreeId: WORKTREE,
    agent: 'claude',
    providerSession: { key: 'session_id', id: 'session-1' },
    prompt: 'continue',
    state: 'waiting',
    capturedAt: 1,
    updatedAt: 1,
    origin: 'quit',
    ...overrides
  }
}

function hostPartitionState(session: Partial<WorkspaceSessionState>): PersistedState {
  const state = getDefaultPersistedState('/home/test')
  state.sshTargets = [TARGET]
  state.repos = [REPO]
  state.workspaceSessionsByHostId = {
    [`ssh:${TARGET.id}`]: { ...state.workspaceSession, ...session }
  }
  return state
}

function terminalTab(id: string): TerminalTab {
  return {
    id,
    ptyId: null,
    worktreeId: WORKTREE,
    title: 'Shell',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

function terminalLayout(leafId: string): TerminalLayoutSnapshot {
  return { root: { type: 'leaf', leafId }, activeLeafId: leafId, expandedLeafId: null }
}

function clientHostedPage(workspaceId: string): PersistedClientHostedBrowserPage {
  return {
    v: CLIENT_HOSTED_BROWSER_PAGE_RECORD_VERSION,
    browserPageId: 'page-1',
    workspaceId,
    browserProfileId: 'profile-1',
    url: 'https://example.test/',
    title: 'Example',
    pairedDeviceId: 'device-1',
    savedAt: 1
  }
}

describe('orphaned saved-session residue no visible tab owns', () => {
  it('does not block the move on a quit record whose pane left the terminal layout', () => {
    const state = hostPartitionState({
      sleepingAgentSessionsByPaneKey: { 'gone-tab:gone-leaf': sleepingAgentRecord() }
    })

    expect(collectOrcadMigrationUntransferredDependencyCensus(state, MANIFEST)).toMatchObject({
      counts: { 'workspace-session': 0 }
    })
  })

  it('does not block the move on a live record whose pane left the terminal layout', () => {
    const state = hostPartitionState({
      sleepingAgentSessionsByPaneKey: {
        'gone-tab:gone-leaf': sleepingAgentRecord({ origin: 'live' })
      }
    })

    expect(collectOrcadMigrationUntransferredDependencyCensus(state, MANIFEST)).toMatchObject({
      counts: { 'workspace-session': 0 }
    })
  })

  it('does not block the move on an orphaned quit record copied into the local partition', () => {
    const state = getDefaultPersistedState('/home/test')
    state.sshTargets = [TARGET]
    state.repos = [REPO]
    state.workspaceSession = {
      ...state.workspaceSession,
      sleepingAgentSessionsByPaneKey: {
        'gone-tab:gone-leaf': sleepingAgentRecord({
          worktreeId: `ssh:${TARGET.id}|${WORKTREE}`
        })
      }
    }

    expect(collectOrcadMigrationUntransferredDependencyCensus(state, MANIFEST)).toMatchObject({
      counts: { 'workspace-session': 0 }
    })
  })

  it('does not block the move on client-hosted pages whose browser workspace is gone', () => {
    const state = hostPartitionState({
      clientHostedBrowserPagesByWorktree: { [WORKTREE]: [clientHostedPage('gone-browser-workspace')] }
    })

    expect(collectOrcadMigrationUntransferredDependencyCensus(state, MANIFEST)).toMatchObject({
      counts: { 'workspace-session': 0 }
    })
  })

  it('still counts a pane-owned quit record the destination could never carry', () => {
    const record = sleepingAgentRecord({ paneKey: 'tab-1:leaf-1', tabId: 'tab-1' })
    // A legacy resume fence rides on records the schema no longer models; raw profile rows keep it.
    ;(record as Record<string, unknown>).automaticResumeBlockedBy = 'legacy-orchestration-worker'
    const state = hostPartitionState({
      sleepingAgentSessionsByPaneKey: { 'tab-1:leaf-1': record },
      tabsByWorktree: { [WORKTREE]: [terminalTab('tab-1')] },
      terminalLayoutsByTabId: { 'tab-1': terminalLayout('leaf-1') }
    })

    expect(collectOrcadMigrationUntransferredDependencyCensus(state, MANIFEST)).toMatchObject({
      counts: { 'workspace-session': 1 }
    })
  })

  it('does not count a pane-owned quit record that transfers whole', () => {
    const state = hostPartitionState({
      sleepingAgentSessionsByPaneKey: {
        'tab-1:leaf-1': sleepingAgentRecord({ paneKey: 'tab-1:leaf-1', tabId: 'tab-1' })
      },
      tabsByWorktree: { [WORKTREE]: [terminalTab('tab-1')] },
      terminalLayoutsByTabId: { 'tab-1': terminalLayout('leaf-1') }
    })

    expect(collectOrcadMigrationUntransferredDependencyCensus(state, MANIFEST)).toMatchObject({
      counts: { 'workspace-session': 0 }
    })
  })
})
