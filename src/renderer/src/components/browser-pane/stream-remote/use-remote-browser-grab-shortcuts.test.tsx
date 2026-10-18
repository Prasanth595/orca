// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GrabModeState } from '../annotate/useGrabMode'
import type { BrowserChromeShortcutScope } from '../describe-page/browser-page-types'
import { useRemoteBrowserGrabShortcuts } from './use-remote-browser-grab-shortcuts'

vi.mock('@/store', () => ({
  useAppStore: (select: (state: { keybindings: Record<string, never> }) => unknown) =>
    select({ keybindings: {} })
}))

function Harness({
  id = 'main',
  scope = 'focused',
  state = 'armed',
  cancel
}: {
  id?: string
  scope?: BrowserChromeShortcutScope
  state?: GrabModeState
  cancel: () => void
}) {
  useRemoteBrowserGrabShortcuts({
    workspaceId: id,
    chromeShortcutScope: scope,
    available: true,
    grabState: state,
    cancelGrab: cancel,
    startGrabIntent: vi.fn()
  })
  return (
    <div data-browser-overlay-tab-id={id}>
      <button data-testid={`${id}-toolbar`}>Annotate</button>
      <button data-testid={`${id}-trigger`} aria-hidden tabIndex={-1} />
      <textarea data-testid={`${id}-editor`} />
    </div>
  )
}

function escape(target: HTMLElement): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  act(() => target.dispatchEvent(event))
  return event
}

afterEach(() => cleanup())

describe('remote picker Escape ownership', () => {
  it.each(['toolbar', 'trigger', 'body'])(
    'cancels an armed picker after focus stays on %s',
    (target) => {
      const cancel = vi.fn()
      render(<Harness cancel={cancel} />)
      const element = target === 'body' ? document.body : screen.getByTestId(`main-${target}`)
      element.focus()
      expect(escape(element).defaultPrevented).toBe(true)
      expect(cancel).toHaveBeenCalledOnce()
    }
  )

  it.each(['confirming', 'idle'] as const)('leaves %s Escape to its existing owner', (state) => {
    const cancel = vi.fn()
    render(<Harness state={state} cancel={cancel} />)
    expect(escape(screen.getByTestId('main-trigger')).defaultPrevented).toBe(false)
    expect(cancel).not.toHaveBeenCalled()
  })

  it('preserves editor Escape while the picker is armed', () => {
    const cancel = vi.fn()
    render(<Harness cancel={cancel} />)
    expect(escape(screen.getByTestId('main-editor')).defaultPrevented).toBe(false)
    expect(cancel).not.toHaveBeenCalled()
  })

  it('keeps floating browser Escape out of the focused split', () => {
    const main = vi.fn()
    const floating = vi.fn()
    render(
      <>
        <Harness cancel={main} />
        <div data-floating-terminal-panel>
          <Harness id="floating" scope="owned-target" cancel={floating} />
        </div>
      </>
    )
    escape(screen.getByTestId('floating-toolbar'))
    expect(floating).toHaveBeenCalledOnce()
    expect(main).not.toHaveBeenCalled()
    escape(screen.getByTestId('main-toolbar'))
    expect(main).toHaveBeenCalledOnce()
    expect(floating).toHaveBeenCalledOnce()
  })

  it('leaves unrelated body and inactive-pane Escape alone', () => {
    const floating = vi.fn()
    const inactive = vi.fn()
    render(
      <>
        <Harness id="floating" scope="owned-target" cancel={floating} />
        <Harness id="inactive" scope="inactive" cancel={inactive} />
      </>
    )
    expect(escape(document.body).defaultPrevented).toBe(false)
    expect(floating).not.toHaveBeenCalled()
    expect(inactive).not.toHaveBeenCalled()
  })
})
