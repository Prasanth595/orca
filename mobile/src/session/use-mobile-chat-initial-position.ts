import { useCallback, useEffect, useRef, useState } from 'react'
import type { NativeScrollEvent } from 'react-native'

/** Reveal a transcript only after measured layout and its requested position agree for two frames. */
export function useMobileChatInitialPosition(
  scope: string | undefined,
  savedOffset: number | null
) {
  const [readyScope, setReadyScope] = useState<{ scope: string | undefined; visit: number } | null>(
    null
  )
  const geometry = useRef({ scope, height: 0, viewport: 0, offset: 0, savedOffset })
  const visit = useRef(0)
  const frame = useRef<number | null>(null)
  const revision = useRef(0)
  const clear = useCallback(() => {
    revision.current++
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [])
  if (geometry.current.scope !== scope) {
    visit.current++
    geometry.current = { scope, height: 0, viewport: 0, offset: 0, savedOffset }
  }
  const currentVisit = visit.current
  const ready =
    readyScope !== null && readyScope.scope === scope && readyScope.visit === currentVisit
  const confirm = useCallback(() => {
    clear()
    const measured = geometry.current
    if (
      ready ||
      measured.scope !== scope ||
      visit.current !== currentVisit ||
      measured.height <= 0 ||
      measured.viewport <= 0
    ) {
      return
    }
    const end = Math.max(0, measured.height - measured.viewport)
    const target = measured.savedOffset === null ? end : Math.min(measured.savedOffset, end)
    if (Math.abs(measured.offset - target) > 2) {
      return
    }
    const version = revision.current
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(() => {
        frame.current = null
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
  useEffect(() => clear, [clear, scope])
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
