// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render as renderView, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeChatAsyncQuestions } from './NativeChatAsyncQuestions'
import { NativeChatAsyncQuestionContext } from './native-chat-async-question-context'
import { NATIVE_CHAT_QUESTION_AUTO_ADVANCE_MS } from '../../../../shared/native-chat-question-auto-advance'

function render(ui: ReactNode) {
  return renderView(ui, { wrapper: TooltipProvider })
}

const send = vi.fn(() => true)
const reply = { disabled: false, send }
const blockedReply = { disabled: true, send }

const questions = [{ title: 'Which branch?', options: ['main', 'release'] }]

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  send.mockReset().mockReturnValue(true)
})

it.each(['release', 'my branch'])('sends a chosen or custom answer: %s', (answer) => {
  render(
    <NativeChatAsyncQuestionContext.Provider value={reply}>
      <NativeChatAsyncQuestions questions={questions} />
    </NativeChatAsyncQuestionContext.Provider>
  )
  if (answer === 'release') {
    fireEvent.click(screen.getByRole('button', { name: /release/ }))
  } else {
    fireEvent.change(screen.getByRole('textbox', { name: 'Other: type your answer' }), {
      target: { value: '  my branch  ' }
    })
  }
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  expect(send).toHaveBeenCalledExactlyOnceWith(`Which branch?\n${answer}`)
  expect(screen.getByRole('button', { name: 'Reply' })).toBeVisible()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

it('sends grouped answers together, including a question without suggestions', () => {
  vi.useFakeTimers()
  render(
    <NativeChatAsyncQuestionContext.Provider value={reply}>
      <NativeChatAsyncQuestions
        questions={[...questions, { title: 'Anything else?', options: [] }]}
      />
    </NativeChatAsyncQuestionContext.Provider>
  )
  fireEvent.click(screen.getByRole('button', { name: /release/ }))
  act(() => vi.advanceTimersByTime(NATIVE_CHAT_QUESTION_AUTO_ADVANCE_MS))
  expect(send).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep the docs' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  expect(send).toHaveBeenCalledExactlyOnceWith(
    'Which branch?\nrelease\n\nAnything else?\nKeep the docs'
  )
})

it('keeps the typed draft when folded and restores focus only when reopened', () => {
  vi.useFakeTimers()
  const view = render(<input aria-label="Composer" />)
  const composer = screen.getByRole('textbox', { name: 'Composer' })
  composer.focus()
  view.rerender(
    <>
      <input aria-label="Composer" />
      <NativeChatAsyncQuestionContext.Provider value={reply}>
        <NativeChatAsyncQuestions questions={questions} />
      </NativeChatAsyncQuestionContext.Provider>
    </>
  )
  act(() => vi.runOnlyPendingTimers())
  expect(composer).toHaveFocus()
  fireEvent.change(screen.getByRole('textbox', { name: 'Other: type your answer' }), {
    target: { value: 'unfinished answer' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  act(() => vi.runOnlyPendingTimers())
  expect(screen.getByRole('button', { name: 'Reply' })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
  act(() => vi.runOnlyPendingTimers())
  const answer = screen.getByRole('textbox', { name: 'Other: type your answer' })
  expect(answer).toHaveValue('unfinished answer')
  expect(answer).toHaveFocus()
  expect(send).not.toHaveBeenCalled()
})

it('keeps the card and answer when the sender refuses the reply', () => {
  send.mockReturnValue(false)
  render(
    <NativeChatAsyncQuestionContext.Provider value={reply}>
      <NativeChatAsyncQuestions questions={questions} />
    </NativeChatAsyncQuestionContext.Provider>
  )
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'keep this' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  expect(send).toHaveBeenCalledExactlyOnceWith('Which branch?\nkeep this')
  expect(screen.getByRole('textbox')).toHaveValue('keep this')
  expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument()
})

it('disables the controls while replies are blocked and keeps the draft', () => {
  const card = (disabled: boolean) => (
    <NativeChatAsyncQuestionContext.Provider value={disabled ? blockedReply : reply}>
      <NativeChatAsyncQuestions questions={questions} />
    </NativeChatAsyncQuestionContext.Provider>
  )
  const view = render(card(false))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'wait for me' } })
  view.rerender(card(true))
  expect(screen.getByRole('textbox')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
  expect(send).not.toHaveBeenCalled()
  view.rerender(card(false))
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  expect(send).toHaveBeenCalledExactlyOnceWith('Which branch?\nwait for me')
})

it('does not offer an unroutable card outside its session provider', () => {
  const { container } = render(<NativeChatAsyncQuestions questions={questions} />)
  expect(container).toBeEmptyDOMElement()
})
