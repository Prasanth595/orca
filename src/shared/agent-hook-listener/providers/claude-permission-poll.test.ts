import { describe, expect, it, vi } from 'vitest'
import type { AgentHookEventPayload } from '../listener-event'
import {
  clearPaneCacheState,
  createHookListenerState,
  seedLegacyAgentStatusForTests
} from '../listener-state'
import {
  canPollClaudePermission,
  isMatchingClaudePermissionResult,
  pollClaudePermissionResult
} from './claude-permission-poll'

vi.mock('../claude-permission-result', () => ({ readClaudePermissionResult: () => true }))
vi.mock('../../agent-process-presence-probe', () => ({
  probeAgentProcessPresence: async () => 'live'
}))

const pending: AgentHookEventPayload = {
  paneKey: 'pane',
  source: 'claude',
  connectionId: null,
  launchToken: 'launch',
  hostTurnRevision: 'turn',
  hookEventName: 'PermissionRequest',
  toolUseId: 'tool',
  agentPresence: {
    agent: 'claude',
    process: { pid: 4001, platform: 'darwin', startTime: 'birth-1' }
  },
  providerSession: { key: 'session_id', id: 'session', transcriptPath: '/host/session.jsonl' },
  payload: { state: 'waiting', agentType: 'claude', prompt: '', toolName: 'Bash' }
}
const settled: AgentHookEventPayload = {
  ...pending,
  hookEventName: undefined,
  claudePermissionResolved: true,
  payload: { state: 'working', agentType: 'claude', prompt: '' }
}

describe('Claude permission result ownership', () => {
  it('keeps a rejected result waiting and eligible for a later accepted retry', async () => {
    const state = createHookListenerState()
    seedLegacyAgentStatusForTests(state, pending)
    const lead = {
      state: 'waiting' as const,
      stateStartedAt: 1,
      stateBeforeWait: { state: 'done' as const, stateStartedAt: 0 }
    }
    const tool = { lastAssistantMessage: 'previous message' }
    state.claudeLeadStateByPaneKey.set('pane', lead)
    state.lastToolByPaneKey.set('pane', tool)
    state.claudeLaunchedBackgroundTasksByPaneKey.set(
      'pane',
      new Map([['shell', { kind: 'shell', notificationOwedAt: 1 }]])
    )
    await pollClaudePermissionResult(state, pending, () => undefined)
    expect(state.claudeLeadStateByPaneKey.get('pane')).toBe(lead)
    expect(state.lastToolByPaneKey.get('pane')).toBe(tool)
    expect(state.claudeLaunchedBackgroundTasksByPaneKey.get('pane')?.has('shell')).toBe(true)
    expect(state.lastStatusByPaneKey.get('pane')).toBe(pending)
    const accepted = await pollClaudePermissionResult(state, pending, (event) => {
      seedLegacyAgentStatusForTests(state, event)
      return event
    })
    expect(accepted?.claudePermissionResolved).toBe(true)
    expect(state.claudeLeadStateByPaneKey.get('pane')?.state).toBe('done')
    expect(state.claudeLaunchedBackgroundTasksByPaneKey.get('pane')?.has('shell')).toBe(false)
  })

  it('accepts the exact live request without a turn verdict', () => {
    expect(canPollClaudePermission(pending)).toBe(true)
    expect(isMatchingClaudePermissionResult(pending, settled)).toBe(true)
    expect(isMatchingClaudePermissionResult(pending, { ...settled, isReplay: true })).toBe(true)
  })

  it.each([false, true])(
    'rolls back an apply error only before acceptance: accepted=%s',
    async (accepted) => {
      const state = createHookListenerState()
      seedLegacyAgentStatusForTests(state, pending)
      const lead = {
        state: 'waiting' as const,
        stateStartedAt: 1,
        stateBeforeWait: { state: 'done' as const, stateStartedAt: 0 }
      }
      state.claudeLeadStateByPaneKey.set('pane', lead)
      await expect(
        pollClaudePermissionResult(state, pending, (event) => {
          if (accepted) {
            seedLegacyAgentStatusForTests(state, event)
          }
          throw new Error('apply or forwarding failed')
        })
      ).rejects.toThrow('apply or forwarding failed')
      expect(state.claudeLeadStateByPaneKey.get('pane')?.state).toBe(accepted ? 'done' : 'waiting')
      expect(state.lastStatusByPaneKey.get('pane')?.claudePermissionResolved).toBe(
        accepted ? true : undefined
      )
    }
  )

  it('does not resurrect a pane retired during admission', async () => {
    const state = createHookListenerState()
    seedLegacyAgentStatusForTests(state, pending)
    state.claudeLeadStateByPaneKey.set('pane', { state: 'waiting', stateStartedAt: 1 })
    const result = await pollClaudePermissionResult(state, pending, () => {
      clearPaneCacheState(state, 'pane')
      return undefined
    })
    expect(result).toBeUndefined()
    expect(state.lastStatusByPaneKey.has('pane')).toBe(false)
    expect(state.claudeLeadStateByPaneKey.has('pane')).toBe(false)
    expect(state.lastToolByPaneKey.has('pane')).toBe(false)
  })

  it.each([
    { paneKey: 'other' },
    { launchToken: 'replacement' },
    { hostTurnRevision: 'new-turn' },
    { connectionId: 'other-host' },
    { toolUseId: 'new-tool' },
    { toolAgentId: 'child' },
    { toolAgentType: 'worker' },
    { source: 'codex' as const },
    {
      agentPresence: {
        agent: 'claude',
        process: { pid: 4001, platform: 'darwin' as const, startTime: 'birth-2' }
      }
    },
    { agentPresence: undefined },
    {
      providerSession: {
        key: 'session_id' as const,
        id: 'replacement',
        transcriptPath: '/host/session.jsonl'
      }
    },
    {
      providerSession: {
        key: 'session_id' as const,
        id: 'session',
        transcriptPath: '/other/session.jsonl'
      }
    }
  ])('rejects a delayed or foreign observation: %j', (change) => {
    expect(isMatchingClaudePermissionResult(pending, { ...settled, ...change })).toBe(false)
  })

  it('does not read transcripts from a client, replay, or unknown process', () => {
    expect(canPollClaudePermission({ ...pending, connectionId: 'ssh-host' })).toBe(false)
    expect(canPollClaudePermission({ ...pending, isReplay: true })).toBe(false)
    expect(canPollClaudePermission({ ...pending, restoredUnconfirmed: true })).toBe(false)
    expect(canPollClaudePermission({ ...pending, launchToken: undefined })).toBe(false)
    expect(canPollClaudePermission({ ...pending, toolUseId: undefined })).toBe(false)
    expect(canPollClaudePermission({ ...pending, agentPresence: undefined })).toBe(false)
  })

  it('cannot overwrite a newer working or completed turn', () => {
    for (const state of ['working', 'done'] as const) {
      expect(
        isMatchingClaudePermissionResult(
          { ...pending, payload: { ...pending.payload, state } },
          settled
        )
      ).toBe(false)
    }
  })
})
