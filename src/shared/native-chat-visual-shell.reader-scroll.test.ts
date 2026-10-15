import { Window } from 'happy-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NATIVE_CHAT_VISUAL_READER_SCROLL_TYPE,
  buildNativeChatVisualDocument
} from './native-chat-visual-shell'

const theme = { colorScheme: 'light' as const, tokens: {} }

type ShellElement = NonNullable<ReturnType<Window['document']['getElementById']>>

type Shell = {
  sent: unknown[]
  window: Window
  byId: (id: string) => ShellElement
  root: ShellElement
  wheel: (
    target: ShellElement,
    deltaY: number,
    init?: { ctrlKey?: boolean; cancelable?: boolean }
  ) => void
}

/** Runs the shell's bootstrap in a window of its own, with the host being that same window. */
function bootShell(html: string): Shell {
  const shellWindow = new Window()
  const { document } = shellWindow
  document.body.innerHTML = html.replace(/^<body>|<\/body>$/g, '')
  const built = buildNativeChatVisualDocument({ html, channel: 'c', theme })
  const script = built.slice(
    built.indexOf('<script>') + '<script>'.length,
    built.indexOf('</script>')
  )
  const sent: unknown[] = []
  shellWindow.postMessage = (message: unknown) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === NATIVE_CHAT_VISUAL_READER_SCROLL_TYPE
    ) {
      sent.push(message)
    }
  }
  // The shell script is this module's own inline source.
  new Function('window', 'document', 'getComputedStyle', script)(
    shellWindow,
    document,
    shellWindow.getComputedStyle.bind(shellWindow)
  )
  return {
    sent,
    window: shellWindow,
    byId: (id) => {
      const element = document.getElementById(id)
      if (!element) {
        throw new Error(`no #${id}`)
      }
      return element
    },
    root: document.documentElement,
    wheel: (target, deltaY, init = {}) => {
      const event = new shellWindow.WheelEvent('wheel', {
        bubbles: true,
        composed: true,
        deltaY,
        ...init
      })
      // happy-dom's WheelEvent drops the modifier from its init.
      Object.defineProperty(event, 'ctrlKey', { value: init.ctrlKey === true })
      target.dispatchEvent(event)
      // The report waits for the dispatch to finish.
      vi.runAllTimers()
    }
  }
}

