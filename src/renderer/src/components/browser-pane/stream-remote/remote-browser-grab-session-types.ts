import type { BrowserGrabPayload } from '../../../../../shared/browser-grab-types'
import type {
  RemoteGrabPoint,
  RemoteGrabPreviewTarget,
  RemoteGrabQuery,
  RemoteGrabQueryResult,
  RemoteGrabViewport
} from '../../../../../shared/browser-grab/remote-grab-point-script'

/** A pointer position resolved against the frame on screen at that moment. */
export type RemoteGrabMappedPoint = {
  point: RemoteGrabPoint
  viewport: RemoteGrabViewport
  scroll: RemoteGrabPoint | null
}

export type RemoteGrabPreview = {
  target: RemoteGrabPreviewTarget
  viewport: RemoteGrabViewport
  /** Host root scroll when measured; the frame on screen may still show another. */
  scroll: RemoteGrabPoint
}

export type RemoteGrabSelectOutcome =
  | { kind: 'selected'; payload: BrowserGrabPayload }
  /** Nothing selectable at that point; the picker stays armed. */
  | { kind: 'empty' }
  /** The page scrolled or resized since the frame the user clicked; click again. */
  | { kind: 'moved' }
  /** Cancelled, superseded or already selecting — say nothing. */
  | { kind: 'ignored' }

/** The host page navigated to another document since the picker was armed. */
export class RemoteGrabNavigatedError extends Error {}

export type RemoteGrabTimer = ReturnType<typeof setTimeout>

export type RemoteGrabSessionDeps = {
  run: (query: RemoteGrabQuery) => Promise<RemoteGrabQueryResult>
  /** Maps the latest client pointer at dispatch time, so geometry changes are picked up. */
  map: (client: RemoteGrabPoint) => RemoteGrabMappedPoint | null
  onPreview: (preview: RemoteGrabPreview | null) => void
  /** The host reported a different CSS viewport than the client mapped with. */
  onViewport: (viewport: RemoteGrabViewport) => void
  /** Terminal: navigation, repeated transport failure. The session has already cancelled. */
  onEnded: (error: Error) => void
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => RemoteGrabTimer
  clearTimer?: (timer: RemoteGrabTimer) => void
}
