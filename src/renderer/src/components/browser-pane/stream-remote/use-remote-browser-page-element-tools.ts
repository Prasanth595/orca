import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShortcutLabel } from '@/hooks/useShortcutLabel'
import type { BrowserScreencastFrameMetadata } from '../../../../../shared/browser-screencast-protocol'
import type { BrowserPage as BrowserPageState } from '../../../../../shared/browser-workspace-types'
import type { RemoteBrowserPageHandle } from '@/store/slices/browser'
import { deliverMarkupToClipboard } from '../annotate/markup-clipboard-delivery'
import { useBrowserPageAnnotationSend } from '../annotate/use-browser-page-annotation-send'
import { useBrowserPageGrabAnnotations } from '../annotate/use-browser-page-grab-annotations'
import {
  useMarkupMode,
  type MarkupCaptureContext,
  type MarkupModeController
} from '../annotate/useMarkupMode'
import type { BrowserChromeElementTools } from '../assemble-chrome/browser-chrome-element-tool-buttons'
import type { BrowserOverlayViewport } from '../describe-page/browser-annotation-geometry'
import type { BrowserChromeShortcutScope } from '../describe-page/browser-page-types'
import type { RemoteGrabPoint } from '../../../../../shared/browser-grab/remote-grab-point-script'
import { readRemoteFrameScroll } from './remote-browser-grab-geometry'
import type {
  RemoteBrowserPaneNotice,
  RemoteBrowserRuntimeTarget
} from './remote-browser-page-input-model'
import type {
  RemoteBrowserOperationToken,
  RemoteBrowserViewportSize
} from './remote-browser-stream-tokens'
import {
  useRemoteBrowserGrabMode,
  type RemoteBrowserGrabMode
} from './use-remote-browser-grab-mode'
import { useRemoteBrowserGrabShortcuts } from './use-remote-browser-grab-shortcuts'

export type RemoteBrowserPageElementTools = {
  grab: RemoteBrowserGrabMode
  grabAnnotations: ReturnType<typeof useBrowserPageGrabAnnotations>
  annotationSend: ReturnType<typeof useBrowserPageAnnotationSend>
  browserOverlayViewport: BrowserOverlayViewport
  frameScroll: RemoteGrabPoint | null
  elementTools: BrowserChromeElementTools
}

/**
 * Grab and Annotate for a streamed page: the remote picker stands in for the local guest picker,
 * and everything after a selection — clipboard copy, the comment card, the annotation tray and
 * delivery to an agent — is the browsing pane's own flow, keyed by this Orca page id.
 */
