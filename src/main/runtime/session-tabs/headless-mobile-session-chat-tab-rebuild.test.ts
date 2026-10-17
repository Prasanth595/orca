// A host with no window rebuilds a phone's tab list from its saved layout. Chat tabs live in the
// chat system's list, so a rebuild must carry them over or the phone loses a running chat.

import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../shared/constants'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import { OrcaRuntimeService } from '../orca-runtime'

const WORKTREE_ID = 'repo-1::/repos/wt'
const repos = [
  { id: 'repo-1', path: '/repos', displayName: 'repo-1', badgeColor: 'blue', addedAt: 1 }
]

function openFile(name: string) {
  return {
    filePath: `/repos/wt/${name}`,
    relativePath: name,
    worktreeId: WORKTREE_ID,
    language: 'markdown'
  }
}

function windowlessRuntime() {
  let session: WorkspaceSessionState = {
    activeRepoId: 'repo-1',
    activeWorktreeId: WORKTREE_ID,
    activeTabId: null,
    tabsByWorktree: {},
    terminalLayoutsByTabId: {},
    openFilesByWorktree: { [WORKTREE_ID]: [openFile('a.md'), openFile('b.md')] }
  }
  const runtime = new OrcaRuntimeService({
    getRepo: (id: string) => repos.find((repo) => repo.id === id),
    getRepos: () => repos,
    getAllWorktreeMeta: () => ({}),
    getWorktreeMeta: () => undefined,
    addRepo: () => {},
    updateRepo: () => {
      throw new Error('unused')
    },
    setWorktreeMeta: () => {
      throw new Error('unused')
    },
    removeWorktreeMeta: () => {},
    getGitHubCache: () => ({ pr: {}, issue: {} }),
    getRetiredWorktreeNameRegistry: () => ({ exhaustedTiers: 0, names: [] }),
    addRetiredWorktreeName: () => {},
    mergeRetiredWorktreeNames: () => false,
    getSettings: () => getDefaultSettings('/tmp/home'),
    getWorkspaceSession: () => session,
    setWorkspaceSession: (next: WorkspaceSessionState) => {
      session = next
    }
  })
  runtime.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(WORKTREE_ID, { force: true })
  runtime.projectStructuredAgentSessionTab({
    workspaceId: WORKTREE_ID,
    sessionId: 'chat-1',
    agent: 'claude',
    activate: false
  })
  return runtime
}

function tabIds(runtime: OrcaRuntimeService): string[] {
  return runtime.mobileSessionTabsByWorktree.get(WORKTREE_ID)?.tabs.map((tab) => tab.id) ?? []
}

function groupedTabIds(runtime: OrcaRuntimeService): string[] {
  const snapshot = runtime.mobileSessionTabsByWorktree.get(WORKTREE_ID)
  return (snapshot?.tabGroups ?? []).flatMap((group) => group.tabOrder)
}

describe('headless phone chat tabs across a layout rebuild', () => {
  it('keeps a running chat tab when the layout is rebuilt', () => {
    const runtime = windowlessRuntime()
    expect(tabIds(runtime)).toContain('agent-session:chat-1')

    runtime.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(WORKTREE_ID, { force: true })

    expect(tabIds(runtime)).toContain('agent-session:chat-1')
    expect(groupedTabIds(runtime)).toContain('agent-session:chat-1')
  })

  it('keeps a running chat tab when the phone closes an editor tab', async () => {
    const runtime = windowlessRuntime()
    const editorTab = runtime.mobileSessionTabsByWorktree
      .get(WORKTREE_ID)!
      .tabs.find((tab) => tab.type !== 'agent-session')!

    await runtime.closeMobileSessionTab(`id:${WORKTREE_ID}`, editorTab.id)

    expect(tabIds(runtime)).not.toContain(editorTab.id)
    expect(tabIds(runtime)).toContain('agent-session:chat-1')
    expect(groupedTabIds(runtime)).toContain('agent-session:chat-1')
  })
})
