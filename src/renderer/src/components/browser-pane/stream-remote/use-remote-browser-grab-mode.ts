import { useCallback, useEffect, useRef, useState } from 'react'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { BrowserGrabPayload } from '../../../../../shared/browser-grab-types'
import type { BrowserScreencastFrameMetadata } from '../../../../../shared/browser-screencast-protocol'
import {
  buildRemoteGrabPointScript,
  readRemoteGrabQueryResult,
  type RemoteGrabPoint,
  type RemoteGrabQuery
} from '../../../../../shared/browser-grab/remote-grab-point-script'
import type { GrabModeState } from '../annotate/useGrabMode'
import { mapClientPointThroughFrame } from './remote-browser-grab-geometry'
import type { RemoteBrowserGrabMode } from './remote-browser-grab-mode-types'
import { RemoteBrowserGrabSession } from './remote-browser-grab-session'
import type { RemoteGrabPreview } from './remote-browser-grab-session-types'
import {
  remoteBrowserGrabFailureText,
  type RemoteBrowserGrabStatus
} from './remote-browser-grab-status'
import type {
  RemoteBrowserPaneNotice,
  RemoteBrowserRuntimeTarget
} from './remote-browser-page-input-model'
import { isRemoteBrowserPageMissingError } from './remote-browser-stream-errors'
import type {
  RemoteBrowserOperationToken,
  RemoteBrowserViewportSize
} from './remote-browser-stream-tokens'
import { useRemoteBrowserGrabGeometryFence } from './use-remote-browser-grab-geometry-fence'
import { useRemoteBrowserGrabSlowFeedback } from './use-remote-browser-grab-slow-feedback'

/** Parity with the local picker's guest lease: an abandoned picker does not stay armed forever. */
export const REMOTE_GRAB_IDLE_TIMEOUT_MS = 120_000

export type { RemoteBrowserGrabMode } from './remote-browser-grab-mode-types'

/**
 * The streamed pane's element picker, shaped like the local one so the browsing pane's copy and
 * annotation flow runs on it unchanged. Queries ride the existing `browser.eval` RPC, which every
 * host version answers, so no capability or wire change is involved.
 */
