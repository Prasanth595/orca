import { compareAgentJournalItems } from '../../../src/shared/agent-session-journal-position'
import { ownItemCount } from '../../../src/shared/structured-agent-session-item-retention'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import type { AgentSessionHistoryPage } from '../../../src/shared/agent-session-wire'
import {
  reduceStructuredAgentSession,
  type StructuredAgentSessionState,
  type StructuredAgentSessionAction
} from '../../../src/shared/structured-agent-session-reducer'

export type MobileChatHistoryState = StructuredAgentSessionState & {
  cachedHistory?: AgentJournalRenderItem[]
}

/** Join only overlapping windows; a fresh page owns every row inside its interval. */
function joinHistory(cached: AgentJournalRenderItem[], page: AgentSessionHistoryPage) {
  const overlaps = page.items.some((item) => cached.some((old) => old.itemId === item.itemId))
  if (!overlaps) {
    return null
  }
  const first = Math.min(...page.items.map((item) => item.sequence))
  const removed = new Set(page.removedItemIds)
  return [
    ...cached.filter((item) => page.hasOlder && item.sequence < first && !removed.has(item.itemId)),
    ...page.items
  ].sort(compareAgentJournalItems)
}

export function reduceMobileChatHistory(
  state: MobileChatHistoryState,
  action: StructuredAgentSessionAction
): MobileChatHistoryState {
  const page =
    action.type === 'history-page' || action.type === 'older-page'
      ? action.page
      : action.type === 'event' &&
          (action.event.type === 'snapshot' || action.event.type === 'reset')
        ? action.event.page
        : null
  const reset = action.type === 'event' && action.event.type === 'reset'
  const sameEpoch = !page || state.epoch === page.epoch
  let cached = sameEpoch && !reset ? (state.cachedHistory ?? []) : []
  if (action.type === 'event' && action.event.type === 'batch') {
    const removed = new Set(action.event.batch.removedItemIds)
    cached = cached.filter((item) => !removed.has(item.itemId))
  }
  let next = reduceStructuredAgentSession(state, action)
  if (next === state) {
    return state
  }
  if (page) {
    const removed = new Set(page.removedItemIds)
    cached = cached.filter((item) => !removed.has(item.itemId))
  }
  if (page && sameEpoch && !reset) {
    const existing = action.type === 'older-page' ? cached : state.items
    const joined = joinHistory(existing, page)
    if (joined) {
      if (action.type === 'older-page') {
        next = {
          ...next,
          items: [
            ...joined.filter((item) => !next.items.some((row) => row.itemId === item.itemId)),
            ...next.items
          ]
        }
        cached = []
      } else {
        next = { ...next, items: joined, hasOlder: state.hasOlder && page.hasOlder }
      }
    } else if (action.type !== 'older-page' && state.items.length) {
      cached = page.hasOlder
        ? state.items.filter((item) => !page.removedItemIds.includes(item.itemId)).slice(-200)
        : []
    }
  }
  return {
    ...next,
    retainedOwnItemLimit: Math.max(next.retainedOwnItemLimit, ownItemCount(next.items)),
    retainedItemCap: Math.max(next.retainedItemCap, next.items.length),
    cachedHistory: cached
  }
}
