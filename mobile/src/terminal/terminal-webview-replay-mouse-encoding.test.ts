// @vitest-environment happy-dom
// A pane opened on a long-running Claude Code or Codex gets its mouse modes from a replay. xterm's
// serializer writes the tracking (?1003h) without the SGR encoding, and a screen seeded from such an
// image restates the encoding as the default (?1006l). Claude Code ignores a default-encoded click,
// so a tap could not move its prompt cursor until the program re-sent ?1006h, and Codex never
// re-sends it. These pin the reports a tap and a wheel send in each replay shape.
import { describe, expect, it, vi } from 'vitest'
import { ESC, useTerminalMouseWebViewHarness } from './terminal-webview-mouse-test-harness'

// The alternate screen of xterm's serializer image: its modes carry ?1003h and never ?1006h.
const RENDERER_REPLAY = `${ESC}[?1049h${ESC}[H> prompt${ESC}[?2004h${ESC}[?1004h${ESC}[?1003h`
// A headless screen seeded from that image restates the encoding it never saw as the default.
const SEEDED_HEADLESS_REPLAY = `${ESC}[0m${ESC}[?1049h${ESC}[?2004h${ESC}[?1003h${ESC}[?1006l${ESC}[H> prompt`
// A headless screen that watched the program enable tracking keeps its encoding.
const WATCHED_HEADLESS_REPLAY = `${ESC}[0m${ESC}[?1049h${ESC}[?2004h${ESC}[?1003h${ESC}[?1006h${ESC}[H> prompt`

const SGR_PROGRAM = { type: 'set-sgr-mouse-program', enabled: true }
// Press then release on the same cell; the cell follows the fit scale, not the routing.
const SGR_CLICK_RE = new RegExp(`^${ESC}\\[<0;(\\d+);(\\d+)M${ESC}\\[<0;\\1;\\2m$`)
const DEFAULT_CLICK_RE = new RegExp(`^${ESC}\\[M [\\s\\S]{2}${ESC}\\[M#[\\s\\S]{2}$`)

function message(data: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }))
}

function touchTap() {
  const surface = document.getElementById('terminal-surface')!
  for (const type of ['touchstart', 'touchend']) {
    const event = new Event(type, { bubbles: true, cancelable: true })
    const touches = type === 'touchend' ? [] : [{ identifier: 0, clientX: 40, clientY: 60 }]
    Object.defineProperty(event, 'touches', {
      value: touches.map((touch) => ({ ...touch, target: surface }))
    })
    Object.defineProperty(event, 'target', { value: surface })
    document.dispatchEvent(event)
  }
}

function wheel(deltaY = 120) {
  document
    .getElementById('terminal-surface')!
    .dispatchEvent(
      new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, clientX: 40, clientY: 60 })
    )
}

describe('mouse reports after a replay that lost the encoding', () => {
  const mouse = useTerminalMouseWebViewHarness()

  function bootReplay(replay: string, sgrMouseProgram: boolean) {
    // Readiness names the program before the queued init, as the controller does.
    mouse.boot(replay, sgrMouseProgram ? [SGR_PROGRAM] : [])
    mouse.showAlternateBuffer()
    mouse.activeTerminal().modes.mouseTrackingMode = 'any'
    mouse.clearPostedMessages()
  }

  function terminalTaps() {
    return mouse.postedMessages().filter((posted) => posted.type === 'terminal-tap')
  }

  it.each([
    ['the renderer image', RENDERER_REPLAY],
    ['a headless screen seeded from it', SEEDED_HEADLESS_REPLAY]
  ])('sends an SGR click from a tap on an SGR program after %s', (_name, replay) => {
    bootReplay(replay, true)

    touchTap()

    expect(mouse.terminalInputBytes()).toMatch(SGR_CLICK_RE)
    expect(terminalTaps()).toHaveLength(1)
  })

  it('keeps an unproven encoding unproven for a program not known to use SGR', () => {
    bootReplay(RENDERER_REPLAY, false)

    touchTap()

    // No click, only native focus.
    expect(mouse.terminalInputBytes()).toBe('')
    expect(terminalTaps()).toHaveLength(1)
  })

  it("keeps a replay's default encoding for a program not known to use SGR", () => {
    bootReplay(SEEDED_HEADLESS_REPLAY, false)

    touchTap()

    expect(mouse.terminalInputBytes()).toMatch(DEFAULT_CLICK_RE)
  })

  it('trusts an SGR encoding the replay did carry', () => {
    bootReplay(WATCHED_HEADLESS_REPLAY, false)

    touchTap()

    expect(mouse.terminalInputBytes()).toMatch(SGR_CLICK_RE)
  })

  it("lets the program's own live bytes decide the encoding", () => {
    bootReplay(SEEDED_HEADLESS_REPLAY, true)
    message({ type: 'write', data: `${ESC}[?1006l` })

    touchTap()

    expect(mouse.terminalInputBytes()).toMatch(DEFAULT_CLICK_RE)
  })

  it('learns the program after the replay was already applied', () => {
    bootReplay(RENDERER_REPLAY, false)
    message(SGR_PROGRAM)

    touchTap()

    expect(mouse.terminalInputBytes()).toMatch(SGR_CLICK_RE)
  })

  it('sends SGR wheel reports instead of scrolling a local buffer the program does not own', () => {
    bootReplay(RENDERER_REPLAY, true)
    const scrollLines = vi.spyOn(mouse.activeTerminal(), 'scrollLines')

    wheel()

    expect(scrollLines).not.toHaveBeenCalled()
    expect(mouse.terminalInputBytes()).toMatch(new RegExp(`^(${ESC}\\[<65;\\d+;\\d+M)+$`))
  })
})
