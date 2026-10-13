import { describe, expect, it } from 'vitest'
import type { AgentHookEventPayload } from '../shared/agent-hook-listener/listener-event'
import {
  retainClaudePermissionResults,
  type CachedPaneEnvelopeMeta
} from './agent-hook-cached-pane-status'

const result: AgentHookEventPayload = {
  paneKey: 'pane-1',
  worktreeId: 'worktree-1',
  tabId: 'tab-1',
  connectionId: null,
  source: 'claude',
  launchToken: 'launch-1',
  hostTurnRevision: 'turn-1',
  providerSession: { key: 'session_id', id: 'session-1', transcriptPath: '/host/session.jsonl' },
  agentPresence: {
    agent: 'claude',
    process: { pid: 4001, platform: 'darwin', startTime: 'birth-1' }
  },
  toolUseId: 'tool-1',
  claudePermissionResolved: true,
  hostEvidenceObservedAt: 100,
  payload: { state: 'working', agentType: 'claude', prompt: 'work' }
}
const saved: CachedPaneEnvelopeMeta = { source: 'claude', claudePermissionResults: [result] }

describe('retained Claude permission replay evidence', () => {
  it('retains the original request and observation age across later tool status', () => {
    const next = {
      ...result,
      toolUseId: 'tool-2',
      hookEventName: 'PreToolUse',
      claudePermissionResolved: undefined,
      hostEvidenceObservedAt: 200
    }
    const retained = retainClaudePermissionResults(saved, next)
    expect(retained).toEqual([result])
    expect(retained?.[0]?.hostEvidenceObservedAt).toBe(100)
  })

  it.each([
    { paneKey: 'pane-2' },
    { worktreeId: 'worktree-2' },
    { tabId: 'tab-2' },
    { connectionId: 'other-host' },
    { launchToken: 'launch-2' },
    { hostTurnRevision: 'turn-2' },
    { providerSession: { ...result.providerSession!, id: 'session-2' } },
    { providerSession: { ...result.providerSession!, transcriptPath: '/host/other.jsonl' } },
    {
      agentPresence: {
        agent: 'claude',
        process: { pid: 4001, platform: 'darwin', startTime: 'birth-2' }
      }
    },
    { agentPresence: { agent: 'claude', ended: true } },
    { source: 'codex' }
  ] satisfies Partial<AgentHookEventPayload>[])(
    'drops evidence across an ownership boundary: %j',
    (change) => {
      expect(
        retainClaudePermissionResults(saved, {
          ...result,
          claudePermissionResolved: undefined,
          ...change
        })
      ).toBeUndefined()
    }
  )

  it('replaces derived evidence for one request without growing the replay list', () => {
    const expired = {
      ...result,
      payload: { ...result.payload, claudeTaskWakeupPending: undefined }
    }
    expect(retainClaudePermissionResults(saved, expired)).toEqual([expired])
  })

  it('bounds a long-lived pane even when every request has a unique id', () => {
    let meta = saved
    for (let index = 2; index <= 40; index++) {
      meta = {
        source: 'claude',
        claudePermissionResults: retainClaudePermissionResults(meta, {
          ...result,
          toolUseId: `tool-${index}`
        })
      }
    }
    expect(meta.claudePermissionResults).toHaveLength(16)
    expect(meta.claudePermissionResults?.at(-1)?.toolUseId).toBe('tool-40')
  })
})
