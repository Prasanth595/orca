// @vitest-environment happy-dom
import { useRef, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteBrowserGrabOverlay } from './remote-browser-grab-overlay'
import { useBrowserPageGrabAnnotations } from '../annotate/use-browser-page-grab-annotations'
import { BrowserGuestAnnotateOverlays } from '../annotate/browser-guest-annotate-overlays'
import type { BrowserOverlayViewport } from '../describe-page/browser-annotation-geometry'
import {
  useRemoteBrowserGrabMode,
  type RemoteBrowserGrabMode
} from './use-remote-browser-grab-mode'

const mocks = vi.hoisted(() => {
  const hold: { current: Promise<void> | null } = { current: null }
  const previewHold: { current: Promise<void> | null } = { current: null }
  const selectHold: { current: Promise<void> | null } = { current: null }
  const selectOutcome: { current: 'selected' | 'empty' | 'moved' } = { current: 'selected' }
  return {
    callRuntimeRpc: vi.fn(),
    hold,
    previewHold,
    selectHold,
    selectOutcome,
    tokenCurrent: { current: true },
    notice: vi.fn()
  }
})
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: mocks.callRuntimeRpc }))
const annotationStore = vi.hoisted(() => ({
  recordFeatureInteraction: vi.fn(),
  addBrowserPageAnnotation: vi.fn()
}))
vi.mock('@/store', () => ({
  useAppStore: (select: (state: typeof annotationStore) => unknown) => select(annotationStore)
}))

const context = {
  document: 'doc-1',
  viewport: { width: 1000, height: 500 },
  scroll: { x: 0, y: 0 }
}

/** A host that answers each query for the element at the hit-tested point. */
async function host(_target: unknown, method: string, params: { expression: string }) {
  if (method !== 'browser.eval') {
    throw new Error(`unexpected ${method}`)
  }
  await mocks.hold.current
  const { expression } = params
  if (expression.includes("return answer('ready'")) {
    return { result: JSON.stringify({ ...context, status: 'ready' }), origin: '' }
  }
  const [, x, y] = /elementFromPoint\((\d+), (\d+)\)/.exec(expression) ?? []
  const rect = { x: Number(x), y: Number(y), width: 10, height: 10 }
  if (expression.includes('extractPayload(el)')) {
    await mocks.selectHold.current
    if (mocks.selectOutcome.current !== 'selected') {
      const result =
        mocks.selectOutcome.current === 'empty'
          ? { ...context, status: 'empty' }
          : { ...context, status: 'stale', reason: 'scroll' }
      return { result: JSON.stringify(result), origin: '' }
    }
    const payload = {
      page: {
        sanitizedUrl: 'http://host/',
        title: '',
        viewportWidth: 1000,
        viewportHeight: 500,
        scrollX: 0,
        scrollY: 0,
        devicePixelRatio: 1,
        capturedAt: ''
      },
      target: { tagName: 'button', selector: `#at-${x}-${y}`, rectViewport: rect, rectPage: rect },
      nearbyText: [],
      ancestorPath: []
    }
    return { result: JSON.stringify({ ...context, status: 'selected', payload }), origin: '' }
  }
  await mocks.previewHold.current
  return {
    result: JSON.stringify({
      ...context,
      status: 'preview',
      target: { tagName: 'button', role: null, text: `${x},${y}`, rect }
    }),
    origin: ''
  }
}

let latest: RemoteBrowserGrabMode | null = null
let latestAnnotations: ReturnType<typeof useBrowserPageGrabAnnotations> | null = null

