import type { RpcClient } from '../transport/rpc-client'
import type { AgentJournalCursor } from '../../../src/shared/agent-session-journal-types'
import { isRootAgentJournalItem } from '../../../src/shared/agent-session-journal-producer'
import type {
  AgentSessionHistoryPage,
  AgentSessionHistoryResult
} from '../../../src/shared/agent-session-wire'
import {
  oldestStructuredAgentSessionCursor,
  type StructuredAgentSessionState,
  type StructuredAgentSessionAction
} from '../../../src/shared/structured-agent-session-reducer'
import { callAgentSession } from './mobile-structured-agent-session-rpc'

// Keep a phone page below the host maximum; large tool output can otherwise exhaust its read budget.
const OLDER_PAGE_LIMIT = 40
const OLDER_PAGE_ANCHOR_ATTEMPTS = 3
const OLDER_PAGES_PER_LOAD = 8

/** Read contiguous history, skipping child-only pages and adopting the host's reset when needed. */
export async function readOlderStructuredChatHistory({
  client,
  sessionId,
  stateRef,
  isCurrentRead,
  apply
}: {
  client: RpcClient
  sessionId: string
  stateRef: { readonly current: StructuredAgentSessionState }
  isCurrentRead: () => boolean
  apply: (action: StructuredAgentSessionAction) => void
}): Promise<void> {
  // A live batch can head-trim past the anchor mid-read, and the reducer drops that
  // page rather than leave a hole in the transcript. Re-anchor and retry.
  for (let attempt = 0; attempt < OLDER_PAGE_ANCHOR_ATTEMPTS; attempt += 1) {
    const cursor = oldestStructuredAgentSessionCursor(stateRef.current)
    if (!cursor || !isCurrentRead()) {
      return
    }
    // Mobile draws only the session's own rows, so a page of a subagent's rows alone
    // would land as nothing; read on until a page adds a row the reader can see. Older
    // hosts send one for any burst; current ones when the page's byte bound cuts it short.
    const pages: { requestedCursor: AgentJournalCursor; page: AgentSessionHistoryPage }[] = []
    let requestedCursor = cursor
    while (pages.length < OLDER_PAGES_PER_LOAD) {
      const result = await callAgentSession<AgentSessionHistoryResult>(
        client,
        'agentSession.history',
        {
          sessionId,
          direction: 'before',
          cursor: requestedCursor,
          limit: OLDER_PAGE_LIMIT
        }
      )
      if (!isCurrentRead()) {
        return
      }
      if (!result.ok) {
        const fence = result.fence ?? result.page?.fence ?? stateRef.current.fence
        if (result.page && fence != null) {
          apply({
            type: 'event',
            event: {
              type: 'reset',
              sessionId,
              reset: result.reset,
              page: result.page,
              fence
            }
          })
        } else {
          throw new Error('History changed. Reopen this conversation to refresh it.')
        }
        return
      }
      pages.push({ requestedCursor, page: result.page })
      if (
        !result.page.hasOlder ||
        result.page.items.length === 0 ||
        result.page.items.some(isRootAgentJournalItem)
      ) {
        break
      }
      requestedCursor = result.page.window.nextCursor
    }
    if (pages.length === 0 || !isCurrentRead()) {
      return
    }
    // The reducer drops a page whose anchor slid, so only an intact anchor lands;
    // each later page abuts the one before it.
    if (oldestStructuredAgentSessionCursor(stateRef.current)?.sequence === cursor.sequence) {
      for (const { requestedCursor: pageCursor, page } of pages) {
        apply({ type: 'older-page', requestedCursor: pageCursor, page })
      }
      return
    }
  }
}
