import { createElement, type RefObject } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { useMobileNativeChatTranscriptRef } from './use-mobile-native-chat-transcript-ref'

class PageElement {
  toggleAttribute = vi.fn()
}
type List = { getNativeScrollRef: () => unknown }
const listRef: RefObject<List | null> = { current: null }
let renderer: ReactTestRenderer | undefined

function Result(_props: { attach: (list: List | null) => void }): null {
  return null
}
function Harness({ ready }: { ready: boolean }) {
  return createElement(Result, { attach: useMobileNativeChatTranscriptRef(listRef, ready) })
}
function render(ready: boolean) {
  act(() => {
    if (renderer) {
      renderer.update(createElement(Harness, { ready }))
    } else {
      renderer = create(createElement(Harness, { ready }))
    }
  })
  return renderer!.root.findByType(Result).props.attach
}

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
  listRef.current = null
  vi.unstubAllGlobals()
})

it('blocks hidden page controls and enables them when layout is ready', () => {
  vi.stubGlobal('HTMLElement', PageElement)
  const node = new PageElement()
  const list = { getNativeScrollRef: () => node }
  render(false)(list)
  expect(listRef.current).toBe(list)
  expect(node.toggleAttribute).toHaveBeenLastCalledWith('inert', true)
  render(true)(list)
  expect(node.toggleAttribute).toHaveBeenLastCalledWith('inert', false)
})

it('also blocks a list mounted after loading or replacing another hidden tab', () => {
  vi.stubGlobal('HTMLElement', PageElement)
  const attach = render(false)
  const node = new PageElement()
  attach(null)
  attach({ getNativeScrollRef: () => node })
  expect(node.toggleAttribute).toHaveBeenCalledWith('inert', true)
})

it('retains native list refs without requiring a DOM', () => {
  vi.stubGlobal('HTMLElement', undefined)
  const list = { getNativeScrollRef: () => ({}) }
  render(false)(list)
  expect(listRef.current).toBe(list)
  render(true)(null)
  expect(listRef.current).toBeNull()
})
