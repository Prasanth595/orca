import { describe, expect, it } from 'vitest'
import type { AgentSessionHistoryPage } from '../../../src/shared/agent-session-wire'
import { EMPTY_STRUCTURED_AGENT_SESSION } from '../../../src/shared/structured-agent-session-reducer'
import { reduceMobileChatHistory, type MobileChatHistoryState } from './mobile-chat-history-window'

function page(sequences: number[], epoch = 'epoch'): AgentSessionHistoryPage {
  const cursor = (sequence: number) => ({ epoch, sequence })
  return {
    sessionId: 'chat',
    epoch,
    direction: 'tail',
    submissions: [],
    removedItemIds: [],
    items: sequences.map((sequence) => ({
      itemId: `row-${sequence}`,
      sequence,
      revision: 1,
      observedAt: sequence,
      body: {
        kind: 'message',
        role: 'assistant',
        blocks: [{ type: 'text', text: String(sequence) }]
      }
    })),
    window: {
      oldest: cursor(sequences[0] ?? 0),
      newest: cursor(sequences.at(-1) ?? 0),
      nextCursor: cursor(sequences[0] ?? 0)
    },
    liveCursor: cursor(sequences.at(-1) ?? 0),
    hasOlder: true,
    hasNewer: false
  }
}
const read = (state: MobileChatHistoryState, value: AgentSessionHistoryPage) =>
  reduceMobileChatHistory(state, { type: 'history-page', page: value })
const ids = (state: MobileChatHistoryState) => state.items.map((row) => row.sequence)
describe('cached and live history windows', () => {
  it('joins an overlapping fresh tail without losing previously paged rows', () => {
    const cached = read(EMPTY_STRUCTURED_AGENT_SESSION, page([1, 2, 3]))
    expect(ids(read(cached, page([3, 4])))).toEqual([1, 2, 3, 4])
  })
  it('keeps a gap outside the visible list until backward paging reaches the cache', () => {
    const cached = read(EMPTY_STRUCTURED_AGENT_SESSION, page([1, 2, 3]))
    const latest = read(cached, page([6, 7]))
    expect(ids(latest)).toEqual([6, 7])
    expect(latest.cachedHistory?.map((row) => row.sequence)).toEqual([1, 2, 3])
    const joined = reduceMobileChatHistory(latest, {
      type: 'older-page',
      requestedCursor: { epoch: 'epoch', sequence: 6 },
      page: page([3, 4, 5])
    })
    expect(ids(joined)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(joined.cachedHistory).toEqual([])
  })
  it('lets fresh coverage remove rows missing from the authoritative interval', () => {
    const cached = read(EMPTY_STRUCTURED_AGENT_SESSION, page([1, 2, 3, 4]))
    expect(ids(read(cached, page([2, 4, 5])))).toEqual([1, 2, 4, 5])
  })
  it('never joins across epochs or a reset', () => {
    const cached = read(EMPTY_STRUCTURED_AGENT_SESSION, page([1, 2, 3]))
    expect(ids(read(cached, page([3, 4], 'new-epoch')))).toEqual([3, 4])
    const reset = reduceMobileChatHistory(cached, {
      type: 'event',
      event: {
        type: 'reset',
        sessionId: 'chat',
        fence: 2,
        reset: 'cursor_compacted',
        page: page([3, 4])
      }
    })
    expect(ids(reset)).toEqual([3, 4])
    expect(reset.cachedHistory).toEqual([])
  })
})
