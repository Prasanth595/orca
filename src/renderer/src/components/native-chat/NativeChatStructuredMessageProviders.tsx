import { useMemo, type ContextType, type ReactNode } from 'react'
import { reportStructuredSessionUserInput } from '@/lib/worker-terminal-takeover-report'
import type { useStructuredAgentSession } from './use-structured-agent-session'
import { NativeChatAsyncQuestionContext } from './native-chat-async-question-context'
import { NativeChatRewindContext } from './native-chat-rewind-context'
import { NativeChatOrcaStopContext } from './native-chat-orca-stop-context'
import { NativeChatClaudeSignInContext } from './native-chat-claude-sign-in'
import type { NativeChatStructuredViewProps } from './native-chat-view-types'

export function NativeChatStructuredMessageProviders({
  controller,
  pane,
  blocked,
  installBlocked,
  continuation,
  claudeSignIn,
  onSubmitted,
  children
}: {
  controller: ReturnType<typeof useStructuredAgentSession>
  pane: Pick<NativeChatStructuredViewProps, 'sessionId' | 'target'>
  blocked: boolean
  installBlocked: boolean
  continuation: ContextType<typeof NativeChatOrcaStopContext>
  claudeSignIn: ContextType<typeof NativeChatClaudeSignInContext>
  onSubmitted: () => void
  children: ReactNode
}): React.JSX.Element {
  const { send, sendOut, prompts, rewind } = controller
  const { sessionId, target } = pane
  const disabled = blocked || installBlocked || sendOut || prompts.length > 0
  const value = useMemo(
    () => ({
      disabled,
      send: (text: string): boolean => {
        if (disabled || !send(text, [], { immediate: true })) {
          return false
        }
        onSubmitted()
        reportStructuredSessionUserInput(
          sessionId,
          target.kind === 'local' ? null : (target.environmentId ?? null)
        )
        return true
      }
    }),
    [disabled, onSubmitted, send, sessionId, target]
  )
  return (
    <NativeChatAsyncQuestionContext.Provider value={value}>
      <NativeChatRewindContext.Provider value={rewind.surface}>
        <NativeChatOrcaStopContext.Provider value={continuation}>
          <NativeChatClaudeSignInContext.Provider value={claudeSignIn}>
            {children}
          </NativeChatClaudeSignInContext.Provider>
        </NativeChatOrcaStopContext.Provider>
      </NativeChatRewindContext.Provider>
    </NativeChatAsyncQuestionContext.Provider>
  )
}