export function useRemoteBrowserGrabMode({
  enabled,
  remotePageId,
  pageUrl,
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
}: {
  enabled: boolean
  remotePageId: string | null
  pageUrl: string
  runtimeWorktree: string
  runtimeTarget: () => RemoteBrowserRuntimeTarget | null
  createRemoteOperationToken: (remotePageId?: string | null) => RemoteBrowserOperationToken | null
  isCurrentRemoteOperationToken: (token: RemoteBrowserOperationToken) => boolean
  closeMissingRemotePage: (remotePageId?: string | null) => void
  remoteViewportRef: React.RefObject<HTMLDivElement | null>
  remoteCssViewportSizeRef: React.MutableRefObject<RemoteBrowserViewportSize | null>
  remoteViewportSizeRef: React.MutableRefObject<RemoteBrowserViewportSize | null>
  imageRef: React.RefObject<HTMLImageElement | null>
  frameMetadata: BrowserScreencastFrameMetadata | null
  setPaneNotice: (notice: RemoteBrowserPaneNotice | null) => void
}): RemoteBrowserGrabMode {
  const [state, setState] = useState<GrabModeState>('idle')
  const [status, setStatus] = useState<RemoteBrowserGrabStatus>('starting')
  const [payload, setPayload] = useState<BrowserGrabPayload | null>(null)
  const [contextMenu, setContextMenu] = useState(false)
  const [preview, setPreview] = useState<RemoteGrabPreview | null>(null)
  const { slow, startSlowFeedback, stopSlowFeedback } = useRemoteBrowserGrabSlowFeedback()
  const sessionRef = useRef<RemoteBrowserGrabSession | null>(null)
  const lastClientRef = useRef<RemoteGrabPoint | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hostViewportRef = useRef<RemoteBrowserViewportSize | null>(null)
  const frameMetadataRef = useRef(frameMetadata)
  frameMetadataRef.current = frameMetadata
  // Why: navigation, a page/environment switch, a stopped stream or a hidden pane ends the picker
  // in the same render — anything armed for another scope reads as idle immediately.
  const scopeKey =
    enabled && remotePageId ? [remotePageId, pageUrl, runtimeWorktree].join('|') : null
  const [armedScope, setArmedScope] = useState<string | null>(null)
  const live = armedScope !== null && armedScope === scopeKey
  // Why: returning to a retired scope must not revive a picker whose session was cancelled.
  if (armedScope !== null && armedScope !== scopeKey) {
    setArmedScope(null)
  }

  // Synchronous and local: nothing remote needs undoing, because queries install nothing.
  const dropSession = useCallback((): void => {
    sessionRef.current?.cancel()
    sessionRef.current = null
    lastClientRef.current = null
    clearTimeout(idleTimerRef.current)
    idleTimerRef.current = undefined
  }, [])

  const cancel = useCallback((): void => {
    dropSession()
    setArmedScope(null)
    stopSlowFeedback()
    setState('idle')
    setPayload(null)
    setContextMenu(false)
    setPreview(null)
  }, [dropSession, stopSlowFeedback])

  const fail = useCallback(
    (session: RemoteBrowserGrabSession, error: unknown): void => {
      if (sessionRef.current !== session) {
        return
      }
      cancel()
      if (isRemoteBrowserPageMissingError(error)) {
        closeMissingRemotePage(remotePageId)
        return
      }
      setPaneNotice({ kind: 'consequence', text: remoteBrowserGrabFailureText(error) })
    },
    [cancel, closeMissingRemotePage, remotePageId, setPaneNotice]
  )

  const arm = useCallback((): void => {
    const target = runtimeTarget()
    const token = remotePageId ? createRemoteOperationToken(remotePageId) : null
    if (!enabled || !target || !remotePageId || !token) {
      return
    }
    dropSession()
    hostViewportRef.current = null
    // Why: a pane/page/environment epoch change retires everything this session started.
    const retireIfSuperseded = (): void => {
      if (!isCurrentRemoteOperationToken(token)) {
        if (sessionRef.current === session) {
          cancel()
        }
        throw new Error('Element selection was superseded.')
      }
    }
    const run = async (query: RemoteGrabQuery) => {
      retireIfSuperseded()
      const response = await callRuntimeRpc(
        target,
        'browser.eval',
        {
          worktree: runtimeWorktree,
          page: remotePageId,
          expression: buildRemoteGrabPointScript(query)
        },
        { timeoutMs: query.kind === 'preview' ? 10_000 : 15_000, suppressFeatureInteraction: true }
      ).finally(retireIfSuperseded)
      return readRemoteGrabQueryResult(response)
    }
    const session: RemoteBrowserGrabSession = new RemoteBrowserGrabSession({
      run,
      map: (client) =>
        mapClientPointThroughFrame(client, {
          container: remoteViewportRef.current,
          image: imageRef.current,
          hostViewport: hostViewportRef.current,
          cssViewportSize: remoteCssViewportSizeRef.current,
          requestedViewportSize: remoteViewportSizeRef.current,
          frameMetadata: frameMetadataRef.current
        }),
      onPreview: (next) => {
        if (sessionRef.current === session) {
          setPreview(next)
        }
      },
      onViewport: (viewport) => {
        if (sessionRef.current === session) {
          hostViewportRef.current = viewport
        }
      },
      onEnded: (error) => fail(session, error)
    })
    sessionRef.current = session
    setArmedScope(scopeKey)
    setState('armed')
    setStatus('starting')
    setPayload(null)
    setContextMenu(false)
    setPreview(null)
    setPaneNotice(null)
    idleTimerRef.current = setTimeout(cancel, REMOTE_GRAB_IDLE_TIMEOUT_MS)
    startSlowFeedback()
    void session.start().then(
      (started) => {
        if (started && sessionRef.current === session) {
          stopSlowFeedback()
          setStatus('ready')
        }
      },
      (error: unknown) => fail(session, error)
    )
  }, [
    cancel,
    createRemoteOperationToken,
    dropSession,
    enabled,
    fail,
    imageRef,
    isCurrentRemoteOperationToken,
    remoteCssViewportSizeRef,
    remotePageId,
    remoteViewportRef,
    remoteViewportSizeRef,
    runtimeTarget,
    runtimeWorktree,
    scopeKey,
    setPaneNotice,
    startSlowFeedback,
    stopSlowFeedback
  ])

  useEffect(() => {
    if (!live) {
      dropSession()
    }
  }, [dropSession, live])
  useEffect(() => dropSession, [dropSession])

  const invalidateGeometry = useCallback((): void => {
    sessionRef.current?.invalidateGeometry(lastClientRef.current)
  }, [])
  useRemoteBrowserGrabGeometryFence({
    active: live && state !== 'idle',
    frameMetadata,
    remoteViewportRef,
    invalidateGeometry
  })

  const hover = useCallback((client: RemoteGrabPoint): void => {
    lastClientRef.current = client
    sessionRef.current?.hover(client)
    setStatus((current) => (current === 'empty' || current === 'moved' ? 'ready' : current))
  }, [])

  const leave = useCallback((): void => {
    lastClientRef.current = null
    sessionRef.current?.leave()
  }, [])

  const select = useCallback(
    (client: RemoteGrabPoint, nextContextMenu: boolean): void => {
      const session = sessionRef.current
      if (!session?.isReady || state !== 'armed') {
        return
      }
      setStatus('selecting')
      startSlowFeedback()
      void session.select(client).then(
        (outcome) => {
          if (sessionRef.current !== session || outcome.kind === 'ignored') {
            return
          }
          stopSlowFeedback()
          if (outcome.kind !== 'selected') {
            setStatus(outcome.kind)
            session.invalidateGeometry(lastClientRef.current)
            return
          }
          setStatus('selected')
          setContextMenu(nextContextMenu)
          setPayload(outcome.payload)
          setState('confirming')
        },
        (error: unknown) => fail(session, error)
      )
    },
    [fail, startSlowFeedback, state, stopSlowFeedback]
  )

  const toggle = useCallback((): void => {
    if (sessionRef.current) {
      cancel()
    } else {
      arm()
    }
  }, [arm, cancel])

  const rearm = useCallback((): void => {
    const session = sessionRef.current
    if (!session || session.isEnded || session.requiresExplicitRearm) {
      cancel()
      return
    }
    setPayload(null)
    setContextMenu(false)
    setStatus('ready')
    setState('armed')
    session.setPaused(false)
    if (lastClientRef.current) {
      session.hover(lastClientRef.current)
    }
  }, [cancel])

  return {
    state: live ? state : 'idle',
    payload: live ? payload : null,
    error: null,
    contextMenu: live && contextMenu,
    toggle,
    cancel,
    rearm,
    exit: cancel,
    status,
    slow: live && slow,
    preview: live ? preview : null,
    hover,
    leave,
    select,
    invalidateGeometry
  }
}
