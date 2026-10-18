import { useCallback, useEffect, useRef, useState } from 'react'

const SLOW_FEEDBACK_DELAY_MS = 200

/** Fast hosts show no working state at all; slow links get one after ~200 ms. */
export function useRemoteBrowserGrabSlowFeedback(): {
  slow: boolean
  startSlowFeedback: () => void
  stopSlowFeedback: () => void
} {
  const [slow, setSlow] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clear = (): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }
  const stopSlowFeedback = useCallback((): void => {
    clear()
    setSlow(false)
  }, [])
  const startSlowFeedback = useCallback((): void => {
    clear()
    timerRef.current = setTimeout(() => setSlow(true), SLOW_FEEDBACK_DELAY_MS)
  }, [])
  useEffect(() => clear, [])
  return { slow, startSlowFeedback, stopSlowFeedback }
}
