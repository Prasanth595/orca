import { useCallback, type RefObject } from 'react'

type TranscriptList = { getNativeScrollRef?: () => unknown }

/** Keep hidden page controls out of keyboard navigation while their layout settles. */
export function useMobileNativeChatTranscriptRef<T extends TranscriptList>(
  listRef: RefObject<T | null>,
  ready: boolean
): (list: T | null) => void {
  return useCallback(
    (list: T | null) => {
      listRef.current = list
      const node = list?.getNativeScrollRef?.()
      if (typeof HTMLElement !== 'undefined' && node instanceof HTMLElement) {
        node.toggleAttribute('inert', !ready)
      }
    },
    [listRef, ready]
  )
}