export function useRemoteBrowserPageElementTools({
  available,
  browserTab,
  worktreeId,
  workspaceId,
  isActive,
  chromeShortcutScope,
  environmentId,
  remotePageHandle,
  runtimeWorktree,
  runtimeTarget,
  createRemoteOperationToken,
  isCurrentRemoteOperationToken,
  closeMissingRemotePage,
  remoteViewportRef,
  imageRef,
  remoteCssViewportSizeRef,
  remoteViewportSizeRef,
  frameMetadata,
  setPaneNotice
}: {
  /** The stream is live and the pane can take input; page readiness is checked here. */
  available: boolean
  browserTab: BrowserPageState
  worktreeId: string
  workspaceId: string
  isActive: boolean
  chromeShortcutScope: BrowserChromeShortcutScope
  environmentId: string
  remotePageHandle: RemoteBrowserPageHandle | null
  runtimeWorktree: string
  runtimeTarget: () => RemoteBrowserRuntimeTarget | null
  createRemoteOperationToken: (remotePageId?: string | null) => RemoteBrowserOperationToken | null
  isCurrentRemoteOperationToken: (token: RemoteBrowserOperationToken) => boolean
  closeMissingRemotePage: (remotePageId?: string | null) => void
  remoteViewportRef: React.RefObject<HTMLDivElement | null>
  imageRef: React.RefObject<HTMLImageElement | null>
  remoteCssViewportSizeRef: React.MutableRefObject<RemoteBrowserViewportSize | null>
  remoteViewportSizeRef: React.MutableRefObject<RemoteBrowserViewportSize | null>
  frameMetadata: BrowserScreencastFrameMetadata | null
  setPaneNotice: (notice: RemoteBrowserPaneNotice | null) => void
}): RemoteBrowserPageElementTools & { markup: MarkupModeController } {
  // Why: markup snapshots the displayed screencast <img>, so it needs no host support at all.
  const markup = useMarkupMode({
    getCaptureContext: useCallback((): MarkupCaptureContext | null => {
      const element = imageRef.current
      const container = remoteViewportRef.current
      if (!element || !container) {
        return null
      }
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        return null
      }
      return {
        source: { kind: 'image', element },
        cssWidth: rect.width,
        cssHeight: rect.height,
        outputScale: window.devicePixelRatio || 1
      }
    }, [imageRef, remoteViewportRef]),
    onDeliver: deliverMarkupToClipboard
  })
  // Why: the store handle is reactive; a handle left over from another environment must not be queried.
  const remotePageId =
    remotePageHandle?.environmentId === environmentId ? remotePageHandle.remotePageId : null
  // One picker at a time: the markup canvas freezes a frame the element picker would query past.
  const pickerAvailable =
    available && !browserTab.loading && remotePageId !== null && !markup.isActive
  const browserTabId = browserTab.id
  const grab = useRemoteBrowserGrabMode({
    enabled: pickerAvailable,
    remotePageId,
    pageUrl: browserTab.url,
    runtimeWorktree,
    runtimeTarget,
    createRemoteOperationToken,
    isCurrentRemoteOperationToken,
    closeMissingRemotePage,
    remoteViewportRef,
    remoteCssViewportSizeRef,
    remoteViewportSizeRef,
    imageRef,
    frameMetadata,
    setPaneNotice
  })
  const [browserOverlayViewport, setBrowserOverlayViewport] = useState<BrowserOverlayViewport>({
    scrollX: 0,
    scrollY: 0,
    version: 0
  })
  // Why: saved cards follow the scroll of the frame on screen, not a guest bridge report.
  const frameScroll = readRemoteFrameScroll(frameMetadata)
  const frameScrollX = frameScroll?.x
  const frameScrollY = frameScroll?.y
  useEffect(() => {
    if (frameScrollX === undefined || frameScrollY === undefined) {
      return
    }
    setBrowserOverlayViewport((current) =>
      current.version > 0 && current.scrollX === frameScrollX && current.scrollY === frameScrollY
        ? current
        : { scrollX: frameScrollX, scrollY: frameScrollY, version: current.version + 1 }
    )
  }, [frameScrollX, frameScrollY])

  const annotationSend = useBrowserPageAnnotationSend({ browserTabId, worktreeId })
  const grabAnnotations = useBrowserPageGrabAnnotations({
    browserTabId,
    isActive,
    grab,
    containerRef: remoteViewportRef,
    webviewRef: remoteViewportRef,
    setBrowserOverlayViewport,
    browserAnnotationsLength: annotationSend.browserAnnotations.length
  })
  useRemoteBrowserGrabShortcuts({
    chromeShortcutScope,
    workspaceId,
    available: pickerAvailable || grab.state !== 'idle',
    grabState: grab.state,
    cancelGrab: grab.cancel,
    startGrabIntent: grabAnnotations.startGrabIntent
  })

  const grabShortcutLabel = useShortcutLabel('browser.grabElement')
  const annotateShortcutLabel = useShortcutLabel('browser.annotateElement')
  const elementTools = useMemo<BrowserChromeElementTools>(
    () => ({
      activeIntent: grab.state !== 'idle' ? grabAnnotations.grabIntent : null,
      onStartIntent: grabAnnotations.startGrabIntent,
      disabled: !pickerAvailable && grab.state === 'idle',
      grabShortcutLabel,
      annotateShortcutLabel,
      annotationCount: annotationSend.browserAnnotations.length
    }),
    [
      annotateShortcutLabel,
      annotationSend.browserAnnotations.length,
      pickerAvailable,
      grab.state,
      grabAnnotations.grabIntent,
      grabAnnotations.startGrabIntent,
      grabShortcutLabel
    ]
  )

  return {
    markup,
    grab,
    grabAnnotations,
    annotationSend,
    browserOverlayViewport,
    frameScroll,
    elementTools
  }
}
