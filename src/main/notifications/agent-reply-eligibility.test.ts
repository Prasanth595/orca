import type {
  AgentJournalCursor,
  AgentJournalSnapshot
} from '../../shared/agent-session-journal-types'
import { replySnapshotFixture } from './structured-reply-origin.test-fixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalRunFactsRegister } from '../runtime/terminal-run-facts'
import { getDefaultNotificationSettings } from '../../shared/notification-settings-defaults'
import type { EnrichedAgentHookEventPayload } from '../agent-hooks/server/server-types'
import { createAgentReplyEligibility } from './agent-reply-eligibility'

const callbacks = vi.hoisted(() => {
  const listeners: {
    status?: (event: EnrichedAgentHookEventPayload) => void
    clear?: (event: { paneKey: string }) => void
  } = {}
  const chat: {
    enabled: boolean
    snapshot: AgentJournalSnapshot | null
    floors: Map<string, AgentJournalCursor>
  } = { enabled: false, snapshot: null, floors: new Map() }
  const chatHost = { replyJournal: { cursors: () => chat.floors, snapshot: () => chat.snapshot } }
  return {
    listeners,
    chat,
    chatHost,
    read: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true))
  }
})
vi.mock('../agent-hooks/server', () => ({
  agentHookServer: {
    subscribeEnrichedStatus: (listener: NonNullable<typeof callbacks.listeners.status>) => {
      callbacks.listeners.status = listener
      return () => {
        delete callbacks.listeners.status
      }
    },
    subscribePaneStatusClear: (listener: NonNullable<typeof callbacks.listeners.clear>) => {
      callbacks.listeners.clear = listener
      return () => {
        delete callbacks.listeners.clear
      }
    }
  }
}))
vi.mock('../native-chat/agent-session-wire/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: () => (callbacks.chat.enabled ? callbacks.chatHost : null)
}))
vi.mock('./claude-reply-origin', () => ({ isClaudeHumanReply: callbacks.read }))
const disposals: (() => void)[] = []
afterEach(() => {
  disposals.splice(0).forEach((dispose) => dispose())
  callbacks.read.mockClear()
  callbacks.chat.enabled = false
  callbacks.chat.snapshot = null
  callbacks.chat.floors = new Map()
})

function rig(source: 'claude' | 'codex' = 'codex', enabled = true) {
  const facts = new TerminalRunFactsRegister()
  const settings = { ...getDefaultNotificationSettings(), bringToFrontOnAgentTaskComplete: enabled }
  let settingsChanged: () => void = () => undefined
  const store = {
    getSettings: () => ({ notifications: settings }),
    onSettingsChanged: (listener: () => void) => {
      settingsChanged = listener
      return () => undefined
    }
  }
  const policy = createAgentReplyEligibility(
    store,
    {
      terminalRunFacts: facts,
      resolveTerminalPane: () => ({
        handle: 'handle',
        tabId: 'tab',
        leafId: 'leaf',
        ptyId: 'pty',
        connected: true,
        executionHostId: 'local'
      })
    },
    'darwin'
  )
  disposals.push(policy.dispose)
  const hook = (hookEventName: string, promptId = 'turn-A') =>
    callbacks.listeners.status?.({
      paneKey: 'pane',
      connectionId: null,
      source,
      hookEventName,
      providerPromptId: promptId,
      providerSession: {
        key: 'session_id',
        id: 'session',
        transcriptPath: '/invented/transcript.jsonl'
      },
      payload: { state: hookEventName === 'Stop' ? 'done' : 'working', prompt: 'invented' },
      receivedAt: 1,
      stateStartedAt: 1
    })
  const input = (origin: 'human' | 'programmatic') =>
    facts.recordInput('pty', 'driving', '\r', undefined, origin)
  const request = {
    source: 'agent-task-complete' as const,
    paneKey: 'pane',
    agentReplyIdentity: { sessionId: 'session', promptId: 'turn-A' }
  }
  return { facts, policy, hook, input, request, settings, settingsChanged: () => settingsChanged() }
}

