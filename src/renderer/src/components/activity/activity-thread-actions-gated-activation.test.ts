import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorktreeAgentActivationOutcome } from '@/lib/worktree-agent-activation-gate'
import { makeRepo, makeTab, makeWorktree } from './ActivityPrototypePage-test-fixtures'
import type { AgentPaneThread } from './activity-thread-types'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  activateWorkspace: vi.fn(),
  pendingGate: vi.fn(),
  activateStructured: vi.fn(),
  focusPane: vi.fn()
}))
vi.mock('@/store', () => ({ useAppStore: { getState: mocks.getState } }))
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorkspace: mocks.activateWorkspace
}))
vi.mock('@/lib/worktree-agent-activation-gate', () => ({
  getPendingWorktreeAgentActivation: mocks.pendingGate
}))
vi.mock('@/lib/structured-agent-session-tab-activation', () => ({
  activateStructuredAgentSessionTab: mocks.activateStructured
}))
vi.mock('@/lib/activate-tab-and-focus-pane', () => ({
  activateTabAndFocusPane: mocks.focusPane
}))

import { activateActivityThreadTarget } from './activity-thread-actions'

const hostId = 'ssh:devbox' as const
const thread: AgentPaneThread = {
  paneKey: 'tab-1:11111111-1111-4111-8111-111111111111',
  paneTitle: 'Sleeping request',
  worktree: { ...makeWorktree(), hostId },
  repo: makeRepo(),
  tab: makeTab(),
  agentType: 'codex',
  currentAgentState: 'waiting',
  currentAgentEntry: null,
  latestTimestamp: 1_000,
  latestEvent: null,
  events: [],
  unread: true,
  responsePreview: ''
}

function deferredGate() {
  let settle!: (outcome: WorktreeAgentActivationOutcome) => void
  const promise = new Promise<WorktreeAgentActivationOutcome>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

function stateForThread() {
  return {
    activeWorktreeId: thread.worktree.id,
    activeWorkspaceExecutionHostId: hostId,
    activeView: 'terminal',
    tabsByWorktree: { [thread.worktree.id]: [thread.tab] },
    getKnownWorktreeById: vi.fn<() => typeof thread.worktree | undefined>(() => thread.worktree),
    setActiveTabType: vi.fn()
  }
}

describe('activity target focus after gated activation', () => {
  let state: ReturnType<typeof stateForThread>
  let gate: ReturnType<typeof deferredGate>

  beforeEach(() => {
    vi.resetAllMocks()
    state = stateForThread()
    state.tabsByWorktree[thread.worktree.id] = []
    gate = deferredGate()
    mocks.getState.mockImplementation(() => state)
    mocks.activateWorkspace.mockReturnValue({ primaryTabId: null })
    mocks.pendingGate.mockReturnValue(gate.promise)
    mocks.activateStructured.mockReturnValue(false)
  })

  it('focuses the requested tab and leaf only after recovery creates the tab', async () => {
    activateActivityThreadTarget(thread)
    expect(mocks.focusPane).not.toHaveBeenCalled()
    expect(mocks.activateStructured).not.toHaveBeenCalled()
    state.tabsByWorktree[thread.worktree.id] = [thread.tab]
    gate.settle('resumed')
    await gate.promise
    expect(mocks.focusPane).toHaveBeenCalledExactlyOnceWith(
      thread.tab.id,
      '11111111-1111-4111-8111-111111111111',
      { flashFocusedPane: true, scrollToBottomIfOutputSinceLastView: true }
    )
  })

  it('activates a structured request after its inventory has hydrated', async () => {
    activateActivityThreadTarget(thread)
    expect(mocks.activateStructured).not.toHaveBeenCalled()
    mocks.activateStructured.mockReturnValue(true)
    gate.settle('structured')
    await gate.promise
    expect(mocks.activateStructured).toHaveBeenCalledExactlyOnceWith({
      worktreeId: thread.worktree.id,
      tabId: thread.tab.id
    })
    expect(mocks.focusPane).not.toHaveBeenCalled()
  })

  it.each(['workspace', 'host', 'view', 'deleted'])(
    'does not steal focus when the target becomes stale through %s',
    async (change) => {
      activateActivityThreadTarget(thread)
      state.tabsByWorktree[thread.worktree.id] = [thread.tab]
      if (change === 'workspace') {
        state.activeWorktreeId = 'other-workspace'
      }
      if (change === 'host') {
        Object.assign(state, { activeWorkspaceExecutionHostId: 'local' })
      }
      if (change === 'view') {
        state.activeView = 'settings'
      }
      if (change === 'deleted') {
        state.getKnownWorktreeById.mockReturnValue(undefined)
      }
      gate.settle('resumed')
      await gate.promise
      expect(mocks.focusPane).not.toHaveBeenCalled()
      expect(mocks.activateStructured).not.toHaveBeenCalled()
    }
  )

  it('does not fall back to a sibling tab when the requested tab stays absent', async () => {
    activateActivityThreadTarget(thread)
    state.tabsByWorktree[thread.worktree.id] = [{ ...thread.tab, id: 'sibling' }]
    gate.settle('empty')
    await gate.promise
    expect(mocks.focusPane).not.toHaveBeenCalled()
  })

  it('does not focus through a blocked recovery gate', async () => {
    activateActivityThreadTarget(thread)
    state.tabsByWorktree[thread.worktree.id] = [thread.tab]
    gate.settle('blocked')
    await gate.promise
    expect(mocks.focusPane).not.toHaveBeenCalled()
    expect(mocks.activateStructured).not.toHaveBeenCalled()
  })

  it('lets a newer target selection supersede an earlier one in the same workspace', async () => {
    const newer = {
      ...thread,
      tab: { ...thread.tab, id: 'tab-2' },
      paneKey: 'tab-2:22222222-2222-4222-8222-222222222222'
    }
    activateActivityThreadTarget(thread)
    activateActivityThreadTarget(newer)
    state.tabsByWorktree[thread.worktree.id] = [thread.tab, newer.tab]
    gate.settle('resumed')
    await gate.promise
    expect(mocks.focusPane).toHaveBeenCalledExactlyOnceWith(
      newer.tab.id,
      '22222222-2222-4222-8222-222222222222',
      { flashFocusedPane: true, scrollToBottomIfOutputSinceLastView: true }
    )
  })
})
