import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { MermaidDiagram } from './MermaidDiagram'
import { MobileTranscriptLayoutContext } from '../mobile-transcript-layout'

vi.mock('react-native', () => ({
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 }
}))
vi.mock('react-native-webview', () => ({ WebView: 'WebView' }))
let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => renderer?.unmount())
  vi.useRealTimers()
})

function mount() {
  const release = vi.fn()
  const register = vi.fn(() => release)
  act(() => {
    renderer = create(
      createElement(
        MobileTranscriptLayoutContext.Provider,
        { value: register },
        createElement(MermaidDiagram, { source: 'graph LR; A-->B', base: 13 })
      )
    )
  })
  return { register, release }
}

it('holds the initial reveal until the rendered diagram reports its height', () => {
  const { register, release } = mount()
  expect(register).toHaveBeenCalledOnce()
  expect(release).not.toHaveBeenCalled()
  act(() =>
    renderer!.root
      .find((node) => String(node.type) === 'WebView')
      .props.onMessage({
        nativeEvent: { data: '240' }
      })
  )
  expect(release).toHaveBeenCalledOnce()
})

it('releases an unresponsive renderer and falls back to source instead of blocking the transcript', () => {
  vi.useFakeTimers()
  const { release } = mount()
  act(() => {
    vi.advanceTimersByTime(10_000)
  })
  expect(release).toHaveBeenCalledOnce()
  expect(renderer!.root.findAll((node) => String(node.type) === 'WebView')).toHaveLength(0)
  expect(
    renderer!.root
      .findAll((node) => String(node.type) === 'Text')
      .some((node) => node.props.children === 'graph LR; A-->B')
  ).toBe(true)
})
