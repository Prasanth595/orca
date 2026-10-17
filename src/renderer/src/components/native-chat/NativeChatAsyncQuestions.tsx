import { useContext, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { NativeChatAsyncQuestion } from '../../../../shared/native-chat-types'
import { NativeChatQuestionCard } from './NativeChatQuestionCard'
import { NativeChatAsyncQuestionContext } from './native-chat-async-question-context'

export function NativeChatAsyncQuestions({
  questions
}: {
  questions: NativeChatAsyncQuestion[]
}): React.JSX.Element | null {
  const reply = useContext(NativeChatAsyncQuestionContext)
  const [expanded, setExpanded] = useState(true)
  const replyButton = useRef<HTMLButtonElement>(null)
  const answerInput = useRef<HTMLInputElement>(null)
  if (!reply || questions.length === 0) {
    return null
  }
  const collapse = (): void => {
    setExpanded(false)
    requestAnimationFrame(() => replyButton.current?.focus())
  }
  return (
    <>
      <fieldset hidden={!expanded} disabled={reply.disabled || !expanded}>
        <NativeChatQuestionCard
          prompt={{
            questions: questions.map(({ title, options }) => ({
              question: title,
              multiSelect: false,
              options: options.map((label) => ({ label }))
            }))
          }}
          allowOther
          answerInputRef={answerInput}
          onCancel={collapse}
          onCollapse={collapse}
          onAnswer={(selections) => {
            const text = questions
              .flatMap((question, index) => {
                const selection = selections[index]
                const answer =
                  selection?.other?.trim() ||
                  selection?.indices
                    .map((choice) => question.options[choice])
                    .filter(Boolean)
                    .join(', ')
                return answer ? [`${question.title}\n${answer}`] : []
              })
              .join('\n\n')
            if (text && reply.send(text)) {
              collapse()
            }
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
