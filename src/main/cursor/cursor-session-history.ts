import { sessionIdFromFileName } from '../ai-vault/session-scanner-accumulator'
import {
  resumeInvocationFromOptions,
  type StructuredAgentSessionHistory
} from '../native-chat/structured-agent-cli-conversations'

// `ls` opens a picker and `resume` takes the latest chat, so either may pick any conversation.
const TARGETLESS_SUBCOMMANDS = ['ls', 'resume']

export const CURSOR_SESSION_HISTORY: StructuredAgentSessionHistory = {
  rowAgents: ['cursor'],
  // The SDK names a chat `agent-<uuid>`; Session History lists its transcript by the bare uuid.
  rowSessionId: (link) => sessionIdFromFileName(link.handle.nativeId),
  parseResumeArgs: (args) =>
    TARGETLESS_SUBCOMMANDS.includes(args[0] ?? '')
      ? { target: null }
      : resumeInvocationFromOptions(args, { targetless: ['--continue'], markers: ['--resume'] }),
  // `--resume` names the chat with or without the SDK's `agent-` prefix.
  resumeTargetMatches: (target, rowSessionId) =>
    sessionIdFromFileName(target).toLowerCase() === rowSessionId.toLowerCase()
}
