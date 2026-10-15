import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { findNodeHandle, Text, type LayoutChangeEvent } from 'react-native'
import {
  collectMarkdownCodeRanges,
  type MarkdownTextProps
} from './mobile-markdown-inline-code-ranges'
import { nativeMarkdownCode } from './mobile-markdown-native-code'
import { colors } from '../theme/mobile-theme'
import { useMobileTheme } from '../theme/use-mobile-theme'

const InsideText = createContext(false)
const transparentCode = { backgroundColor: 'transparent', paddingHorizontal: 0 } as const

export function MobileMarkdownNativeText({
  children,
  inlineCode,
  style,
  onLayout,
  ...props
}: MarkdownTextProps) {
  const scheme = useMobileTheme()
  const nested = useContext(InsideText)
  const view = useRef<Text>(null)
  const frame = useRef<number | null>(null)
  const revision = useRef(0)
  const [measurement, setMeasurement] = useState<{ text: string; height: number } | null>(null)
  const document = useMemo(() => collectMarkdownCodeRanges(children), [children])
  const decorate = useCallback(() => {
    const current = ++revision.current
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
    }
    const native = nativeMarkdownCode
    if (nested || !native || document.ranges.length === 0) {
      return
    }
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const tag = view.current ? findNodeHandle(view.current) : null
      if (!tag) {
        return
      }
      void native.decorateText(tag, document.text, document.ranges, colors.bgRaised, 4, 4, 1).then(
        (result) => {
          if (revision.current === current && result.applied && result.height > 0) {
            setMeasurement((previous) =>
              previous?.text === document.text && Math.abs(previous.height - result.height) < 0.5
                ? previous
                : { text: document.text, height: result.height }
            )
          }
        },
        () => {
          /* Native text remains readable if a view disappears during navigation. */
        }
      )
    })
  }, [document, nested, scheme])
  useEffect(() => {
    decorate()
    return () => {
      revision.current++
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current)
      }
    }
  }, [decorate])
  // A height correction can make Fabric reapply its attributed text after our first decoration.
  useEffect(() => {
    if (measurement) {
      decorate()
    }
  }, [measurement, decorate])
  const layout = (event: LayoutChangeEvent) => {
    onLayout?.(event)
    decorate()
  }
  return (
    <InsideText.Provider value={true}>
      <Text
        {...props}
        ref={nested ? undefined : view}
        onLayout={nested ? onLayout : layout}
        style={[
          style,
          inlineCode && nativeMarkdownCode && transparentCode,
          !nested && measurement?.text === document.text && { minHeight: measurement.height }
        ]}
      >
        {children}
      </Text>
    </InsideText.Provider>
  )
}
