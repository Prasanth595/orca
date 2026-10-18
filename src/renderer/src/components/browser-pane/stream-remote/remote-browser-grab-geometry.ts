import type { BrowserGrabRect } from '../../../../../shared/browser-grab-types'
import type { BrowserScreencastFrameMetadata } from '../../../../../shared/browser-screencast-protocol'
import type {
  RemoteGrabPoint,
  RemoteGrabViewport
} from '../../../../../shared/browser-grab/remote-grab-point-script'
import type { RemoteGrabMappedPoint } from './remote-browser-grab-session-types'
import { resolveRemoteBrowserCssViewport } from './remote-browser-page-input-model'
import type { RemoteBrowserViewportSize } from './remote-browser-stream-tokens'

type ScreenRect = { left: number; top: number; width: number; height: number }

/** Root scroll of the displayed frame, when the host reported one with it. */
export function readRemoteFrameScroll(
  metadata: BrowserScreencastFrameMetadata | null
): RemoteGrabPoint | null {
  const x = metadata?.scrollOffsetX
  const y = metadata?.scrollOffsetY
  return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)
    ? { x, y }
    : null
}

/**
 * Maps a client pointer into the host page's CSS viewport through the displayed frame. Points
 * outside the frame are rejected rather than clamped onto an edge element.
 */
export function mapClientPointToRemote(
  client: RemoteGrabPoint,
  frame: ScreenRect,
  viewport: RemoteGrabViewport,
  scroll: RemoteGrabPoint | null
): RemoteGrabMappedPoint | null {
  if (frame.width <= 0 || frame.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return null
  }
  const offsetX = client.x - frame.left
  const offsetY = client.y - frame.top
  if (offsetX < 0 || offsetY < 0 || offsetX >= frame.width || offsetY >= frame.height) {
    return null
  }
  return {
    point: {
      x: Math.floor((offsetX / frame.width) * viewport.width),
      y: Math.floor((offsetY / frame.height) * viewport.height)
    },
    viewport,
    scroll
  }
}

/** Inverse of {@link mapClientPointToRemote}: a host CSS rect in frame-relative CSS pixels. */
export function mapRemoteRectToFrame(
  rect: BrowserGrabRect,
  frame: { width: number; height: number },
  viewport: RemoteGrabViewport
): BrowserGrabRect | null {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return null
  }
  const scaleX = frame.width / viewport.width
  const scaleY = frame.height / viewport.height
  return {
    x: rect.x * scaleX,
    y: rect.y * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY
  }
}

export function sameRemoteScroll(a: RemoteGrabPoint | null, b: RemoteGrabPoint | null): boolean {
  if (!a || !b) {
    return true
  }
  return Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2
}

/** Resolves a client pointer through the frame on screen right now. */
export function mapClientPointThroughFrame(
  client: RemoteGrabPoint,
  {
    container,
    image,
    hostViewport,
    cssViewportSize,
    requestedViewportSize,
    frameMetadata
  }: {
    container: HTMLElement | null
    image: HTMLImageElement | null
    /** The host's own innerWidth/innerHeight, the CSS space it hit-tests in, once it reported one. */
    hostViewport: RemoteGrabViewport | null
    cssViewportSize: RemoteBrowserViewportSize | null
    requestedViewportSize: RemoteBrowserViewportSize | null
    frameMetadata: BrowserScreencastFrameMetadata | null
  }
): RemoteGrabMappedPoint | null {
  if (!container || !image) {
    return null
  }
  const viewport =
    hostViewport ??
    resolveRemoteBrowserCssViewport({
      cssViewportSize,
      requestedViewportSize,
      frameMetadata,
      naturalSize: { width: image.naturalWidth, height: image.naturalHeight }
    })
  return mapClientPointToRemote(
    client,
    container.getBoundingClientRect(),
    viewport,
    readRemoteFrameScroll(frameMetadata)
  )
}