function Confirmation({
  grab,
  viewportRef
}: {
  grab: RemoteBrowserGrabMode
  viewportRef: React.RefObject<HTMLDivElement | null>
}) {
  const [browserOverlayViewport, setBrowserOverlayViewport] = useState<BrowserOverlayViewport>({
    scrollX: 0,
    scrollY: 0,
    version: 0
  })
  const annotations = useBrowserPageGrabAnnotations({
    browserTabId: 'page-1',
    isActive: true,
    grab,
    containerRef: viewportRef,
    webviewRef: viewportRef,
    setBrowserOverlayViewport,
    browserAnnotationsLength: 0
  })
  latestAnnotations = annotations
  return (
    <BrowserGuestAnnotateOverlays
      grab={grab}
      grabAnnotations={annotations}
      containerRef={viewportRef}
      webviewRef={viewportRef}
      browserOverlayViewport={browserOverlayViewport}
      worktreeId="wt"
      annotationSend={{
        browserAnnotations: [],
        browserAnnotationsPrompt: '',
        browserAnnotationsCopied: false,
        annotationBannerSendOpen: false,
        annotationTraySendOpen: false,
        activeGroupId: undefined,
        handleAnnotationBannerSendOpenChange: vi.fn(),
        handleAnnotationTraySendOpenChange: vi.fn(),
        handleCopyBrowserAnnotations: vi.fn(),
        handleClearBrowserAnnotations: vi.fn(),
        handleDeleteBrowserAnnotation: vi.fn(),
        handleUpdateBrowserAnnotation: vi.fn(),
        handleBrowserAnnotationsSentToAgent: vi.fn(),
        handleBrowserAnnotationsHandedOff: vi.fn()
      }}
    />
  )
}

function Harness({
  enabled,
  pageUrl = 'http://host/',
  withAnnotations = false
}: {
  enabled: boolean
  pageUrl?: string
  withAnnotations?: boolean
}): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const cssRef = useRef(null)
  const requestedRef = useRef(null)
  const grab = useRemoteBrowserGrabMode({
    enabled,
    remotePageId: 'page-1',
    pageUrl,
    runtimeWorktree: 'id:wt',
    runtimeTarget: () => ({ kind: 'environment', environmentId: 'env-1' }),
    createRemoteOperationToken: (remotePageId) => ({
      tabId: 'tab',
      environmentId: 'env-1',
      remotePageId: remotePageId ?? null,
      generation: 0
    }),
    isCurrentRemoteOperationToken: () => mocks.tokenCurrent.current,
    closeMissingRemotePage: vi.fn(),
    remoteViewportRef: viewportRef,
    remoteCssViewportSizeRef: cssRef,
    remoteViewportSizeRef: requestedRef,
    imageRef,
    frameMetadata: null,
    setPaneNotice: mocks.notice
  })
  latest = grab
  return (
    <div
      ref={(element) => {
        viewportRef.current = element
        if (element) {
          // The frame is shown at half the host's CSS size.
          element.getBoundingClientRect = () => new DOMRect(0, 0, 500, 250)
        }
      }}
    >
      <img ref={imageRef} alt="" />
      {withAnnotations ? <Confirmation grab={grab} viewportRef={viewportRef} /> : null}
      {grab.state !== 'idle' ? (
        <RemoteBrowserGrabOverlay grab={grab} frameScroll={null} onWheel={vi.fn()} />
      ) : null}
    </div>
  )
}

function evalCalls(kind: 'select' | 'preview'): string[] {
  return mocks.callRuntimeRpc.mock.calls
    .map((call) => String(call[2]?.expression ?? ''))
    .filter((expression) =>
      kind === 'select'
        ? expression.includes('extractPayload(el)')
        : expression.includes("answer('preview'")
    )
}

async function armPicker(): Promise<HTMLElement> {
  return (await armPickerView()).overlay
}

async function armPickerView(withAnnotations = false) {
  const view = render(<Harness enabled withAnnotations={withAnnotations} />)
  await act(async () => latest!.toggle())
  await act(async () => {})
  expect(latest!.status).toBe('ready')
  return { view, overlay: screen.getByTestId('remote-browser-grab-overlay') }
}

function deferred() {
  let complete: () => void = () => {
    throw new Error('Missing completion')
  }
  let fail: (error: Error) => void = () => {
    throw new Error('Missing rejection')
  }
  const promise = new Promise<void>((resolve, reject) => {
    complete = resolve
    fail = reject
  })
  return { promise, complete, fail }
}

