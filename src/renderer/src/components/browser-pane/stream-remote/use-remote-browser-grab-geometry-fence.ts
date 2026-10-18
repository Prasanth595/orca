import { useEffect } from 'react'
import type { BrowserScreencastFrameMetadata } from '../../../../../shared/browser-screencast-protocol'

/**
 * Retires hover previews whenever what is on screen stops matching the host's layout: a resized
 * pane, or a frame with another size, zoom or scroll. A new frame with the same geometry does not
 * count, or an animated page would starve previews forever.
 */
export function useRemoteBrowserGrabGeometryFence({
  active,
  frameMetadata,
  remoteViewportRef,
  invalidateGeometry
}: {
  active: boolean
  frameMetadata: BrowserScreencastFrameMetadata | null
  remoteViewportRef: React.RefObject<HTMLDivElement | null>
  invalidateGeometry: () => void
}): void {
  const geometryKey = [
    frameMetadata?.deviceWidth,
    frameMetadata?.deviceHeight,
    frameMetadata?.pageScaleFactor,
    frameMetadata?.scrollOffsetX,
    frameMetadata?.scrollOffsetY
  ].join(':')
  useEffect(() => {
    invalidateGeometry()
  }, [geometryKey, invalidateGeometry])
  useEffect(() => {
    const container = remoteViewportRef.current
    if (!active || !container || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(() => invalidateGeometry())
    observer.observe(container)
    return () => observer.disconnect()
  }, [active, invalidateGeometry, remoteViewportRef])
}
