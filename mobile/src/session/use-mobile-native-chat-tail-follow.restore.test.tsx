import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import type { FlatList } from 'react-native'
import {
  MobileChatScrollPositions,
  type MobileChatScrollPosition
} from './mobile-chat-scroll-position'
import { useMobileNativeChatTailFollow } from './use-mobile-native-chat-tail-follow'
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))
let tree: ReactTestRenderer | undefined
let scroll: ReturnType<typeof useMobileNativeChatTailFollow<string>>
const positions = new Map<string, MobileChatScrollPosition>()
const nativeList = { scrollToEnd: vi.fn(), scrollToOffset: vi.fn() }
function Harness({ scope }: { scope: string }) {
  scroll = useMobileNativeChatTailFollow<string>({ hasItems: true, scopeKey: scope })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this hook only calls these two native list methods.
  scroll.listRef.current = nativeList as unknown as FlatList<string>
  return null
}
function render(scope: string) {
  const view = createElement(
    MobileChatScrollPositions.Provider,
    { value: positions },
    createElement(Harness, { scope })
  )
  act(() => {
    if (tree) {
      tree.update(view)
    } else {
      tree = create(view)
    }
  })
}
afterEach(() => {
  act(() => tree?.unmount())
  tree = undefined
  positions.clear()
  vi.clearAllMocks()
})
it('restores a detached reading offset when returning to a tab and rejects its old pin callback', () => {
  render('a')
  act(() => {
    scroll.beginUserScroll()
    scroll.recordScrollMetrics({
      contentOffset: { x: 0, y: 125 },
      contentSize: { width: 400, height: 2000 },
      layoutMeasurement: { width: 400, height: 800 },
      contentInset: { top: 0, bottom: 0, left: 0, right: 0 },
      zoomScale: 1
    })
  })
  const oldPin = scroll.pinToTail
  const oldReaderIsScrolling = scroll.readerIsScrolling
  render('b')
  act(() => scroll.beginUserScroll())
  expect(oldReaderIsScrolling()).toBe(false)
  nativeList.scrollToEnd.mockClear()
  oldPin()
  expect(nativeList.scrollToEnd).not.toHaveBeenCalled()
  render('a')
  scroll.pinToTailAfterContentResize(400, 2200)
  expect(nativeList.scrollToOffset).toHaveBeenLastCalledWith({ animated: false, offset: 125 })
})
it('starts an external open at the tail without another route reading position', () => {
  render('a')
  scroll.pinToTail()
  expect(nativeList.scrollToEnd).toHaveBeenCalledWith({ animated: false })
})
it('pauses tail following before disclosure layout changes and restores through the same owner', () => {
  render('a')
  nativeList.scrollToOffset.mockClear()
  act(() => scroll.pauseForDisclosure())
  scroll.pinToTailAfterContentResize(400, 4000)
  expect(nativeList.scrollToOffset).not.toHaveBeenCalled()
  scroll.restoreReadingOffset(180)
  expect(nativeList.scrollToOffset).toHaveBeenLastCalledWith({ animated: false, offset: 180 })
  const stale = scroll.restoreReadingOffset
  render('b')
  nativeList.scrollToOffset.mockClear()
  stale(900)
  expect(nativeList.scrollToOffset).not.toHaveBeenCalled()
})