beforeEach(() => {
  mocks.tokenCurrent.current = true
  mocks.hold.current = null
  mocks.previewHold.current = null
  mocks.selectHold.current = null
  mocks.selectOutcome.current = 'selected'
  mocks.notice.mockReset()
  annotationStore.recordFeatureInteraction.mockReset()
  annotationStore.addBrowserPageAnnotation.mockReset()
  mocks.callRuntimeRpc.mockReset()
  mocks.callRuntimeRpc.mockImplementation(host)
})

describe('remote element selection confirmation ownership', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it.each([
    { outcome: 'empty', when: 'before' },
    { outcome: 'empty', when: 'after' },
    { outcome: 'moved', when: 'before' },
    { outcome: 'moved', when: 'after' }
  ] as const)(
    'exits non-selected $outcome quarantine when the preview fails $when the answer',
    async ({ outcome, when }) => {
      await armPicker()
      const preview = deferred()
      const select = deferred()
      mocks.previewHold.current = preview.promise
      mocks.selectHold.current = select.promise
      mocks.selectOutcome.current = outcome
      await act(async () => latest!.hover({ x: 20, y: 20 }))
      await act(async () => latest!.select({ x: 150, y: 100 }, false))
      if (when === 'before') {
        await act(async () => preview.fail(new Error('preview request timed out')))
        expect(latest!.status).toBe('selecting')
      }
      await act(async () => select.complete())
      if (when === 'after') {
        expect(latest!.state).toBe('armed')
        expect(latest!.status).toBe(outcome)
        await act(async () => preview.fail(new Error('preview request timed out')))
      }
      expect(latest!.state).toBe('idle')
      expect(latest!.payload).toBeNull()
      const sent = mocks.callRuntimeRpc.mock.calls.length
      await act(async () => {
        latest!.hover({ x: 200, y: 100 })
        latest!.rearm()
        await vi.advanceTimersByTimeAsync(30_000)
      })
      expect(mocks.callRuntimeRpc.mock.calls).toHaveLength(sent)
      mocks.previewHold.current = null
      await act(async () => latest!.toggle())
      expect(latest!.status).toBe('ready')
      expect(mocks.callRuntimeRpc.mock.calls).toHaveLength(sent + 1)
    }
  )

  it.each(['before answer', 'after confirmation', 'after automatic rearm'] as const)(
    'preserves the selected payload when an obsolete preview fails %s and requires explicit rearming',
    async (when) => {
      await armPicker()
      const preview = deferred()
      const select = deferred()
      mocks.previewHold.current = preview.promise
      mocks.selectHold.current = select.promise
      await act(async () => latest!.hover({ x: 20, y: 20 }))
      await act(async () => latest!.select({ x: 150, y: 100 }, false))
      await act(async () => latest!.hover({ x: 200, y: 100 }))
      expect(evalCalls('preview')).toHaveLength(1)
      if (when !== 'before answer') {
        await act(async () => select.complete())
        expect(latest!.state).toBe('confirming')
        expect(latest!.payload?.target.selector).toBe('#at-300-200')
        if (when === 'after automatic rearm') {
          await act(async () => latest!.rearm())
        }
      }
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
        preview.fail(new Error('preview request timed out'))
      })
      if (when === 'before answer') {
        expect(latest!.status).toBe('selecting')
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2000)
          select.complete()
        })
      }
      if (when !== 'after automatic rearm') {
        expect(latest!.state).toBe('confirming')
        expect(latest!.payload?.target.selector).toBe('#at-300-200')
      }
      const sent = mocks.callRuntimeRpc.mock.calls.length
      if (when === 'after automatic rearm') {
        expect(latest!.state).toBe('idle')
        expect(mocks.notice).toHaveBeenLastCalledWith({
          kind: 'consequence',
          text: 'preview request timed out'
        })
      } else {
        expect(mocks.notice).toHaveBeenCalledExactlyOnceWith(null)
      }
      await act(async () => latest!.rearm())
      expect(latest!.state).toBe('idle')
      await act(async () => {
        latest!.hover({ x: 200, y: 100 })
        latest!.select({ x: 200, y: 100 }, false)
        latest!.rearm()
        await vi.advanceTimersByTimeAsync(30_000)
      })
      expect(mocks.callRuntimeRpc.mock.calls).toHaveLength(sent)
      mocks.previewHold.current = null
      await act(async () => latest!.toggle())
      expect(latest!.status).toBe('ready')
      expect(mocks.callRuntimeRpc.mock.calls).toHaveLength(sent + 1)
      await act(async () => latest!.hover({ x: 200, y: 100 }))
      expect(evalCalls('preview')).toHaveLength(2)
      expect(evalCalls('select')).toHaveLength(1)
    }
  )

  it('lets the select timeout cancel the picker after an obsolete preview timeout', async () => {
    await armPicker()
    const preview = deferred()
    const select = deferred()
    mocks.previewHold.current = preview.promise
    mocks.selectHold.current = select.promise
    await act(async () => latest!.hover({ x: 20, y: 20 }))
    await act(async () => latest!.select({ x: 150, y: 100 }, false))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
      preview.fail(new Error('preview request timed out'))
    })
    expect(latest!.status).toBe('selecting')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
      select.fail(new Error('select request timed out'))
    })
    expect(latest!.state).toBe('idle')
    expect(latest!.payload).toBeNull()
    expect(mocks.notice).toHaveBeenLastCalledWith({
      kind: 'consequence',
      text: 'select request timed out'
    })
    const timeouts = mocks.callRuntimeRpc.mock.calls.map((call) => call[3]?.timeoutMs)
    expect(timeouts).toEqual([15_000, 10_000, 15_000])
    await act(async () => {
      latest!.rearm()
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(mocks.callRuntimeRpc.mock.calls).toHaveLength(3)
  })

  it.each(['cancel', 'disconnect', 'supersession', 'navigation'] as const)(
    'still discards the click on %s after an obsolete preview failure',
    async (reason) => {
      const { view } = await armPickerView()
      const preview = deferred()
      const select = deferred()
      mocks.previewHold.current = preview.promise
      mocks.selectHold.current = select.promise
      await act(async () => latest!.hover({ x: 20, y: 20 }))
      await act(async () => latest!.select({ x: 150, y: 100 }, false))
      await act(async () => preview.fail(new Error('preview request timed out')))
      if (reason === 'cancel') {
        await act(async () => latest!.cancel())
      } else if (reason === 'disconnect') {
        view.rerender(<Harness enabled={false} />)
      } else if (reason === 'navigation') {
        view.rerender(<Harness enabled pageUrl="http://host/next" />)
      } else {
        mocks.tokenCurrent.current = false
      }
      await act(async () => select.complete())
      expect(latest!.state).toBe('idle')
      expect(latest!.payload).toBeNull()
      expect(evalCalls('select')).toHaveLength(1)
      expect(evalCalls('preview')).toHaveLength(1)
    }
  )

  it('retires the entire session if the operation token expired when the old preview rejects', async () => {
    await armPicker()
    const preview = deferred()
    const select = deferred()
    mocks.previewHold.current = preview.promise
    mocks.selectHold.current = select.promise
    await act(async () => latest!.hover({ x: 20, y: 20 }))
    await act(async () => latest!.select({ x: 150, y: 100 }, false))
    mocks.tokenCurrent.current = false
    await act(async () => preview.fail(new Error('request timed out')))
    expect(latest!.state).toBe('idle')
    await act(async () => select.complete())
    expect(latest!.payload).toBeNull()
  })

  it.each(['copy', 'annotate'] as const)(
    'delivers %s once after an old preview failure without the real confirmation toast starting a query',
    async (intent) => {
      const originalApi = Object.getOwnPropertyDescriptor(window, 'api')
      const writeClipboardText = vi.fn()
      Object.defineProperty(window, 'api', {
        configurable: true,
        value: { ui: { writeClipboardText } }
      })
      try {
        await armPickerView(true)
        if (intent === 'annotate') {
          await act(async () => latestAnnotations!.startGrabIntent('annotate'))
        }
        const preview = deferred()
        const select = deferred()
        mocks.previewHold.current = preview.promise
        mocks.selectHold.current = select.promise
        await act(async () => latest!.hover({ x: 20, y: 20 }))
        await act(async () => latest!.select({ x: 150, y: 100 }, false))
        await act(async () => preview.fail(new Error('preview request timed out')))
        await act(async () => select.complete())
        expect(latest!.state).toBe('confirming')
        if (intent === 'copy') {
          expect(writeClipboardText).toHaveBeenCalledOnce()
          expect(writeClipboardText.mock.calls[0]?.[0]).toContain('Selector: #at-300-200')
        } else {
          expect(writeClipboardText).not.toHaveBeenCalled()
          expect(latestAnnotations!.pendingAnnotationPayload?.target.selector).toBe('#at-300-200')
          await act(async () =>
            latestAnnotations!.handleAddBrowserAnnotation('Review this element', 'change')
          )
          expect(annotationStore.addBrowserPageAnnotation).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
              browserPageId: 'page-1',
              payload: expect.objectContaining({
                target: expect.objectContaining({ selector: '#at-300-200' })
              })
            })
          )
        }
        expect(latestAnnotations!.grabToast).toMatchObject({ x: 152.5, y: 105, below: true })
        const trigger = document.querySelector<HTMLButtonElement>(
          '[data-slot="dropdown-menu-trigger"]'
        )
        if (intent === 'copy') {
          expect(trigger?.style.left).toBe('152.5px')
          expect(trigger?.style.top).toBe('102.5px')
        }
        const sent = mocks.callRuntimeRpc.mock.calls.length
        await act(async () => vi.advanceTimersByTimeAsync(2000))
        expect(latestAnnotations!.grabToast).toBeNull()
        expect(latest!.state).toBe('idle')
        await act(async () => vi.advanceTimersByTimeAsync(30_000))
        expect(mocks.callRuntimeRpc.mock.calls).toHaveLength(sent)
        expect(writeClipboardText).toHaveBeenCalledTimes(intent === 'copy' ? 1 : 0)
        expect(annotationStore.addBrowserPageAnnotation).toHaveBeenCalledTimes(
          intent === 'annotate' ? 1 : 0
        )
      } finally {
        if (originalApi) {
          Object.defineProperty(window, 'api', originalApi)
        } else {
          Reflect.deleteProperty(window, 'api')
        }
      }
    }
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
  latest = null
  latestAnnotations = null
})

