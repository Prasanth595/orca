import { latestStructuredAgentSessionTurn } from '../../../src/shared/structured-agent-session-live-turn'
import { mergeSubmissions } from '../../../src/shared/structured-agent-session-item-retention'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { EMPTY_STRUCTURED_AGENT_SESSION } from '../../../src/shared/structured-agent-session-reducer'
import { createMobileChatReadCache } from '../cache/mobile-chat-read-cache'
import type { MobileChatHistoryState } from './mobile-chat-history-window'

function recentRows<T>(rows: T[], budget = 300 * 1024): T[] {
  let bytes = 0
  let first = rows.length
  while (first > 0) {
    bytes += JSON.stringify(rows[first - 1]).length * 2
    if (bytes > budget) {
      break
    }
    first--
  }
  return rows.slice(first)
}

export const structuredChatCache = createMobileChatReadCache<MobileChatHistoryState>(
  'structured-chat',
  {
    valid: (value) =>
      typeof value === 'object' &&
      value !== null &&
      'items' in value &&
      Array.isArray(value.items) &&
      value.items.every(
        (row) =>
          row &&
          typeof row.itemId === 'string' &&
          typeof row.sequence === 'number' &&
          typeof row.revision === 'number' &&
          row.body &&
          typeof row.body === 'object'
      ) &&
      'epoch' in value &&
      typeof value.epoch === 'string' &&
      'cursor' in value &&
      value.cursor !== null &&
      typeof value.cursor === 'object' &&
      'epoch' in value.cursor &&
      typeof value.cursor.epoch === 'string' &&
      'sequence' in value.cursor &&
      typeof value.cursor.sequence === 'number',
    compact: (state) => {
      const items = recentRows(state.items)
      return {
        ...EMPTY_STRUCTURED_AGENT_SESSION,
        epoch: state.epoch,
        cursor: state.cursor,
        items,
        submissions: mergeSubmissions([], state.submissions, items),
        latestTurn:
          state.latestTurn === undefined
            ? latestStructuredAgentSessionTurn(state.items)
            : state.latestTurn,
        working: state.working,
        activity: state.activity,
        hostClock: state.hostClock,
        hasOlder: state.hasOlder || items.length < state.items.length,
        status: 'ready'
      }
    }
  }
)

export type CachedNativeTranscript = {
  messages: NativeChatMessage[]
  hasMore: boolean
  beforeOffset: number | null
}
export const nativeChatCache = createMobileChatReadCache<CachedNativeTranscript>('native-chat', {
  valid: (value) =>
    typeof value === 'object' &&
    value !== null &&
    'messages' in value &&
    Array.isArray(value.messages) &&
    value.messages.every(
      (row) =>
        row &&
        typeof row.id === 'string' &&
        typeof row.role === 'string' &&
        Array.isArray(row.blocks)
    ),
  compact: (state) => ({ messages: recentRows(state.messages), hasMore: true, beforeOffset: null })
})
