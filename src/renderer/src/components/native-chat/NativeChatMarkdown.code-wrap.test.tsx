// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeChatCodeBlock } from './NativeChatCodeBlock'
import { NativeChatMarkdown } from './NativeChatMarkdown'
import {
  NativeChatDisclosureContext,
  useNativeChatDisclosures
} from './native-chat-disclosure-store'

vi.mock('@/lib/syntax-highlighting/oniguruma', async () => ({
  loadOniguruma: (await import('@/lib/syntax-highlighting/oniguruma-test-harness'))
    .loadNodeOniguruma
}))

afterEach(cleanup)

const OPENING = 'Run this first:\n\n```ts\nconst answer = 42\n```\n\nThen press '

/** A transcript: its disclosure store outlives the row, which windowing may unmount. */
function Transcript({
  content,
  mounted = true,
  growing = true
}: {
  content: string
  mounted?: boolean
  growing?: boolean
}) {
  const disclosures = useNativeChatDisclosures()
  return (
    <NativeChatDisclosureContext.Provider value={disclosures}>
      {mounted ? (
        <NativeChatMarkdown
          rowKey="message-1"
          content={content}
          variant="document"
          renderCodeBlock={NativeChatCodeBlock}
          streaming={growing}
          growing={growing}
          fadeWords={growing}
        />
      ) : null}
    </NativeChatDisclosureContext.Provider>
  )
}

function wrapToggle(): HTMLElement {
  return screen.getByRole('button', { name: /^(Wrap lines|Disable line wrap)$/ })
}

describe('native chat code block line wrap', () => {
  it('stays on as the reply grows, re-cuts its blocks, and the row remounts', () => {
    const view = render(<Transcript content={OPENING} />)
    fireEvent.click(wrapToggle())
    expect(wrapToggle()).toHaveAttribute('aria-pressed', 'true')

    const grown = `${OPENING}Enter.\n\nAnother paragraph`
    view.rerender(<Transcript content={grown} />)
    expect(wrapToggle()).toHaveAttribute('aria-pressed', 'true')

    // Inline HTML makes the whole reply render as one block from offset 0.
    const merged = `${grown} with <kbd>Ctrl</kbd>`
    view.rerender(<Transcript content={merged} />)
    expect(wrapToggle()).toHaveAttribute('aria-pressed', 'true')

    view.rerender(<Transcript content={merged} mounted={false} />)
    expect(screen.queryByRole('button', { name: 'Disable line wrap' })).toBeNull()
    view.rerender(<Transcript content={merged} />)
    expect(wrapToggle()).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps each block of a row to its own wrap', () => {
    const content = '```ts\nconst first = 1\n```\n\n```ts\nconst second = 2\n```'
    render(<Transcript content={content} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Wrap lines' })[1])

    expect(screen.getAllByRole('button', { name: /^(Wrap lines|Disable line wrap)$/ })).toEqual([
      screen.getByRole('button', { name: 'Wrap lines' }),
      screen.getByRole('button', { name: 'Disable line wrap' })
    ])
  })

  // Streaming fixes escape `x~y` and `- >5` mid-line, so a fence's character offset moves when the
  // block is next parsed without them.
  it.each([
    [
      'the reply finishes',
      '1. Undo with git reset HEAD~1:\n   ```sh\n   git status\n   ```\n',
      (content: string) => ({ content, growing: false })
    ],
    [
      'another block follows a list item',
      '- >5 users need x~y:\n  ```sh\n  scale up\n  ```\n',
      (content: string) => ({ content: `${content}\nDone.`, growing: true })
    ],
    [
      'the reply merges into one block',
      'Undo with git reset HEAD~1 first.\n\n```sh\ngit status\n```\n\nThen press ',
      (content: string) => ({ content: `${content}<kbd>Enter</kbd>`, growing: true })
    ]
  ])('stays on when %s after streaming escaped text before it', (_name, content, next) => {
    const view = render(<Transcript content={content} />)
    fireEvent.click(wrapToggle())
    expect(wrapToggle()).toHaveAttribute('aria-pressed', 'true')

    view.rerender(<Transcript {...next(content)} />)

    expect(wrapToggle()).toHaveAttribute('aria-pressed', 'true')
  })
})
