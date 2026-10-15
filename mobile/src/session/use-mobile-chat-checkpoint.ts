import { useEffect, useRef } from 'react'
import { subscribeChatCheckpointFlush } from '../cache/mobile-chat-checkpoint-registry'

/** Throttle token-heavy streams; backgrounding and route teardown flush the latest checkpoint. */
export function useMobileChatCheckpoint(save: () => void): void {
  const latest = useRef(save)
  const saved = useRef<(() => void) | null>(null)
  latest.current = save
  useEffect(() => {
    const flush = (): void => {
      if (saved.current !== latest.current) {
        saved.current = latest.current
        latest.current()
      }
    }
    const timer = setInterval(flush, 2000)
    const unsubscribe = subscribeChatCheckpointFlush(flush)
    return () => {
      clearInterval(timer)
      unsubscribe()
      flush()
    }
  }, [])
}
