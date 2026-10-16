import { useCallback, useEffect, useMemo, useRef } from 'react'
import { View, type CellRendererProps } from 'react-native'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileChatDisclosureAnchor } from './mobile-chat-disclosure-anchor'

export function useMobileNativeChatDisclosureAnchor(
  scope: string,
  rows: readonly NativeChatMessage[],
  pause: () => void,
  restoreOffset: (offset: number) => void,
  ready: boolean
) {
  const anchor = useMemo(() => new MobileChatDisclosureAnchor(), [scope])
  const frame = useRef<number | null>(null)
  const ids = useMemo(() => rows.map((row) => row.id), [rows])
  useEffect(
    () => () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current)
      }
    },
    [anchor]
  )
  const Cell = useMemo(
    () =>
      function DisclosureCell(props: CellRendererProps<NativeChatMessage>) {
        return (
          <View
            style={props.style}
            {...{ onFocusCapture: props.onFocusCapture }}
            onLayout={(event) => {
              anchor.recordRow(props.item.id, event.nativeEvent.layout)
              props.onLayout?.(event)
            }}
          >
            {props.children}
          </View>
        )
      },
    [anchor]
  )
  return {
    Cell,
    recordOffset: useCallback(
      (offset: number, viewport: number) => anchor.recordOffset(offset, viewport),
      [anchor]
    ),
    hold: useCallback(() => {
      if (!ready) {
        return
      }
      pause()
      anchor.hold(ids)
    }, [anchor, ids, pause, ready]),
    afterResize: useCallback(() => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current)
      }
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        const offset = anchor.restore(ids)
        anchor.retain(ids)
        if (offset !== null) {
          restoreOffset(offset)
        }
      })
    }, [anchor, ids, restoreOffset])
  }
}
