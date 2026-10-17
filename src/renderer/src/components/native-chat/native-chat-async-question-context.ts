import { createContext } from 'react'

export type NativeChatAsyncQuestionReply = {
  disabled: boolean
  send: (text: string) => boolean
}

export const NativeChatAsyncQuestionContext = createContext<NativeChatAsyncQuestionReply | null>(
  null
)
