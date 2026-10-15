import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import type { NativeScrollEvent } from 'react-native'
import { useMobileChatInitialPosition } from './use-mobile-chat-initial-position'
let current!: ReturnType<typeof useMobileChatInitialPosition>
function Probe({ scope, offset = null }: { scope: string; offset?: number | null }) {
  current = useMobileChatInitialPosition(scope, offset)
  return null
}
afterEach(() => vi.unstubAllGlobals())
it('keeps the list hidden until the final measured bottom is reached and stable', () => {
  const frames = new Map<number, FrameRequestCallback>()
  let nextId = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextId, callback)
    return nextId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const tick = () =>
    act(() => {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach((callback) => callback(0))
    })
  let tree!: ReturnType<typeof create>
  act(() => {
    tree = create(createElement(Probe, { scope: 'a' }))
  })
  const scroll = (offset: number, height = 1800): NativeScrollEvent => ({
    contentOffset: { x: 0, y: offset },
    contentSize: { width: 400, height },
    layoutMeasurement: { width: 400, height: 800 },
    contentInset: { top: 0, right: 0, bottom: 0, left: 0 },
    zoomScale: 1
  })
  try {
    act(() => {
      current.recordInitialViewport(800)
      current.recordInitialContent(1800)
    })
    tick()
    tick()
    expect(current.initialPositionReady).toBe(false)
    act(() => current.recordInitialScroll(scroll(1000)))
    tick()
    // Markdown/layout grew after the first bottom measurement: the old position is insufficient.
    act(() => current.recordInitialContent(2000))
    tick()
    tick()
    act(() => current.recordInitialScroll(scroll(1000)))
    tick()
    tick()
    expect(current.initialPositionReady).toBe(false)
    act(() => current.recordInitialScroll(scroll(1200, 2000)))
    tick()
    tick()
    expect(current.initialPositionReady).toBe(true)
    const old = current.recordInitialScroll
    act(() => tree.update(createElement(Probe, { scope: 'b', offset: 240 })))
    expect(current.initialPositionReady).toBe(false)
    act(() => old(scroll(1000)))
    tick()
    tick()
    expect(current.initialPositionReady).toBe(false)
    act(() => current.recordInitialScroll(scroll(240)))
    tick()
    tick()
    expect(current.initialPositionReady).toBe(true)
  } finally {
    act(() => tree.unmount())
  }
})
