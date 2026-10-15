import type { RpcClient } from '../transport/rpc-client'
import type { AgentJournalCursor } from '../../../src/shared/agent-session-journal-types'
import type { AgentSessionSubscribeEvent } from '../../../src/shared/agent-session-wire'

/** A refused hold still allows history to load from an older host. */
export function openTranscriptAfterHold(
  client: RpcClient,
  sessionId: string,
  held: Promise<unknown>,
  onFrame: (raw: unknown) => void,
  cursor?: AgentJournalCursor | null
): () => void {
  let ended = false
  let close = (): void => {}
  void held
    .catch(() => undefined)
    .then(() => {
      if (!ended) {
        close = client.subscribe(
          'agentSession.subscribe',
          { sessionId, ...(cursor ? { cursor } : {}) },
          onFrame
        )
      }
    })
  return () => {
    ended = true
    close()
  }
}

export function isSubscribeEvent(value: unknown): value is AgentSessionSubscribeEvent {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const type = (value as { type?: unknown }).type
  return type === 'snapshot' || type === 'batch' || type === 'reset' || type === 'end'
}
