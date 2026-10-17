import type { AskAnswerSelection, AskPrompt } from './native-chat-ask'
import type { NativeChatAsyncQuestion } from './native-chat-types'

export type NativeChatAsyncQuestionReply = {
  disabled: boolean
  send: (text: string) => boolean | Promise<boolean>
}

export function asyncQuestionsPrompt(questions: NativeChatAsyncQuestion[]): AskPrompt {
  return {
    questions: questions.map(({ title, options }) => ({
      question: title,
      multiSelect: false,
      options: options.map((label) => ({ label }))
    }))
  }
}

export function formatAsyncQuestionAnswer(
  questions: NativeChatAsyncQuestion[],
  selections: AskAnswerSelection[]
): string {
  return questions
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
}
