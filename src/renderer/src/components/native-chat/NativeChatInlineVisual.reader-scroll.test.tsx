// @vitest-environment happy-dom

import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NATIVE_CHAT_VISUAL_READER_SCROLL_TYPE } from '../../../../shared/native-chat-visual-shell'

const callRuntimeRpc = vi.fn()
vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc: (...args: unknown[]) => callRuntimeRpc(...args)
}))
vi.mock('./NativeChatTranscriptChrome', () => ({
  observeTranscriptVisibility: (_element: Element, onChange: (visible: boolean) => void) => {
    onChange(true)
    return () => {}
  }
}))

import { NativeChatInlineVisual } from './NativeChatInlineVisual'
import { NativeChatForwardedGestureContext } from './native-chat-reader-scroll-input'
import { TooltipProvider } from '@/components/ui/tooltip'

afterEach(cleanup)

it('forwards a wheel its frame reports to the transcript as the reader leaving the end', async () => {
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
  const forwardedGesture = vi.fn()
  const { container } = render(
    <TooltipProvider>
      <NativeChatForwardedGestureContext.Provider value={forwardedGesture}>
        <NativeChatInlineVisual
          owner={{ target: { kind: 'local' }, sessionId: 'session-1', worktreeId: 'wt-1' }}
          file="usage.html"
          title="Usage"
        />
      </NativeChatForwardedGestureContext.Provider>
    </TooltipProvider>
  )
  const frame = await waitFor(() => {
    const element = container.querySelector('iframe')
    expect(element).not.toBeNull()
    return element!
  })
  const channel = frame.name.slice(frame.name.indexOf(':') + 1)
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: NATIVE_CHAT_VISUAL_READER_SCROLL_TYPE, channel, input: 'wheel', deltaY: -40 },
        source: frame.contentWindow
      })
    )
  })
  expect(forwardedGesture).toHaveBeenCalledWith({ kind: 'wheel', deltaY: -40, zoom: false })
})