function scrollable(
  element: ShellElement,
  scrollTop: number,
  scrollHeight: number,
  clientHeight = 100
) {
  Object.defineProperties(element, {
    scrollTop: { value: scrollTop, configurable: true, writable: true },
    scrollHeight: { value: scrollHeight, configurable: true },
    clientHeight: { value: clientHeight, configurable: true }
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('visual shell reader scroll', () => {
  it('reports a wheel only once nothing in the page can scroll that way', () => {
    const shell = bootShell(
      '<body><div id="box" style="overflow-y:auto"><p id="text">chart</p></div></body>'
    )
    const box = shell.byId('box')
    const text = shell.byId('text')
    scrollable(shell.root, 0, 100)
    scrollable(box, 50, 1000)
    shell.wheel(text, -10)
    expect(shell.sent, 'the box still has content above').toEqual([])
    shell.wheel(text, 10)
    expect(shell.sent, 'and below').toEqual([])
    scrollable(box, 0, 1000)
    shell.wheel(text, -10)
    expect(shell.sent).toEqual([
      { type: NATIVE_CHAT_VISUAL_READER_SCROLL_TYPE, channel: 'c', input: 'wheel', deltaY: -10 }
    ])
    scrollable(box, 900, 1000)
    shell.wheel(text, 10)
    expect(shell.sent).toHaveLength(2)
  })

  // happy-dom does not retarget the event at the window, so only Chromium proves the composed path.
  it('sees a scroller inside a shadow root', () => {
    const shell = bootShell('<body><div id="host"></div></body>')
    scrollable(shell.root, 0, 100)
    const root = shell.byId('host').attachShadow({ mode: 'open' })
    root.innerHTML = '<div id="inner" style="overflow-y:auto"><p id="deep">chart</p></div>'
    const inner = root.getElementById('inner')
    const deep = root.getElementById('deep')
    if (!inner || !deep) {
      throw new Error('no shadow content')
    }
    scrollable(inner, 70, 1000)
    shell.wheel(deep, -10)
    expect(shell.sent).toEqual([])
    scrollable(inner, 0, 1000)
    shell.wheel(deep, -10)
    expect(shell.sent).toHaveLength(1)
  })

  it('treats a page taller than the frame as a scroller of its own, hidden scrollbar and all', () => {
    const shell = bootShell('<body><p id="text">long</p></body>')
    scrollable(shell.root, 300, 3000)
    shell.wheel(shell.byId('text'), -10)
    expect(shell.sent).toEqual([])
    scrollable(shell.root, 0, 3000)
    shell.wheel(shell.byId('text'), -10)
    expect(shell.sent).toHaveLength(1)
  })

  it('reports through a root the page hid from the reader, whatever offset it holds', () => {
    const shell = bootShell('<body><p id="text">pinned</p></body>')
    shell.root.setAttribute('style', 'overflow-y:hidden')
    scrollable(shell.root, 300, 3000)
    shell.wheel(shell.byId('text'), -10)
    expect(shell.sent).toHaveLength(1)
  })

  it('leaves a wheel the visual cancelled with the visual, wherever it cancels it', () => {
    const shell = bootShell('<body><div id="chart">chart</div></body>')
    scrollable(shell.root, 0, 100)
    const chart = shell.byId('chart')
    const cancel = (event: { preventDefault: () => void }): void => event.preventDefault()
    chart.addEventListener('wheel', cancel)
    shell.wheel(chart, -10, { cancelable: true })
    expect(shell.sent, 'cancelled on the chart').toEqual([])
    chart.removeEventListener('wheel', cancel)
    shell.wheel(chart, -10, { cancelable: true })
    expect(shell.sent, 'not cancelled').toHaveLength(1)
    // A handler the visual installs on the window runs after the shell's own.
    shell.window.addEventListener('wheel', cancel)
    shell.wheel(chart, -10, { cancelable: true })
    expect(shell.sent, 'cancelled at the window').toHaveLength(1)
  })

  it('still hears a wheel a handler stopped from bubbling, since the transcript still scrolls', () => {
    const shell = bootShell('<body><div id="chart">chart</div></body>')
    scrollable(shell.root, 0, 100)
    shell.byId('chart').addEventListener('wheel', (event) => event.stopPropagation())
    shell.wheel(shell.byId('chart'), -10)
    expect(shell.sent).toHaveLength(1)
  })

  it('keeps a zoom wheel and a still wheel to the page', () => {
    const shell = bootShell('<body><p id="text">chart</p></body>')
    scrollable(shell.root, 0, 100)
    shell.wheel(shell.byId('text'), -10, { ctrlKey: true })
    shell.wheel(shell.byId('text'), 0)
    expect(shell.sent).toEqual([])
    shell.wheel(shell.byId('text'), -10)
    expect(shell.sent, 'the same page reports a plain wheel').toHaveLength(1)
  })

  it('keeps a wheel inside a contained scroller to the page', () => {
    const shell = bootShell(
      '<body><div id="box" style="overflow-y:auto;overscroll-behavior-y:contain"><p id="text">chart</p></div></body>'
    )
    scrollable(shell.root, 0, 100)
    scrollable(shell.byId('box'), 0, 100)
    shell.wheel(shell.byId('text'), -10)
    expect(shell.sent).toEqual([])
  })

  it('reports a touch drag as it moves, even one a handler stopped from bubbling', () => {
    const shell = bootShell('<body><p id="text">chart</p></body>')
    const text = shell.byId('text')
    text.dispatchEvent(new shell.window.Event('touchmove', { bubbles: true }))
    expect(shell.sent).toEqual([
      { type: NATIVE_CHAT_VISUAL_READER_SCROLL_TYPE, channel: 'c', input: 'touch' }
    ])
    text.addEventListener('touchmove', (event) => event.stopPropagation())
    text.dispatchEvent(new shell.window.Event('touchmove', { bubbles: true }))
    expect(shell.sent).toHaveLength(2)
  })
})
