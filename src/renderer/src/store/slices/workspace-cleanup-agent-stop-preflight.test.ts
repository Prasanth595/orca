import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { getWorkspaceCleanupHostIdentity as identity } from '../../../../shared/workspace-cleanup-host-identity'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { makeTab } from './store-test-helpers'
import { makeAgentEntry } from '@/components/worktree-jump-palette-test-fixtures'
import { enrichWorkspaceCleanupCandidates } from './workspace-cleanup-candidate-enrichment'
import { getWorkspaceCleanupAgentEvidence } from './workspace-cleanup-agent-evidence'
import { WORKTREE_ID, makeCandidate, makeState } from './workspace-cleanup-slice-test-harness'

const OTHER_ID = 'repo1::/tmp/other'

function paneKey(tabId: string): string {
  return makePaneKey(tabId, '11111111-1111-4111-8111-111111111111')
}

function agentStatus(paneKey: string, state: AgentStatusEntry['state']): AgentStatusEntry {
  return makeAgentEntry('unused', state, Date.now(), { paneKey, connectionId: null })
}

// A structured chat publishes status under its own surface id; its tab is not in tabsByWorktree.
function structuredChatStatus(state: AgentStatusEntry['state']): AgentStatusEntry {
  return { ...agentStatus(paneKey('chat-1'), state), worktreeId: WORKTREE_ID }
}

describe('workspace cleanup live-agent finder', () => {
  it.each(['working', 'done'] as const)('qualifies %s evidence with done precedence', (status) => {
    const leaf = '11111111-1111-4111-8111-111111111111'
    const entry = agentStatus(paneKey('tab-1'), status)
    const live = status === 'working'
    const tab = makeTab({ id: 'tab-1', worktreeId: WORKTREE_ID, title: '⠋ Codex' })
    const appState = makeState({
      tabsByWorktree: { [WORKTREE_ID]: [tab] },
      ptyIdsByTabId: { 'tab-1': ['pty-1'] },
      terminalLayoutsByTabId: { 'tab-1': { root: null, activeLeafId: leaf, expandedLeafId: null } },
      agentStatusByPaneKey: { [entry.paneKey]: entry }
    })
    const candidates = [
      makeCandidate(),
      makeCandidate({ executionHostId: 'ssh:other' }),
      makeCandidate({ executionHostId: 'runtime:host' })
    ]
    const evidence = () => getWorkspaceCleanupAgentEvidence(appState, candidates)
    expect([...evidence().keys()]).toEqual(live ? [identity('local', WORKTREE_ID)] : [])
    appState.ptyIdsByTabId = { 'tab-1': ['remote:host@@pty'] }
    expect([...evidence().keys()]).toEqual(live ? [identity('runtime:host', WORKTREE_ID)] : [])
    appState.agentStatusByPaneKey = { [entry.paneKey]: { ...entry, connectionId: undefined } }
    appState.ptyIdsByTabId = { 'tab-1': ['pty-1'] }
    expect([...evidence().values()]).toEqual(live ? ['unknown', 'unknown', 'unknown'] : [])
  })

  it('finds only workspaces whose agent is working right now', () => {
    const state = makeState({
      tabsByWorktree: {
        [WORKTREE_ID]: [makeTab({ id: 'tab-1', worktreeId: WORKTREE_ID })],
        [OTHER_ID]: [makeTab({ id: 'tab-2', worktreeId: OTHER_ID })]
      },
      agentStatusByPaneKey: {
        [paneKey('tab-1')]: agentStatus(paneKey('tab-1'), 'working'),
        [paneKey('tab-2')]: agentStatus(paneKey('tab-2'), 'done')
      }
    })

    expect([
      ...getWorkspaceCleanupAgentEvidence(state, [
        makeCandidate(),
        makeCandidate({ worktreeId: OTHER_ID })
      ]).values()
    ]).toEqual(['live'])
  })

  it.each([
    ['working', true],
    ['done', false]
  ] as const)('counts a %s structured chat with no terminal tab: %s', async (state, live) => {
    const appState = makeState({
      agentStatusByPaneKey: { [paneKey('chat-1')]: structuredChatStatus(state) }
    })

    expect(getWorkspaceCleanupAgentEvidence(appState, [makeCandidate()]).size > 0).toBe(live)
    const [enriched] = await enrichWorkspaceCleanupCandidates([makeCandidate()], appState)
    expect(enriched.blockers.includes('live-agent')).toBe(live)
  })
})
