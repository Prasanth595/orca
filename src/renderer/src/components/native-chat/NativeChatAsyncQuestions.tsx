import { useContext, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { NativeChatAsyncQuestion } from '../../../../shared/native-chat-types'
import {
  asyncQuestionsPrompt,
  formatAsyncQuestionAnswer
} from '../../../../shared/native-chat-async-questions'
import { NativeChatQuestionCard } from './NativeChatQuestionCard'
import { NativeChatAsyncQuestionContext } from './native-chat-async-question-context'

export function NativeChatAsyncQuestions({
  questions
}: {
  questions: NativeChatAsyncQuestion[]
}): React.JSX.Element | null {
  const reply = useContext(NativeChatAsyncQuestionContext)
  const [expanded, setExpanded] = useState(true)
  const [sending, setSending] = useState(false)
  const inFlight = useRef(false)
  const card = useRef<HTMLFieldSetElement>(null)
  const replyButton = useRef<HTMLButtonElement>(null)
  const answerInput = useRef<HTMLInputElement>(null)
  if (!reply || questions.length === 0) {
    return null
  }
  const collapse = (): void => {
    const restoreFocus = card.current?.contains(document.activeElement)
    setExpanded(false)
    if (restoreFocus) {
      requestAnimationFrame(() => replyButton.current?.focus())
    }
  }
  return (
    <>
      <fieldset ref={card} hidden={!expanded} disabled={reply.disabled || sending || !expanded}>
        <NativeChatQuestionCard
          prompt={asyncQuestionsPrompt(questions)}
          isSubmitting={sending}
          allowOther
          answerInputRef={answerInput}
          onCancel={collapse}
          onCollapse={collapse}
          onAnswer={(selections) => {
            if (reply.disabled || inFlight.current) {
              return
            }
            const text = formatAsyncQuestionAnswer(questions, selections)
            if (!text) {
              return
            }
            const result = reply.send(text)
            if (typeof result === 'boolean') {
              if (result) {
                collapse()
              }
              return
            }
            inFlight.current = true
            setSending(true)
            void result
              .then((accepted) => {
                if (accepted) {
                  collapse()
                }
              })
              .catch(() => false)
              .finally(() => {
                inFlight.current = false
                setSending(false)
              })
          }}
        />
      </fieldset>
      <div hidden={expanded} className="space-y-2">
        <p className="whitespace-pre-wrap text-sm">
          {questions.map((question) => question.title).join('\n\n')}
        </p>
        <Button
          ref={replyButton}
          variant="outline"
          size="sm"
          disabled={reply.disabled}
          onClick={() => {
            setExpanded(true)
            requestAnimationFrame(() => answerInput.current?.focus())
          }}
        >
          {translate('components.native-chat.question.reply', 'Reply')}
        </Button>
      </div>
    </>
  )
}
