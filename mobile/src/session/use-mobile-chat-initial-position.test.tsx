import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import type { NativeScrollEvent } from 'react-native'
import { useMobileChatInitialPosition } from './use-mobile-chat-initial-position'
let current!: ReturnType<typeof useMobileChatInitialPosition>
function Probe({ scope }: { scope: string }) {
  current = useMobileChatInitialPosition(scope)
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
    act(() => tree.update(createElement(Probe, { scope: 'b' })))
    expect(current.initialPositionReady).toBe(false)
    act(() => old(scroll(1000)))
    tick()
    tick()
    expect(current.initialPositionReady).toBe(false)
    act(() => current.recordInitialScroll(scroll(1000)))
    tick()
    tick()
    expect(current.initialPositionReady).toBe(true)
  } finally {
    act(() => tree.unmount())
  }
})

it('reveals a short cached transcript after stable geometry', () => {
  const frames = new Map<number, FrameRequestCallback>()
  let nextId = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextId, callback)
    return nextId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  let tree!: ReturnType<typeof create>
  act(() => {
    tree = create(createElement(Probe, { scope: 'stable' }))
  })
  try {
    act(() => {
      current.recordInitialViewport(800)
      current.recordInitialContent(400)
    })
    for (let i = 0; i < 5; i++) {
      act(() => {
        current.recordInitialContent(400)
        const pending = [...frames.values()]
        frames.clear()
        pending.forEach((callback) => callback(0))
      })
    }
    expect(current.initialPositionReady).toBe(true)
  } finally {
    act(() => tree.unmount())
  }
})

it('uses a scroll measurement that arrives before its matching content-size callback', () => {
  const frames = new Map<number, FrameRequestCallback>()
  let nextId = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextId, callback)
    return nextId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  let tree!: ReturnType<typeof create>
  act(() => {
    tree = create(createElement(Probe, { scope: 'long-cached-chat' }))
  })
  try {
    act(() => {
      current.recordInitialViewport(800)
      current.recordInitialContent(1800)
      current.recordInitialScroll({
        contentOffset: { x: 0, y: 1200 },
        contentSize: { width: 400, height: 2000 },
        layoutMeasurement: { width: 400, height: 800 },
        contentInset: { top: 0, right: 0, bottom: 0, left: 0 },
        zoomScale: 1
      })
      current.recordInitialContent(2000)
    })
    for (let i = 0; i < 2; i++) {
      act(() => {
        const pending = [...frames.values()]
        frames.clear()
        pending.forEach((callback) => callback(0))
      })
    }
    expect(current.initialPositionReady).toBe(true)
  } finally {
    act(() => tree.unmount())
  }
})
