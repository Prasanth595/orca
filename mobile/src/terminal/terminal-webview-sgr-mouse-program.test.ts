import { createElement, createRef } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalWebView } from './TerminalWebView'
import type { TerminalWebViewHandle } from './terminal-webview-contract'

// Mocked react-native components are string tags that ReactTestInstance's ElementType omits.
function hostType(node: ReactTestInstance): unknown {
  return node.type
}

const nativeWebViewMethods = vi.hoisted(() => ({
  postMessage: vi.fn<(message: string) => void>(),
  reload: vi.fn<() => void>()
}))

vi.mock('react-native', () => ({
  AppState: { currentState: 'active' },
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  StyleSheet: {
    absoluteFillObject: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
    create: (styles: unknown) => styles
  },
  Text: 'Text',
  View: 'View'
}))

vi.mock('react-native-webview', async () => {
  const React = await import('react')
  const WebView = React.forwardRef((props: Record<string, unknown>, ref) => {
    React.useImperativeHandle(ref, () => nativeWebViewMethods)
    return React.createElement('WebView', props)
  })
  return { WebView, default: WebView }
})

vi.mock('lucide-react-native', () => ({ RefreshCw: 'RefreshCw' }))

// Why: mounting TerminalWebView arms the web-ready watchdog; tests must unmount so it can't fire later.
let activeRenderer: ReactTestRenderer | null = null

function render(props: Record<string, unknown>) {
  act(() => {
    activeRenderer = create(createElement(TerminalWebView, props))
  })
  return activeRenderer!
}

function rerender(renderer: ReactTestRenderer, props: Record<string, unknown>) {
  act(() => {
    renderer.update(createElement(TerminalWebView, props))
  })
}

function webView(renderer: ReactTestRenderer) {
  return renderer.root.find((node) => hostType(node) === 'WebView')
}

function webReady(renderer: ReactTestRenderer) {
  act(() => {
    webView(renderer).props.onMessage({
      nativeEvent: { data: JSON.stringify({ type: 'web-ready' }) }
    })
  })
}

function postedCommands(): Array<Record<string, unknown>> {
  return nativeWebViewMethods.postMessage.mock.calls.map(([message]) => JSON.parse(message))
}

function sgrMouseProgramCommands() {
  return postedCommands()
    .filter((command) => command.type === 'set-sgr-mouse-program')
    .map((command) => command.enabled)
}

describe('TerminalWebView SGR mouse program', () => {
  afterEach(() => {
    act(() => {
      activeRenderer?.unmount()
    })
    activeRenderer = null
    vi.clearAllMocks()
  })

  it('names an SGR program to a ready document before the init it queued', () => {
    const ref = createRef<TerminalWebViewHandle>()
    const renderer = render({ ref, sgrMouseProgram: true })
    act(() => {
      ref.current?.init({ cols: 80, rows: 24, initialData: '', frame: null })
    })

    webReady(renderer)

    const types = postedCommands().map((command) => command.type)
    expect(sgrMouseProgramCommands()).toEqual([true])
    expect(types.indexOf('set-sgr-mouse-program')).toBeLessThan(types.indexOf('init'))
  })

  it('waits for readiness instead of queueing a change made before it', () => {
    const renderer = render({ sgrMouseProgram: false })
    rerender(renderer, { sgrMouseProgram: true })
    expect(sgrMouseProgramCommands()).toEqual([])

    webReady(renderer)

    expect(sgrMouseProgramCommands()).toEqual([true])
  })

  it('tells a ready document once per change of program', () => {
    const renderer = render({ sgrMouseProgram: false })
    webReady(renderer)
    expect(sgrMouseProgramCommands()).toEqual([])

    rerender(renderer, { sgrMouseProgram: true })
    rerender(renderer, { sgrMouseProgram: true })
    rerender(renderer, { sgrMouseProgram: false })

    expect(sgrMouseProgramCommands()).toEqual([true, false])
  })

  it('names the program again to the document that replaces a lost one', () => {
    const renderer = render({ sgrMouseProgram: true })
    webReady(renderer)
    act(() => {
      webView(renderer).props.onContentProcessDidTerminate()
    })

    webReady(renderer)

    expect(sgrMouseProgramCommands()).toEqual([true, true])
  })
})
