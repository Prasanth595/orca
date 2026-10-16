import { useCallback, useEffect, useRef, useState } from 'react'
import type { NativeScrollEvent } from 'react-native'

/** Reveal a transcript only after measured layout and its requested position agree for two frames. */
export function useMobileChatInitialPosition(scope: string | undefined) {
  const [readyScope, setReadyScope] = useState<{ scope: string | undefined; visit: number } | null>(
    null
  )
  const geometry = useRef({ scope, height: 0, viewport: 0, offset: 0 })
  const observedScroll = useRef<{ height: number; viewport: number; offset: number } | null>(null)
  const visit = useRef(0)
  const frame = useRef<number | null>(null)
  const revision = useRef(0)
  const settling = useRef<{ height: number; viewport: number; target: number } | null>(null)
  const clear = useCallback(() => {
    revision.current++
    settling.current = null
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [])
  if (geometry.current.scope !== scope) {
    visit.current++
    observedScroll.current = null
    geometry.current = { scope, height: 0, viewport: 0, offset: 0 }
  }
  const currentVisit = visit.current
  const ready =
    readyScope !== null && readyScope.scope === scope && readyScope.visit === currentVisit
  const confirm = useCallback(() => {
    const measured = geometry.current
    if (
      ready ||
      measured.scope !== scope ||
      visit.current !== currentVisit ||
      measured.height <= 0 ||
      measured.viewport <= 0
    ) {
      clear()
      return
    }
    const observed = observedScroll.current
    if (
      observed &&
      Math.abs(observed.height - measured.height) <= 2 &&
      Math.abs(observed.viewport - measured.viewport) <= 2
    ) {
      measured.offset = observed.offset
    }
    const end = Math.max(0, measured.height - measured.viewport)
    const target = end
    if (Math.abs(measured.offset - target) > 2) {
      clear()
      return
    }
    // Repeated native measurements must not restart the two-frame reveal.
    const pending = settling.current
    if (
      pending?.height === measured.height &&
      pending.viewport === measured.viewport &&
      pending.target === target
    ) {
      return
    }
    clear()
    settling.current = { height: measured.height, viewport: measured.viewport, target }
    const version = revision.current
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        settling.current = null
        if (
          version === revision.current &&
          geometry.current.scope === scope &&
          visit.current === currentVisit
        ) {
          setReadyScope({ scope, visit: currentVisit })
        }
      })
    })
  }, [clear, ready, scope, currentVisit])
  useEffect(
    () => () => {
      // Native layout for the next visit can arrive before this visit's passive cleanup.
      if (visit.current === currentVisit) {
        clear()
      }
    },
    [clear, scope, currentVisit]
  )
  return {
    initialPositionReady: ready,
    recordInitialViewport: useCallback(
      (height: number) => {
        if (geometry.current.scope === scope && visit.current === currentVisit) {
          geometry.current.viewport = height
          confirm()
        }
      },
      [scope, confirm, currentVisit]
    ),
    recordInitialContent: useCallback(
      (height: number) => {
        if (geometry.current.scope === scope && visit.current === currentVisit) {
          geometry.current.height = height
          confirm()
        }
      },
      [scope, confirm, currentVisit]
    ),
    recordInitialScroll: useCallback(
      (event: NativeScrollEvent) => {
        if (geometry.current.scope === scope && visit.current === currentVisit) {
          const measured = geometry.current
          // Native scrolling can report the new geometry before onContentSizeChange does.
          observedScroll.current = {
            height: event.contentSize.height,
            viewport: event.layoutMeasurement.height,
            offset: event.contentOffset.y
          }
          // A throttled event from before the last layout must not confirm its old bottom.
          if (
            (measured.height > 0 && Math.abs(event.contentSize.height - measured.height) > 2) ||
            (measured.viewport > 0 &&
              Math.abs(event.layoutMeasurement.height - measured.viewport) > 2)
          ) {
            return
          }
          measured.offset = event.contentOffset.y
          measured.height = event.contentSize.height
          measured.viewport = event.layoutMeasurement.height
          confirm()
        }
      },
      [scope, confirm, currentVisit]
    )
  }
}
