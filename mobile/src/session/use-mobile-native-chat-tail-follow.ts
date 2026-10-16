import { useMobileChatInitialPosition } from './use-mobile-chat-initial-position'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import {
  Platform,
  type LayoutChangeEvent,
  type FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native'

/** Distance from the bottom, in points, still treated as "at the tail". */
const AT_TAIL_SLOP = 80

/** RN Web's ScrollView reports no drag or momentum, so on the page the offsets themselves have to
 *  say what the reader did. It ignores `maintainVisibleContentPosition` too. */
function listReportsGestures(): boolean {
  return Platform.OS !== 'web'
}

/** Offset change, in points, below which the page treats the view as not having moved. */
const PAGE_MOVE_SLOP = 1

/** Holds the first visible row in place when rows above it change. The header is not a row. */
const ANCHOR_BELOW_HEADER = { minIndexForVisible: 1 } as const
const ANCHOR_AT_FIRST_ROW = { minIndexForVisible: 0 } as const

export function mobileNativeChatRowAnchor(hasHeader: boolean): { minIndexForVisible: number } {
  return hasHeader ? ANCHOR_BELOW_HEADER : ANCHOR_AT_FIRST_ROW
}

function distanceFromTail(event: NativeScrollEvent): number {
  const { contentOffset, contentSize, layoutMeasurement } = event
  return contentSize.height - (contentOffset.y + layoutMeasurement.height)
}

function isAtTail(event: NativeScrollEvent): boolean {
  return distanceFromTail(event) <= AT_TAIL_SLOP
}

export type MobileNativeChatTailFollow<TItem> = {
  /** Attach to the transcript list; the hook scrolls through this ref alone. */
  listRef: RefObject<FlatList<TItem> | null>
  /** Render flag for the jump-to-latest control. */
  followingLatest: boolean
  showJumpToTail: boolean
  /** Passive maintenance: re-pin after the viewport resizes. */
  initialPositionReady: boolean
  pinToTail: (event?: LayoutChangeEvent) => void
  /** Content-size maintenance using the list's authoritative measured height. */
  pinToTailAfterContentResize: (_width: number, height: number) => void
  /** Explicit jump — send, or the jump-to-latest control. Resumes following. */
  jumpToTail: () => void
  pauseForDisclosure: () => void
  restoreReadingOffset: (offset: number) => void
  beginUserScroll: () => void
  endUserDrag: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
  beginMomentum: () => void
  endMomentum: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
  /** Whether a scroll near the top is the reader's own, and so may page in older history. */
  readerIsScrolling: () => boolean
  recordScrollMetrics: (event: NativeScrollEvent) => void
}

/** Sole owner of transcript scroll position.
 *
 *  Streaming used to have several tail-followers at once: a delayed *animated*
 *  `scrollToEnd` alongside an immediate non-animated one on content growth. The
 *  animated command eases toward the endpoint measured when it started, so while
 *  tokens kept arriving it ran backwards until the content-size pin yanked it
 *  forward — the visible drift-then-snap. One owner, never animated, removes it.
 *
 *  Intent (`following`) is kept separate from geometry (at-tail): a programmatic
 *  scroll reports metrics like any other, so letting metrics decide intent let
 *  the view argue with itself. Only the user's own gestures and explicit jumps
 *  move intent; metrics only decide where a *released* gesture leaves us.
 */
export function useMobileNativeChatTailFollow<TItem>(args: {
  /** Guards `scrollToEnd` against an empty list. */
  items: readonly TItem[]
  scopeKey: string
}): MobileNativeChatTailFollow<TItem> {
  const hasItems = args.items.length > 0
  const listRef = useRef<FlatList<TItem> | null>(null)
  const [following, setFollowingFlag] = useState(true)
  const [atTail, setAtTailFlag] = useState(true)
  // Event handlers read intent at event time, before a re-render lands.
  const followingRef = useRef(true)
  const atTailRef = useRef(true)
  const userScrollActiveRef = useRef(false)
  const userScrollSettleFrameRef = useRef<number | null>(null)
  // Page only: what the offsets last said, in place of the gestures RN Web does not report.
  const pageOffsetRef = useRef(0)
  const pageReaderMovedUpRef = useRef(false)

  const scope = useRef(args.scopeKey)
  const generation = useRef(0)
  if (scope.current !== args.scopeKey) {
    scope.current = args.scopeKey
    generation.current++
    followingRef.current = true
    atTailRef.current = true
    userScrollActiveRef.current = false
    pageOffsetRef.current = 0
    pageReaderMovedUpRef.current = false
    setFollowingFlag(true)
    setAtTailFlag(true)
  }
  const initial = useMobileChatInitialPosition(args.scopeKey)
  const current = generation.current
  const isCurrent = () => generation.current === current

  // Single writer, so the event-time ref and the render flag cannot disagree.
  const setFollowing = useCallback((next: boolean) => {
    if (followingRef.current === next) {
      return
    }
    followingRef.current = next
    setFollowingFlag(next)
  }, [])

  const setAtTail = useCallback((next: boolean) => {
    if (atTailRef.current === next) {
      return
    }
    atTailRef.current = next
    setAtTailFlag(next)
  }, [])

  const pinFrame = useRef<number | null>(null)
  const pendingPin = useRef<(() => void) | null>(null)
  const cancelPin = useCallback(() => {
    if (pinFrame.current !== null) {
      cancelAnimationFrame(pinFrame.current)
    }
    pinFrame.current = null
    pendingPin.current = null
  }, [])
  const pinAfterLayout = useCallback(
    (command: () => void) => {
      if (!initial.initialPositionReady) {
        command()
        return
      }
      pendingPin.current = command
      if (pinFrame.current !== null) {
        return
      }
      pinFrame.current = requestAnimationFrame(() => {
        pinFrame.current = null
        const pin = pendingPin.current
        pendingPin.current = null
        if (isCurrent() && followingRef.current) {
          pin?.()
        }
      })
    },
    [initial.initialPositionReady, current]
  )
  useEffect(() => cancelPin, [cancelPin, args.scopeKey])

  const pinToTail = useCallback(
    (event?: LayoutChangeEvent) => {
      if (event) {
        initial.recordInitialViewport(event.nativeEvent.layout.height)
      }
      if (!isCurrent()) {
        return
      }
      if (!followingRef.current || !hasItems) {
        return
      }
      if (listReportsGestures()) {
        pinAfterLayout(() => listRef.current?.scrollToEnd({ animated: false }))
        return
      }
      // Why not `scrollToEnd`: its estimate can land short, and the page reads a move up as the reader's.
      const scroller: { scrollHeight: number } | null | undefined =
        listRef.current?.getScrollableNode()
      if (scroller) {
        pinAfterLayout(() =>
          listRef.current?.scrollToOffset({ animated: false, offset: scroller.scrollHeight })
        )
      }
    },
    [hasItems, current, initial.recordInitialViewport, pinAfterLayout]
  )

  const pinToTailAfterContentResize = useCallback(
    (_width: number, height: number) => {
      if (!isCurrent()) {
        return
      }
      initial.recordInitialContent(height)
      if (!followingRef.current || !hasItems) {
        return
      }
      pinAfterLayout(() => listRef.current?.scrollToOffset({ animated: false, offset: height }))
    },
    [hasItems, current, initial.recordInitialContent, pinAfterLayout]
  )

  const clearUserScrollSettle = useCallback(() => {
    if (userScrollSettleFrameRef.current !== null) {
      cancelAnimationFrame(userScrollSettleFrameRef.current)
      userScrollSettleFrameRef.current = null
    }
  }, [])

  const recordScrollMetrics = useCallback(
    (event: NativeScrollEvent) => {
      if (!isCurrent()) {
        return
      }
      initial.recordInitialScroll(event)
      const endsAtTail = isAtTail(event)
      setAtTail(endsAtTail)
      if (listReportsGestures()) {
        return
      }
      const moved = event.contentOffset.y - pageOffsetRef.current
      pageOffsetRef.current = event.contentOffset.y
      pageReaderMovedUpRef.current = moved < -PAGE_MOVE_SLOP
      if (followingRef.current) {
        // A pin only moves toward the end and a clamp lands on it: up and short of it is the reader.
        if (pageReaderMovedUpRef.current && distanceFromTail(event) > PAGE_MOVE_SLOP) {
          setFollowing(false)
        }
      } else if (moved > PAGE_MOVE_SLOP && endsAtTail) {
        setFollowing(true)
      }
    },
    [setAtTail, setFollowing, current, initial.recordInitialScroll]
  )

  const jumpToTail = useCallback(() => {
    if (!isCurrent()) {
      return
    }
    clearUserScrollSettle()
    userScrollActiveRef.current = false
    setAtTail(true)
    setFollowing(true)
    pinToTail()
  }, [clearUserScrollSettle, pinToTail, setAtTail, setFollowing, current])

  const pauseForDisclosure = useCallback(() => {
    clearUserScrollSettle()
    userScrollActiveRef.current = false
    setFollowing(false)
  }, [clearUserScrollSettle, setFollowing])
  const restoreReadingOffset = useCallback(
    (nextOffset: number) => {
      if (isCurrent()) {
        listRef.current?.scrollToOffset({ animated: false, offset: nextOffset })
      }
    },
    [current]
  )

  const beginUserScroll = useCallback(() => {
    if (!isCurrent()) {
      return
    }
    clearUserScrollSettle()
    userScrollActiveRef.current = true
    setFollowing(false)
  }, [clearUserScrollSettle, setFollowing, current])

  const finishUserScroll = useCallback(
    (finishedAtTail: boolean) => {
      if (!isCurrent() || !userScrollActiveRef.current) {
        return
      }
      clearUserScrollSettle()
      userScrollActiveRef.current = false
      setAtTail(finishedAtTail)
      setFollowing(finishedAtTail)
      if (finishedAtTail) {
        pinToTail()
      }
    },
    [clearUserScrollSettle, pinToTail, setAtTail, setFollowing, current]
  )

  const endUserDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!isCurrent() || !userScrollActiveRef.current) {
        return
      }
      clearUserScrollSettle()
      const releasedAtTail = isAtTail(event.nativeEvent)
      userScrollSettleFrameRef.current = requestAnimationFrame(() => {
        userScrollSettleFrameRef.current = null
        finishUserScroll(releasedAtTail)
      })
    },
    [clearUserScrollSettle, finishUserScroll]
  )

  const beginMomentum = useCallback(() => {
    if (userScrollActiveRef.current) {
      clearUserScrollSettle()
    }
  }, [clearUserScrollSettle])

  const endMomentum = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) =>
      finishUserScroll(isAtTail(event.nativeEvent)),
    [finishUserScroll]
  )

  const readerIsScrolling = useCallback(
    () =>
      isCurrent() &&
      (listReportsGestures() ? userScrollActiveRef.current : pageReaderMovedUpRef.current),
    [current]
  )

  useLayoutEffect(() => {
    pinToTail()
  }, [args.scopeKey, pinToTail])
  useEffect(() => clearUserScrollSettle, [clearUserScrollSettle])

  return {
    listRef,
    initialPositionReady: initial.initialPositionReady,
    followingLatest: following,
    showJumpToTail: !following && !atTail,
    pinToTail,
    pinToTailAfterContentResize,
    jumpToTail,
    pauseForDisclosure,
    restoreReadingOffset,
    beginUserScroll,
    endUserDrag,
    beginMomentum,
    endMomentum,
    readerIsScrolling,
    recordScrollMetrics
  }
}
