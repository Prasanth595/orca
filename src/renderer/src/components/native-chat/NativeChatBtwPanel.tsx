import { forwardRef, useCallback, useImperativeHandle, useRef, type RefObject } from 'react'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { NativeChatBtwOverlay } from './NativeChatBtwOverlay'
import { createNativeChatBtwAsk, nativeChatSessionModelId } from './native-chat-btw-ask'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat-session-options'
import { useNativeChatBtw, type NativeChatBtwAsk } from './use-native-chat-btw'

export type NativeChatBtwHandle = {
  ask: (question: string) => void
}

export function useNativeChatBtwLayer(args: {
  messages: readonly NativeChatMessage[]
  agent: string
  cwd: string
  runtimeEnvironmentId: string | null
  model?: string
  composerRef: RefObject<{ focus: () => boolean } | null>
}): { node: React.JSX.Element; onBtw: (question: string) => void } {
  const btwRef = useRef<NativeChatBtwHandle>(null)
  const onBtw = useCallback((question: string) => {
    btwRef.current?.ask(question)
  }, [])
  return {
    onBtw,
    node: (
      <NativeChatBtwPanel
        ref={btwRef}
        messages={args.messages}
        ask={createNativeChatBtwAsk({
          agent: args.agent,
          cwd: args.cwd,
          runtime: args.runtimeEnvironmentId ? 'remote' : 'local',
          runtimeEnvironmentId: args.runtimeEnvironmentId,
          ...(args.model ? { model: args.model } : {})
        })}
        onDismissed={() => args.composerRef.current?.focus()}
      />
    )
  }
}

export function useStructuredNativeChatBtwLayer(
  props: { agent: string; target: { kind: string; environmentId?: string | null } },
  controller: {
    messages: readonly NativeChatMessage[]
    optionSnapshot: readonly SessionOptionDescriptor[]
  },
  fileLinkContext: { worktreePath?: string } | null,
  composerRef: RefObject<{ focus: () => boolean } | null>
): { node: React.JSX.Element; onBtw: (question: string) => void } {
  return useNativeChatBtwLayer({
    messages: controller.messages,
    agent: props.agent,
    cwd: fileLinkContext?.worktreePath || '.',
    runtimeEnvironmentId:
      props.target.kind === 'local' ? null : (props.target.environmentId ?? null),
    model: nativeChatSessionModelId(controller.optionSnapshot),
    composerRef
  })
}

export const NativeChatBtwPanel = forwardRef<
  NativeChatBtwHandle,
  {
    messages: readonly NativeChatMessage[]
    ask: NativeChatBtwAsk
    onDismissed?: () => void
  }
>(function NativeChatBtwPanel({ messages, ask, onDismissed }, ref) {
  const btw = useNativeChatBtw({ messages, ask })
  useImperativeHandle(ref, () => ({ ask: btw.ask }), [btw.ask])
  return (
    <NativeChatBtwOverlay
      state={btw.state}
      onDismiss={() => {
        btw.dismiss()
        onDismissed?.()
      }}
      onAsk={btw.ask}
      onDraftChange={btw.setDraft}
    />
  )
})
