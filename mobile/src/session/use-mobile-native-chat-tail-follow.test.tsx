import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { FlatList } from 'react-native'
import { useMobileNativeChatTailFollow } from './use-mobile-native-chat-tail-follow'
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))
let tree: ReactTestRenderer | undefined
let scroll!: ReturnType<typeof useMobileNativeChatTailFollow<string>>
const nativeList = { scrollToEnd: vi.fn(), scrollToOffset: vi.fn() }
const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0
const rows = ['cached']
function Harness({ scope }: { scope: string }) {
  scroll = useMobileNativeChatTailFollow({ items: rows, scopeKey: scope })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook calls only these two native methods in this harness.
  scroll.listRef.current = nativeList as unknown as FlatList<string>
  return null
}
function render(scope: string) {
  act(() => {
    if (tree) {
      tree.update(createElement(Harness, { scope }))
    } else {
      tree = create(createElement(Harness, { scope }))
    }
  })
}
function tick() {
  act(() => {
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach((frame) => frame(0))
  })
}
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => {
    frames.set(++nextFrame, frame)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})
afterEach(() => {
  act(() => tree?.unmount())
  tree = undefined
  frames.clear()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
it('returns to each cached chat following the latest even after the reader scrolled away', () => {
  render('a')
  act(() => scroll.beginUserScroll())
  render('b')
  render('a')
  nativeList.scrollToOffset.mockClear()
  act(() => scroll.pinToTailAfterContentResize(400, 2000))
  expect(scroll.followingLatest).toBe(true)
  expect(nativeList.scrollToOffset).toHaveBeenLastCalledWith({ animated: false, offset: 2000 })
})
it('coalesces a merged transcript layout into one nonanimated pin at the last measured end', () => {
  render('a')
  act(() => {
    scroll.pinToTail({ nativeEvent: { layout: { height: 800 } } })
    scroll.pinToTailAfterContentResize(400, 400)
  })
  tick()
  tick()
  tick()
  nativeList.scrollToOffset.mockClear()
  act(() => {
    scroll.pinToTailAfterContentResize(400, 1000)
    scroll.pinToTailAfterContentResize(400, 1500)
    scroll.pinToTailAfterContentResize(400, 2000)
  })
  expect(nativeList.scrollToOffset).not.toHaveBeenCalled()
  tick()
  expect(nativeList.scrollToOffset).toHaveBeenCalledExactlyOnceWith({
    animated: false,
    offset: 2000
  })
})
it('discards an old tab pin and pauses pending follow when the reader opens Process', () => {
  render('a')
  const stale = scroll.pinToTailAfterContentResize
  render('b')
  nativeList.scrollToOffset.mockClear()
  stale(400, 9000)
  act(() => scroll.pauseForDisclosure())
  scroll.pinToTailAfterContentResize(400, 4000)
  expect(nativeList.scrollToOffset).not.toHaveBeenCalled()
  scroll.restoreReadingOffset(180)
  expect(nativeList.scrollToOffset).toHaveBeenLastCalledWith({ animated: false, offset: 180 })
})
