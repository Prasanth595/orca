import { expect, it, vi } from 'vitest'
import { createMobileChatReadCache } from '../cache/mobile-chat-read-cache'
import { EMPTY_STRUCTURED_AGENT_SESSION } from '../../../src/shared/structured-agent-session-reducer'
import type { MobileChatHistoryState } from './mobile-chat-history-window'
import { projectStructuredAgentSessionMessages } from '../../../src/shared/structured-agent-session-message-projection'
import { mobileNativeChatTurnFold } from './mobile-native-chat-turn-fold'
import { runningStructuredAgentSessionTurnId } from '../../../src/shared/structured-agent-session-live-turn'
vi.mock('../cache/mobile-chat-read-cache', () => ({ createMobileChatReadCache: vi.fn() }))
await import('./mobile-chat-transcript-cache')
it('keeps running-turn presentation when a bounded checkpoint drops its older turn row', () => {
  const state: MobileChatHistoryState = {
    ...EMPTY_STRUCTURED_AGENT_SESSION,
    epoch: 'epoch',
    cursor: { epoch: 'epoch', sequence: 2 },
    fence: 4,
    status: 'ready',
    working: true,
    activity: { text: 'Running a tool', turnId: 'turn-1' },
    latestTurn: {
      itemId: 'turn',
      observedAt: 1,
      turn: { turnId: 'turn-1', state: 'running', startedAt: 1 }
    },
    items: [
      {
        itemId: 'tool',
        sequence: 2,
        revision: 1,
        observedAt: 2,
        body: {
          kind: 'tool-call',
          name: 'exec_command',
          input: { command: 'pwd' },
          state: 'running'
        }
      }
    ]
  }
  const compact = vi
    .mocked(createMobileChatReadCache<MobileChatHistoryState>)
    .mock.calls.find(([name]) => name === 'structured-chat')?.[1]?.compact
  if (!compact) {
    throw new Error('Missing structured checkpoint compactor')
  }
  const saved = compact(state)
  expect(saved).toMatchObject({
    fence: null,
    working: true,
    latestTurn: state.latestTurn,
    activity: state.activity
  })
  expect(runningStructuredAgentSessionTurnId(saved)).toBe('turn-1')
  const messages = projectStructuredAgentSessionMessages(saved.items, [], saved.submissions)
  expect(messages[0]?.blocks.some((block) => block.type === 'tool-call')).toBe(true)
})

it('keeps the compaction divider through cached projection and completed-turn folding', () => {
  const compact = vi
    .mocked(createMobileChatReadCache<MobileChatHistoryState>)
    .mock.calls.find(([name]) => name === 'structured-chat')?.[1]?.compact
  if (!compact) {
    throw new Error('Missing structured checkpoint compactor')
  }
  const saved = compact({
    ...EMPTY_STRUCTURED_AGENT_SESSION,
    epoch: 'epoch',
    cursor: { epoch: 'epoch', sequence: 1 },
    items: [
      {
        itemId: 'compact',
        revision: 1,
        sequence: 1,
        observedAt: 1,
        body: { kind: 'status', text: 'Context compacted', presentation: 'compaction' }
      }
    ]
  })
  const messages = projectStructuredAgentSessionMessages(saved.items, [], [])
  expect(messages[0]?.blocks[0]).toMatchObject({ presentation: 'compaction' })
  const fold = mobileNativeChatTurnFold(
    messages,
    ['turn'],
    { turn: { startedAt: 1, workedSeconds: 1, thinking: false } },
    new Set()
  )
  expect(fold.foldedRows.has(0)).toBe(false)
})
