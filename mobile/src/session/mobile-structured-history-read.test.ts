import { expect, it, vi } from 'vitest'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import type { AgentSessionHistoryPage } from '../../../src/shared/agent-session-wire'
import { EMPTY_STRUCTURED_AGENT_SESSION } from '../../../src/shared/structured-agent-session-reducer'
import type { RpcClient } from '../transport/rpc-client'
import { readOlderStructuredChatHistory } from './mobile-structured-history-read'

function row(sequence: number): AgentJournalRenderItem {
  return {
    itemId: `row-${sequence}`,
    revision: 1,
    sequence,
    observedAt: sequence,
    body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'x'.repeat(5000) }] }
  }
}
it('delivers earlier prose before the read deadline on a constrained connection', async () => {
  vi.useFakeTimers()
  const anchor = { epoch: 'epoch-1', sequence: 1000 }
  const applied: unknown[] = []
  const sendRequest = vi.fn(
    async (
      _method: string,
      params: { limit: number; cursor: typeof anchor },
      options: { timeoutMs: number }
    ) => {
      const items = Array.from({ length: params.limit }, (_, index) =>
        row(1000 - params.limit + index)
      )
      const page: AgentSessionHistoryPage = {
        sessionId: 'session-1',
        epoch: anchor.epoch,
        direction: 'before',
        items,
        removedItemIds: [],
        submissions: [],
        hasOlder: true,
        hasNewer: true,
        window: {
          oldest: { ...anchor, sequence: items[0]!.sequence },
          newest: { ...anchor, sequence: 999 },
          nextCursor: { ...anchor, sequence: items[0]!.sequence }
        }
      }
      const deliveryMs = Math.ceil((JSON.stringify(page).length / (50 * 1024)) * 1000)
      return new Promise((resolve, reject) => {
        setTimeout(
          () => {
            if (deliveryMs >= options.timeoutMs) {
              reject(new Error('Request timed out: agentSession.history'))
            } else {
              resolve({ ok: true, result: { ok: true, page } })
            }
          },
          Math.min(deliveryMs, options.timeoutMs)
        )
      })
    }
  )
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the read uses only sendRequest on this client.
  const client = { sendRequest } as unknown as RpcClient
  try {
    const pending = readOlderStructuredChatHistory({
      client,
      sessionId: 'session-1',
      stateRef: {
        current: { ...EMPTY_STRUCTURED_AGENT_SESSION, epoch: anchor.epoch, items: [row(1000)] }
      },
      isCurrentRead: () => true,
      apply: (action) => applied.push(action)
    })
    const outcome = pending.then(
      () => 'delivered',
      (error) => error.message
    )
    await vi.advanceTimersByTimeAsync(15000)
    expect(await outcome).toBe('delivered')
    expect(applied).toHaveLength(1)
    expect(sendRequest).toHaveBeenCalledOnce()
    expect(sendRequest.mock.calls[0]?.[1].cursor).toEqual(anchor)
  } finally {
    vi.useRealTimers()
  }
})
