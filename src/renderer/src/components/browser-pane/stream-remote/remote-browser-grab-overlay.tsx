import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { BrowserGrabRect } from '../../../../../shared/browser-grab-types'
import type { RemoteGrabPoint } from '../../../../../shared/browser-grab/remote-grab-point-script'
import { mapRemoteRectToFrame, sameRemoteScroll } from './remote-browser-grab-geometry'
import type { RemoteBrowserGrabMode } from './use-remote-browser-grab-mode'
import { remoteBrowserGrabStatusMessage } from './remote-browser-grab-status'

type OutlineBox = { rect: BrowserGrabRect; label: string | null }

function previewLabel(target: {
  tagName: string
  role: string | null
  text: string
  rect: BrowserGrabRect
}): string {
  const parts = [target.tagName]
  if (target.role) {
    parts.push(`role=${target.role}`)
  }
  if (target.text) {
    parts.push(`"${target.text}"`)
  }
  parts.push(`${Math.round(target.rect.width)}x${Math.round(target.rect.height)}`)
  return parts.join('  ')
}

/**
 * Catches every pointer gesture over the streamed frame while the picker is armed, so the remote
 * page never receives input, and paints the hover/selection outline locally instead of in the
 * page, where it would lag by a full frame round trip.
 */
export function RemoteBrowserGrabOverlay({
  grab,
  frameScroll,
  onWheel
}: {
  grab: RemoteBrowserGrabMode
  frameScroll: RemoteGrabPoint | null
  onWheel: (event: WheelEvent) => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const pressRef = useRef<{ pointerId: number; button: number } | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }
    const measure = (): void =>
      setSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])

  // Why: React wheel listeners are passive in Chromium, so preventDefault needs a native binding.
  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }
    const handleWheel = (event: WheelEvent): void => {
      grab.invalidateGeometry()
      onWheel(event)
    }
    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => element.removeEventListener('wheel', handleWheel)
  }, [grab, onWheel])

  let outline: OutlineBox | null = null
  if (size && grab.payload) {
    const page = grab.payload.page
    const rect = mapRemoteRectToFrame(grab.payload.target.rectViewport, size, {
      width: page.viewportWidth,
      height: page.viewportHeight
    })
    // Why: once the frame shows another scroll position the box would sit over the wrong element.
    if (rect && sameRemoteScroll({ x: page.scrollX, y: page.scrollY }, frameScroll)) {
      outline = { rect, label: null }
    }
  } else if (size && grab.preview && sameRemoteScroll(grab.preview.scroll, frameScroll)) {
    const rect = mapRemoteRectToFrame(grab.preview.target.rect, size, grab.preview.viewport)
    if (rect) {
      outline = { rect, label: previewLabel(grab.preview.target) }
    }
  }
  const labelBelow = outline
    ? outline.rect.y + outline.rect.height + 28 < (size?.height ?? 0)
    : true

  return (
    <div
      ref={ref}
      data-testid="remote-browser-grab-overlay"
      tabIndex={-1}
      className="absolute inset-0 z-10 cursor-crosshair overflow-hidden outline-none"
      onPointerMove={(event) => grab.hover({ x: event.clientX, y: event.clientY })}
      onPointerLeave={() => grab.leave()}
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        ref.current?.focus({ preventScroll: true })
        if (event.button !== 0 && event.button !== 2) {
          return
        }
        pressRef.current = { pointerId: event.pointerId, button: event.button }
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }}
      onPointerUp={(event) => {
        event.preventDefault()
        event.stopPropagation()
        const press = pressRef.current
        pressRef.current = null
        // Why: only a press that began here selects, so a cancel between down and up stays inert.
        if (press?.pointerId === event.pointerId && press.button === event.button) {
          grab.select({ x: event.clientX, y: event.clientY }, event.button === 2)
        }
      }}
      onPointerCancel={() => {
        pressRef.current = null
      }}
      onClick={(event) => event.preventDefault()}
      onDoubleClick={(event) => event.preventDefault()}
      onAuxClick={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          grab.cancel()
        }
      }}
    >
      {outline ? (
        <div
          data-testid="remote-browser-grab-outline"
          className="pointer-events-none absolute rounded-sm border-2 border-ring bg-ring/10"
          style={{
            left: outline.rect.x,
            top: outline.rect.y,
            width: outline.rect.width,
            height: outline.rect.height
          }}
        />
      ) : null}
      {outline?.label ? (
        <div
          className="pointer-events-none absolute max-w-xs truncate rounded-sm border border-border bg-popover px-2 py-0.5 font-mono text-2xs text-popover-foreground shadow-xs"
          style={{
            left: Math.max(4, outline.rect.x),
            top: labelBelow ? outline.rect.y + outline.rect.height + 6 : outline.rect.y - 28
          }}
        >
          {outline.label}
        </div>
      ) : null}
      {grab.state === 'armed' ? (
        <div
          className="absolute top-3 left-1/2 flex max-w-md -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onPointerMove={(event) => event.stopPropagation()}
        >
          {grab.slow ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : null}
          <span role="status" aria-live="polite">
            {remoteBrowserGrabStatusMessage(grab.status)}
          </span>
          <Button size="xs" variant="ghost" onClick={grab.cancel}>
            {translate('auto.components.browser.pane.GrabConfirmationSheet.87d97bdd6d', 'Cancel')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
