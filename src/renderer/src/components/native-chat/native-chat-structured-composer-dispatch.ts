import type { StructuredAgentSessionCommandOutcome } from '../../../../shared/structured-agent-session-composer'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'
import type { NativeChatComposerImageAttachment } from './NativeChatComposerField'
import type { AgentType } from '../../../../shared/agent-status-types'
import { nativeChatMessageCommand } from '../../../../shared/native-chat-agent-profiles'

export async function dispatchNativeChatStructuredComposerText(
  transport: NativeChatStructuredComposerTransport,
  text: string,
  attachments: readonly NativeChatComposerImageAttachment[] = [],
  agent?: AgentType
): Promise<Omit<StructuredAgentSessionCommandOutcome, 'handled'> & { revealsTranscript: boolean }> {
  const { handled, ...command } = await transport.dispatchCommand(text)
  // A command's reveal, if any, came at the press; a message reveals unless it waits as a queued card.
  if (handled) {
    return { ...command, revealsTranscript: false }
  }
  const message = nativeChatMessageCommand(agent, text)
  if (message.error) {
    return { accepted: false, error: message.error, revealsTranscript: false }
  }
  const admission = transport.send(message.text, attachments)
  return { accepted: admission !== false, error: null, revealsTranscript: admission === true }
}
