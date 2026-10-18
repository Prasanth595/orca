import { buildNativeChatBtwPrompt } from '../../../../shared/native-chat-btw'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat-session-options'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { NativeChatBtwAsk } from './use-native-chat-btw'

export function nativeChatSessionModelId(
  snapshot: readonly SessionOptionDescriptor[]
): string | undefined {
  const row = snapshot.find((entry) => entry.id === 'model')
  return row?.kind.type === 'select' ? row.kind.currentValue : undefined
}

export type NativeChatSideQuestionResult =
  | { success: true; answer: string }
  | { success: false; error: string }

export function createNativeChatBtwAsk(args: {
  agent: string
  cwd: string
  model?: string
  runtime: 'local' | 'remote'
  runtimeEnvironmentId: string | null
}): NativeChatBtwAsk {
  return async (question, messages: readonly NativeChatMessage[]) => {
    const payload = {
      agent: args.agent,
      question,
      prompt: buildNativeChatBtwPrompt(messages, question),
      cwd: args.cwd,
      ...(args.model ? { model: args.model } : {})
    }
    if (args.runtime === 'remote' && args.runtimeEnvironmentId) {
      const target: RuntimeClientTarget = {
        kind: 'environment',
        environmentId: args.runtimeEnvironmentId
      }
      return await callRuntimeRpc<NativeChatSideQuestionResult>(
        target,
        'nativeChat.askSideQuestion',
        payload,
        { timeoutMs: 90_000 }
      )
    }
    return window.api.nativeChat.askSideQuestion(payload)
  }
}
