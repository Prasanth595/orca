import type { RpcClient } from '../transport/rpc-client'
import type { StructuredAgentSessionState } from '../../../src/shared/structured-agent-session-reducer'
import type { QueuedFeed } from './mobile-structured-queued-message-feed'

export type MobileStructuredAgentStateArgs = {
  client: RpcClient | null
  sessionId: string | null
  sessionKey: string | null
  enabled: boolean
  /** Live transport only. The hold dies with the connection and has to be retaken,
   *  but the transcript must survive the outage rather than blank out with it. */
  connected: boolean
}

export type MobileStructuredAgentState = {
  state: StructuredAgentSessionState
  stateRef: { readonly current: StructuredAgentSessionState }
  /** Host-held queued drafts from the live stream; null until the host claims any. */
  queuedMessages: QueuedFeed['messages']
  /** The whole queue's pause, published with the drafts. */
  queuePause: QueuedFeed['pause']
  loadingOlder: boolean
  loadEarlier: () => void
}