describe('remote element selection overlay', () => {
  it('selects at the release coordinates mapped into host CSS pixels, never sending input', async () => {
    const overlay = await armPicker()
    fireEvent.pointerMove(overlay, { clientX: 20, clientY: 20 })
    fireEvent.pointerDown(overlay, { clientX: 150, clientY: 100, button: 0, pointerId: 1 })
    fireEvent.pointerUp(overlay, { clientX: 150, clientY: 100, button: 0, pointerId: 1 })
    fireEvent.click(overlay, { clientX: 150, clientY: 100 })
    await act(async () => {})
    expect(evalCalls('select')).toHaveLength(1)
    expect(evalCalls('select')[0]).toContain('elementFromPoint(300, 200)')
    expect(latest!.state).toBe('confirming')
    expect(latest!.contextMenu).toBe(false)
    expect(latest!.payload?.target.selector).toBe('#at-300-200')
    const methods = new Set(mocks.callRuntimeRpc.mock.calls.map((call) => call[1]))
    expect([...methods]).toEqual(['browser.eval'])
  })

  it('opens the action menu path for a right click', async () => {
    const overlay = await armPicker()
    fireEvent.pointerDown(overlay, { clientX: 10, clientY: 10, button: 2, pointerId: 1 })
    fireEvent.pointerUp(overlay, { clientX: 10, clientY: 10, button: 2, pointerId: 1 })
    fireEvent.contextMenu(overlay)
    await act(async () => {})
    expect(latest!.contextMenu).toBe(true)
    expect(evalCalls('select')).toHaveLength(1)
  })

  it('stays inert when Escape cancels between press and release', async () => {
    const overlay = await armPicker()
    fireEvent.pointerDown(overlay, { clientX: 10, clientY: 10, button: 0, pointerId: 1 })
    fireEvent.keyDown(overlay, { key: 'Escape' })
    expect(latest!.state).toBe('idle')
    expect(screen.queryByTestId('remote-browser-grab-overlay')).toBeNull()
    expect(evalCalls('select')).toHaveLength(0)
  })

  it('ignores a release whose press began elsewhere', async () => {
    const overlay = await armPicker()
    fireEvent.pointerUp(overlay, { clientX: 10, clientY: 10, button: 0, pointerId: 1 })
    await act(async () => {})
    expect(evalCalls('select')).toHaveLength(0)
  })

  it('drops a slow selection when the pane stops being available', async () => {
    const { view, overlay } = await armPickerView()
    let release!: () => void
    mocks.hold.current = new Promise<void>((resolve) => {
      release = resolve
    })
    fireEvent.pointerDown(overlay, { clientX: 10, clientY: 10, button: 0, pointerId: 1 })
    fireEvent.pointerUp(overlay, { clientX: 10, clientY: 10, button: 0, pointerId: 1 })
    view.rerender(<Harness enabled={false} />)
    await act(async () => release())
    expect(latest!.state).toBe('idle')
    expect(latest!.payload).toBeNull()
  })

  it.each([
    ['armed', 'availability'],
    ['selecting', 'availability'],
    ['confirming', 'availability'],
    ['armed', 'URL'],
    ['selecting', 'URL'],
    ['confirming', 'URL']
  ] as const)('keeps retired %s selection idle when %s returns', async (phase, boundary) => {
    const { view } = await armPickerView()
    const pending = deferred()
    if (phase !== 'armed') {
      if (phase === 'selecting') {
        mocks.selectHold.current = pending.promise
      }
      await act(async () => latest!.select({ x: 150, y: 100 }, true))
      expect(latest!.status).toBe(phase === 'selecting' ? 'selecting' : 'selected')
    }
    const sent = mocks.callRuntimeRpc.mock.calls.length
    view.rerender(
      boundary === 'availability' ? (
        <Harness enabled={false} />
      ) : (
        <Harness enabled pageUrl="http://host/next" />
      )
    )
    expect(latest!.state).toBe('idle')
    view.rerender(<Harness enabled />)
    await act(async () => pending.complete())
    expect(latest!.state).toBe('idle')
    expect(latest!.payload).toBeNull()
    expect(latest!.contextMenu).toBe(false)
    expect(latest!.preview).toBeNull()
    expect(screen.queryByTestId('remote-browser-grab-overlay')).toBeNull()
    expect(mocks.callRuntimeRpc.mock.calls).toHaveLength(sent)

    await act(async () => latest!.toggle())
    expect(screen.getByTestId('remote-browser-grab-overlay')).toBeTruthy()
    expect(mocks.callRuntimeRpc.mock.calls).toHaveLength(sent + 1)
    await act(async () => latest!.select({ x: 10, y: 10 }, false))
    expect(latest!.payload?.target.selector).toBe('#at-20-20')
  })

  it('sends nothing once the pane epoch that armed the picker is gone', async () => {
    const overlay = await armPicker()
    const sent = mocks.callRuntimeRpc.mock.calls.length
    mocks.tokenCurrent.current = false
    fireEvent.pointerDown(overlay, { clientX: 10, clientY: 10, button: 0, pointerId: 1 })
    fireEvent.pointerUp(overlay, { clientX: 10, clientY: 10, button: 0, pointerId: 1 })
    await act(async () => {})
    expect(mocks.callRuntimeRpc.mock.calls.length).toBe(sent)
    expect(latest!.state).toBe('idle')
  })

  it('paints the hover outline scaled back into the frame', async () => {
    // happy-dom does no layout; give the overlay the frame's on-screen size.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(500)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(250)
    const overlay = await armPicker()
    fireEvent.pointerMove(overlay, { clientX: 100, clientY: 50 })
    await act(async () => {})
    await act(async () => new Promise((resolve) => setTimeout(resolve, 80)))
    const outline = screen.getByTestId('remote-browser-grab-outline')
    expect(outline.style.left).toBe('100px')
    expect(outline.style.top).toBe('50px')
    expect(outline.style.width).toBe('5px')
    expect(evalCalls('preview').length).toBeGreaterThan(0)
  })
})
