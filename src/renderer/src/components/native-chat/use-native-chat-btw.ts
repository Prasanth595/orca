import { useCallback, useState } from 'react'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { translate } from '@/i18n/i18n'

export type NativeChatBtwState = {
  open: boolean
  question: string
  draft: string
  answer: string | null
  error: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
}

export type NativeChatBtwAsk = (
  question: string,
  messages: readonly NativeChatMessage[]
) => Promise<{ success: true; answer: string } | { success: false; error: string }>

const closed: NativeChatBtwState = {
  open: false,
  question: '',
  draft: '',
  answer: null,
  error: null,
  status: 'idle'
}

export function useNativeChatBtw(args: {
  messages: readonly NativeChatMessage[]
  ask: NativeChatBtwAsk
}): {
  state: NativeChatBtwState
  ask: (question: string) => void
  dismiss: () => void
  setDraft: (draft: string) => void
} {
  const [state, setState] = useState<NativeChatBtwState>(closed)
  const { messages, ask } = args

  const run = useCallback(
    async (question: string) => {
      const trimmed = question.trim()
      if (!trimmed) {
        setState({
          open: true,
          question: '',
          draft: '',
          answer: null,
          error: null,
          status: 'idle'
        })
        return
      }
      setState({
        open: true,
        question: trimmed,
        draft: trimmed,
        answer: null,
        error: null,
        status: 'loading'
      })
      const result = await ask(trimmed, messages)
      setState((current) => {
        if (!current.open || current.question !== trimmed) {
          return current
        }
        return result.success
          ? { ...current, status: 'ready', answer: result.answer, error: null }
          : {
              ...current,
              status: 'error',
              error:
                result.error ||
                translate('components.native-chat.btw.failed', 'Could not answer the side question.')
            }
      })
    },
    [ask, messages]
  )

  return {
    state,
    ask: run,
    dismiss: () => setState(closed),
    setDraft: (draft) => setState((current) => ({ ...current, draft }))
  }
}
