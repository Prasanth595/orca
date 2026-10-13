import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import type { AgentStatusEntry } from '../../../../../shared/agent-status-types'
import type { RetainedAgentEntry } from '@/store/slices/agent-status'
import { retireSupersededHarnessStatus } from './superseded-harness-status'

const PANE_KEY = 'tab-1:leaf-1'
const initialAppState = useAppStore.getInitialState()

function doneStatus(agentType: AgentStatusEntry['agentType']): AgentStatusEntry {
  return {
    paneKey: PANE_KEY,
    state: 'done',
    prompt: '',
    updatedAt: 1,
    stateStartedAt: 1,
    agentType,
    stateHistory: []
  }
}

function retainedSnapshot(agentType: RetainedAgentEntry['agentType']): RetainedAgentEntry {
  return {
    entry: doneStatus(agentType),
    worktreeId: 'wt-1',
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the retire path only reads tab.launchAgent.
    tab: { launchAgent: undefined } as unknown as RetainedAgentEntry['tab'],
    agentType,
    startedAt: 1
  }
}

describe('retireSupersededHarnessStatus', () => {
  beforeEach(() => {
    useAppStore.setState(initialAppState, true)
    useAppStore.setState({ tabsByWorktree: {} })
  })

  it('drops a done row when a different-family occupant claims the pane (#24854)', () => {
    useAppStore.setState({
      agentStatusByPaneKey: { [PANE_KEY]: doneStatus('codex') },
      retainedAgentsByPaneKey: {}
    })
    retireSupersededHarnessStatus(PANE_KEY, 'omp')
    expect(useAppStore.getState().agentStatusByPaneKey[PANE_KEY]).toBeUndefined()
    expect(useAppStore.getState().retentionSuppressedPaneKeys[PANE_KEY]).toBe(true)
  })

  it('dismisses the retained snapshot for the same superseded pane', () => {
    useAppStore.setState({
      agentStatusByPaneKey: {},
      retainedAgentsByPaneKey: { [PANE_KEY]: retainedSnapshot('codex') }
    })
    retireSupersededHarnessStatus(PANE_KEY, 'omp')
    expect(useAppStore.getState().retainedAgentsByPaneKey[PANE_KEY]).toBeUndefined()
  })

  it('never drops a non-done live hook or a same-family snapshot', () => {
    const working = { ...doneStatus('codex'), state: 'working' as const }
    useAppStore.setState({
      agentStatusByPaneKey: { [PANE_KEY]: working },
      retainedAgentsByPaneKey: { 'tab-9:leaf-9': retainedSnapshot('omp') }
    })
    retireSupersededHarnessStatus(PANE_KEY, 'omp')
    expect(useAppStore.getState().agentStatusByPaneKey[PANE_KEY]).toBe(working)
    // Pi nested under OMP stays listed as its owner's finished turn.
    retireSupersededHarnessStatus('tab-9:leaf-9', 'pi')
    expect(useAppStore.getState().retainedAgentsByPaneKey['tab-9:leaf-9']).toBeDefined()
  })
})
