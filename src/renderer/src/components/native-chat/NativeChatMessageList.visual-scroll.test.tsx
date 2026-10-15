// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type * as TranscriptChromeModule from './NativeChatTranscriptChrome'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { NATIVE_CHAT_VISUAL_READER_SCROLL_TYPE } from '../../../../shared/native-chat-visual-shell'

const callRuntimeRpc = vi.fn()
vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc: (...args: unknown[]) => callRuntimeRpc(...args)
}))
// The visual's row is in view, so its frame mounts.
vi.mock('./NativeChatTranscriptChrome', async (importOriginal) => ({
  ...(await importOriginal<typeof TranscriptChromeModule>()),
  observeTranscriptVisibility: (_element: Element, onChange: (visible: boolean) => void) => {
    onChange(true)
    return () => {}
  }
}))
// Pacing is not this test's subject.
vi.mock('./use-native-chat-paced-text', async (importOriginal) =>
  (await import('./native-chat-unpaced-text-fixture')).unpacedTextModule(importOriginal)
)

import { TooltipProvider } from '@/components/ui/tooltip'
import { NativeChatMessageList } from './NativeChatMessageList'
import { NativeChatVisualOwnerContext } from './native-chat-visual-owner'
import {
  deliverResizes,
  marker,
  session,
  stubLayout,
  stubResizeObserver
} from './native-chat-windowing-test-harness'

const owner = { target: { kind: 'local' as const }, sessionId: 'session-1', worktreeId: 'wt-1' }

function visualReply(index: number): NativeChatMessage {
  return {
    ...marker(index),
    blocks: [{ type: 'text', text: 'Here it is:\n::orca-visual{file="usage.html" title="Usage"}' }]
  }
}

function transcriptWithVisual(messages: NativeChatMessage[]): React.JSX.Element {
  return (
    <TooltipProvider>
      <NativeChatVisualOwnerContext.Provider value={owner}>
        <NativeChatMessageList
          session={session(messages)}
          isVisible
          isWorking={false}
          expandSignal={false}
        />
      </NativeChatVisualOwnerContext.Provider>
    </TooltipProvider>
  )
}

function scrollRoot(container: HTMLElement): HTMLElement {
  const scroller = container.querySelector<HTMLElement>('[data-native-chat-scroll]')
  if (!scroller) {
    throw new Error('no transcript scroll root')
  }
  return scroller
}

/** Deliver resize and scroll events to a fixed point, as a painted frame would. */
function paint(container: HTMLElement): void {
  const scroller = scrollRoot(container)
  let lastScrollTop = scroller.scrollTop
  for (let pass = 0; pass < 12; pass += 1) {
    let changed = false
    act(() => {
      changed = deliverResizes()
    })
    if (scroller.scrollTop !== lastScrollTop) {
      lastScrollTop = scroller.scrollTop
      fireEvent.scroll(scroller)
      changed = true
    }
    if (!changed) {
      return
    }
  }
  throw new Error('the transcript never settled: resize and scroll kept moving it')
}

let restoreLayout = (): void => {}
let restoreResizeObserver = (): void => {}

beforeEach(() => {
  restoreLayout = stubLayout({ scrollGeometry: true })
  restoreResizeObserver = stubResizeObserver()
  callRuntimeRpc.mockImplementation((_target: unknown, method: string) =>
    method === 'agentSession.readVisual'
      ? Promise.resolve({
          ok: true,
          revision: 'r1',
          html: '<p>v1</p>',
          path: '/scratch/usage.html'
        })
      : Promise.resolve(null)
  )
})

afterEach(() => {
  cleanup()
  restoreResizeObserver()
  restoreLayout()
})

it('keeps the place a reader scrolled to over a visual when the reply grows below', async () => {
  const transcript = [...Array.from({ length: 60 }, (_, index) => marker(index)), visualReply(60)]
  const view = render(transcriptWithVisual(transcript))
  const scroller = scrollRoot(view.container)
  paint(view.container)
  const frame = await waitFor(() => {
    const element = view.container.querySelector('iframe')
    expect(element).not.toBeNull()
    return element!
  })
  paint(view.container)
  const end = scroller.scrollHeight - scroller.clientHeight
  expect(scroller.scrollTop).toBe(end)

  // The wheel over the frame chains to the transcript, which scrolls without a wheel event of
  // its own; the frame's shell reports the gesture a moment later.
  const readingAt = end - 300
  scroller.scrollTop = readingAt
  fireEvent.scroll(scroller)
  const channel = frame.name.slice(frame.name.indexOf(':') + 1)
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: NATIVE_CHAT_VISUAL_READER_SCROLL_TYPE,
          channel,
          input: 'wheel',
          deltaY: -120
        },
        source: frame.contentWindow
      })
    )
  })

  view.rerender(transcriptWithVisual([...transcript, marker(61), marker(62)]))
  paint(view.container)
  expect(scroller.scrollTop).toBe(readingAt)
  expect(screen.getByRole('button', { name: /jump to latest/i })).toBeInTheDocument()
})
