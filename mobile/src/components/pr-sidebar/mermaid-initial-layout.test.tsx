import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { applyMobileColorScheme } from '../../theme/mobile-theme'
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
  act(() => applyMobileColorScheme('dark'))
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
  const update = (source: string) =>
    act(() =>
      renderer!.update(
        createElement(
          MobileTranscriptLayoutContext.Provider,
          { value: register },
          createElement(MermaidDiagram, { source, base: 13 })
        )
      )
    )
  return { register, release, update }
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

it('resets a changed document, ignores old callbacks, and times out the new render', () => {
  vi.useFakeTimers()
  const { register, release, update } = mount()
  const old = renderer!.root.find((node) => String(node.type) === 'WebView').props
  act(() => old.onMessage({ nativeEvent: { data: '240' } }))
  update('graph LR; B-->C')
  expect(register).toHaveBeenCalledTimes(2)
  act(() => {
    old.onMessage({ nativeEvent: { data: '480' } })
    old.onError()
  })
  const current = renderer!.root.find((node) => String(node.type) === 'WebView')
  expect(JSON.stringify(current.props.style)).toContain('120')
  act(() => {
    vi.advanceTimersByTime(10_000)
  })
  expect(release).toHaveBeenCalledTimes(2)
  expect(renderer!.root.findAll((node) => String(node.type) === 'WebView')).toHaveLength(0)
  expect(
    renderer!.root
      .findAll((node) => String(node.type) === 'Text')
      .some((node) => node.props.children === 'graph LR; B-->C')
  ).toBe(true)
})
it('restarts a failed diagram when its theme changes', () => {
  const { register } = mount()
  act(() => renderer!.root.find((node) => String(node.type) === 'WebView').props.onError())
  act(() => applyMobileColorScheme('light'))
  expect(register).toHaveBeenCalledTimes(2)
  expect(renderer!.root.findAll((node) => String(node.type) === 'WebView')).toHaveLength(1)
})
