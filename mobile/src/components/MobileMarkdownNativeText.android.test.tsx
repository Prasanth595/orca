import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { applyMobileColorScheme, darkColors, lightColors } from '../theme/mobile-theme'
const native = vi.hoisted(() => ({ available: true, decorateText: vi.fn() }))
vi.mock('./mobile-markdown-native-code', () => ({
  get nativeMarkdownCode() {
    return native.available ? native : null
  }
}))
vi.mock('react-native', () => ({ Text: 'Text', findNodeHandle: () => 17 }))
import { MobileMarkdownNativeText } from './MobileMarkdownNativeText.android'
let tree: ReactTestRenderer | null = null
let sequence = 0
const frames = new Map<number, FrameRequestCallback>()
beforeEach(() => {
  native.available = true
  native.decorateText.mockReset().mockResolvedValue({ applied: true, height: 32 })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback)
    return sequence
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})
afterEach(() => {
  act(() => tree?.unmount())
  tree = null
  applyMobileColorScheme('dark')
  frames.clear()
  vi.unstubAllGlobals()
})
async function paint() {
  await act(async () => {
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) {
      callback(0)
    }
    await Promise.resolve()
  })
}
function render() {
  act(() => {
    tree = create(
      createElement(
        MobileMarkdownNativeText,
        { selectable: true },
        'Use ',
        createElement('Text', { inlineCode: true }, 'src/a.ts')
      ),
      { createNodeMock: () => ({ tag: 17 }) }
    )
  })
}
it('passes original text and offsets to native and repaints both theme directions', async () => {
  render()
  await paint()
  expect(native.decorateText).toHaveBeenLastCalledWith(
    17,
    'Use src/a.ts',
    [{ start: 4, end: 12 }],
    darkColors.bgRaised,
    4,
    4,
    1
  )
  act(() => applyMobileColorScheme('light'))
  await paint()
  expect(native.decorateText.mock.lastCall?.[3]).toBe(lightColors.bgRaised)
  act(() => applyMobileColorScheme('dark'))
  await paint()
  expect(native.decorateText.mock.lastCall?.[3]).toBe(darkColors.bgRaised)
  expect(tree!.root.findAll((node) => String(node.type) === 'Text')[0].props.selectable).toBe(true)
})
it('does not retain the old native height when streamed content loses its code span', async () => {
  render()
  await paint()
  act(() => tree!.update(createElement(MobileMarkdownNativeText, null, 'Done')))
  await paint()
  expect(
    JSON.stringify(tree!.root.findAll((node) => String(node.type) === 'Text')[0].props.style)
  ).not.toContain('minHeight')
})
it('keeps ordinary native text working on older shells without the module', async () => {
  native.available = false
  render()
  await paint()
  expect(native.decorateText).not.toHaveBeenCalled()
  expect(tree!.toJSON()).toBeTruthy()
})
