import type { RemoteGrabPoint } from '../../../../../shared/browser-grab/remote-grab-point-script'
import type { GrabModeHook } from '../annotate/useGrabMode'
import type { RemoteGrabPreview } from './remote-browser-grab-session-types'
import type { RemoteBrowserGrabStatus } from './remote-browser-grab-status'

export type RemoteBrowserGrabMode = GrabModeHook & {
  status: RemoteBrowserGrabStatus
  /** True once a host answer has been pending long enough to deserve visible feedback. */
  slow: boolean
  preview: RemoteGrabPreview | null
  hover: (client: RemoteGrabPoint) => void
  leave: () => void
  select: (client: RemoteGrabPoint, contextMenu: boolean) => void
  invalidateGeometry: () => void
}
