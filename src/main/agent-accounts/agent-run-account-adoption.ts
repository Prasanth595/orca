import type { AgentRunAccountProvider } from '../../shared/agent-run-account'
import type { CodexPaneAccountRecord } from '../codex/codex-pane-account-registry'
import type { KeptAgentConversations } from './kept-agent-conversations'

export type KeptConversationLookup = Pick<KeptAgentConversations, 'get' | 'keep'>

/** The account a conversation is kept on; undefined = not kept, or the index cannot say. */
export function keptConversationAccount(
  kept: KeptConversationLookup,
  provider: AgentRunAccountProvider,
  sessionId: string | null
): string | null | undefined {
  if (!sessionId) {
    return undefined
  }
  const entry = kept.get(provider, sessionId)
  return entry && entry !== 'unavailable' ? entry.accountId : undefined
}

/**
 * A new Claude session in a pane inherits its predecessor's keep, but only when it provably
 * runs on the kept account; one typed after a switch into a selection-following terminal
 * runs elsewhere and stays unkept, so the UI never claims a keep the process ignores.
 */
export function adoptClaudeSession(args: {
  kept: KeptConversationLookup
  previousSessionId: string | null | undefined
  sessionId: string | null
  accountId: string | null | undefined
  transcriptPath: string | undefined
  now: number
}): void {
  const { kept, sessionId, accountId } = args
  if (!sessionId || accountId === undefined || !args.previousSessionId) {
    return
  }
  if (sessionId === args.previousSessionId) {
    return
  }
  if (keptConversationAccount(kept, 'claude', args.previousSessionId) !== accountId) {
    return
  }
  if (keptConversationAccount(kept, 'claude', sessionId) === accountId) {
    return
  }
  kept.keep('claude', sessionId, {
    lane: 'host',
    accountId,
    keptAt: args.now,
    ...(args.transcriptPath ? { transcriptPath: args.transcriptPath } : {})
  })
}

/** A kept Codex pane's home is fixed at spawn, so every session it reports runs there. */
export function adoptCodexSession(args: {
  kept: KeptConversationLookup
  record: CodexPaneAccountRecord | null
  sessionId: string | null
  transcriptPath: string | undefined
  now: number
}): void {
  const { kept, record, sessionId } = args
  if (!record?.kept || record.selectionKey !== 'host' || !sessionId) {
    return
  }
  const current = kept.get('codex', sessionId)
  if (current === 'unavailable' || current?.accountId === record.accountId) {
    return
  }
  kept.keep('codex', sessionId, {
    lane: 'host',
    accountId: record.accountId,
    keptAt: args.now,
    ...(args.transcriptPath ? { transcriptPath: args.transcriptPath } : {})
  })
}
