import { forwardRef, useImperativeHandle } from 'react'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { NativeChatBtwOverlay } from './NativeChatBtwOverlay'
import { useNativeChatBtw, type NativeChatBtwAsk } from './use-native-chat-btw'

export type NativeChatBtwHandle = {
  ask: (question: string) => void
}

export const NativeChatBtwPanel = forwardRef<
  NativeChatBtwHandle,
  { messages: readonly NativeChatMessage[]; ask: NativeChatBtwAsk }
>(function NativeChatBtwPanel({ messages, ask }, ref) {
  const btw = useNativeChatBtw({ messages, ask })
  useImperativeHandle(ref, () => ({ ask: btw.ask }), [btw.ask])
  return (
    <NativeChatBtwOverlay
      state={btw.state}
      onDismiss={btw.dismiss}
      onAsk={btw.ask}
      onDraftChange={btw.setDraft}
    />
  )
})
