import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'
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
      target.dispatchEvent(new shellWindow.WheelEvent('wheel', { bubbles: true, deltaY, ...init }))
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

  it('treats a page taller than the frame as a scroller of its own, hidden scrollbar and all', () => {
    const shell = bootShell('<body><p id="text">long</p></body>')
    scrollable(shell.root, 300, 3000)
    shell.wheel(shell.byId('text'), -10)
    expect(shell.sent).toEqual([])
    scrollable(shell.root, 0, 3000)
    shell.wheel(shell.byId('text'), -10)
    expect(shell.sent).toHaveLength(1)
  })

  it('leaves a wheel the visual cancelled with the visual, as a chart zoom does', () => {
    const shell = bootShell('<body><div id="chart">chart</div></body>')
    scrollable(shell.root, 0, 100)
    const chart = shell.byId('chart')
    chart.addEventListener('wheel', (event) => event.preventDefault())
    shell.wheel(chart, -10, { cancelable: true })
    expect(shell.sent).toEqual([])
    chart.dispatchEvent(new shell.window.WheelEvent('wheel', { bubbles: true, deltaY: -10 }))
    expect(shell.sent).toHaveLength(1)
  })

  it('keeps a zoom wheel, a still wheel, and a contained scroller to the page', () => {
    const shell = bootShell(
      '<body><div id="box" style="overflow-y:auto;overscroll-behavior-y:contain"><p id="text">chart</p></div></body>'
    )
    scrollable(shell.root, 0, 100)
    scrollable(shell.byId('box'), 0, 100)
    shell.wheel(shell.byId('text'), -10)
    expect(shell.sent, 'contained').toEqual([])
    shell.wheel(shell.byId('text'), -10, { ctrlKey: true })
    shell.wheel(shell.byId('text'), 0)
    expect(shell.sent).toEqual([])
  })

  it('reports a touch drag as it moves', () => {
    const shell = bootShell('<body><p id="text">chart</p></body>')
    shell.byId('text').dispatchEvent(new shell.window.Event('touchmove', { bubbles: true }))
    expect(shell.sent).toEqual([
      { type: NATIVE_CHAT_VISUAL_READER_SCROLL_TYPE, channel: 'c', input: 'touch' }
    ])
  })
})