describe('host reply eligibility and asynchronous invalidation', () => {
  it('Codex completion never reads a transcript, and matches the exact submitted turn', async () => {
    const r = rig()
    r.input('human')
    r.hook('UserPromptSubmit')
    r.hook('Stop')
    expect(await r.policy.canBring(r.request)).toBe(true)
    expect(r.policy.stillEligible(r.request)).toBe(true)
    expect(
      await r.policy.canBring({
        ...r.request,
        agentReplyIdentity: { sessionId: 'session', promptId: 'old' }
      })
    ).toBe(false)
    expect(callbacks.read).not.toHaveBeenCalled()
    r.hook('UserPromptSubmit', 'turn-B')
    expect(r.policy.stillEligible(r.request)).toBe(false)
  })
  it('Claude reads only after a human submission and rejects a new turn during that read', async () => {
    const r = rig('claude')
    r.input('programmatic')
    r.hook('UserPromptSubmit')
    r.hook('Stop')
    expect(await r.policy.canBring(r.request)).toBe(false)
    expect(callbacks.read).not.toHaveBeenCalled()
    r.input('human')
    r.hook('UserPromptSubmit')
    r.hook('Stop')
    const waiting = Promise.withResolvers<boolean>()
    callbacks.read.mockReturnValueOnce(waiting.promise)
    const verdict = r.policy.canBring(r.request)
    r.hook('UserPromptSubmit', 'turn-B')
    waiting.resolve(true)
    expect(await verdict).toBe(false)
    expect(r.policy.stillEligible(r.request)).toBe(false)
  })
  it('A5: a human queued hook on a wake turn still requires Claude human transcript origin', async () => {
    const r = rig('claude')
    r.input('programmatic')
    r.hook('UserPromptSubmit')
    r.input('human')
    r.hook('UserPromptSubmit')
    r.hook('Stop')
    callbacks.read.mockResolvedValueOnce(false) // The exact prompt has origin.kind task-notification.
    expect(await r.policy.canBring(r.request)).toBe(false)
    expect(callbacks.read).toHaveBeenCalledOnce()
  })

  it('S12: off-to-on starts an empty submission epoch; no transcript read while off', async () => {
    const r = rig('claude', false)
    r.input('human')
    r.hook('UserPromptSubmit')
    r.hook('Stop')
    expect(await r.policy.canBring(r.request)).toBe(false)
    r.settings.bringToFrontOnAgentTaskComplete = true
    r.settingsChanged()
    r.hook('Stop')
    expect(await r.policy.canBring(r.request)).toBe(false)
    expect(callbacks.read).not.toHaveBeenCalled()
  })
  it('clears a pending verdict on pane teardown and setting disable/re-enable', async () => {
    const r = rig()
    r.input('human')
    r.hook('UserPromptSubmit')
    r.hook('Stop')
    expect(await r.policy.canBring(r.request)).toBe(true)
    callbacks.listeners.clear?.({ paneKey: 'pane' })
    expect(r.policy.stillEligible(r.request)).toBe(false)
    r.input('human')
    r.hook('UserPromptSubmit')
    r.hook('Stop')
    expect(await r.policy.canBring(r.request)).toBe(true)
    r.settings.bringToFrontOnAgentTaskComplete = false
    r.settingsChanged()
    r.settings.bringToFrontOnAgentTaskComplete = true
    r.settingsChanged()
    expect(r.policy.stillEligible(r.request)).toBe(false)
  })
})

describe('structured chat submission epochs', () => {
  it('accepts the exact live user turn, but rejects a previous journal epoch or enable cursor', async () => {
    callbacks.chat.enabled = true
    callbacks.chat.snapshot = replySnapshotFixture('user')
    const r = rig()
    const request = {
      ...r.request,
      surface: 'agent-session' as const,
      structuredOrigin: {
        scope: {
          executionHostId: 'local' as const,
          wslDistro: null,
          workspaceId: 'workspace',
          workspaceKind: 'folder' as const
        },
        sessionId: 'chat',
        cause: { kind: 'completion' as const, requestId: 'turn-A' },
        journalCursor: { epoch: 'epoch', sequence: 3 }
      }
    }
    expect(await r.policy.canBring(request)).toBe(true)
    expect(
      await r.policy.canBring({
        ...request,
        structuredOrigin: {
          ...request.structuredOrigin,
          journalCursor: { epoch: 'old-epoch', sequence: 3 }
        }
      })
    ).toBe(false)
    r.settings.bringToFrontOnAgentTaskComplete = false
    r.settingsChanged()
    callbacks.chat.floors.set('chat', { epoch: 'epoch', sequence: 3 })
    r.settings.bringToFrontOnAgentTaskComplete = true
    r.settingsChanged()
    expect(await r.policy.canBring(request)).toBe(false)
    expect(callbacks.read).not.toHaveBeenCalled()
  })
})
