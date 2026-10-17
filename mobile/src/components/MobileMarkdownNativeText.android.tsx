import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { findNodeHandle, Text, type LayoutChangeEvent } from 'react-native'
import {
  collectMarkdownCodeRanges,
  type MarkdownTextProps
} from './mobile-markdown-inline-code-ranges'
import { nativeMarkdownCode } from './mobile-markdown-native-code'
import { MarkdownTextContext } from './mobile-markdown-text-setup'
import { colors } from '../theme/mobile-theme'
import { useMobileTheme } from '../theme/use-mobile-theme'

const InsideText = createContext({ nested: false, decorated: false })
const transparentCode = { backgroundColor: 'transparent', paddingHorizontal: 0 } as const

export function MobileMarkdownNativeText({
  children,
  inlineCode,
  style,
  onLayout,
  ...props
}: MarkdownTextProps) {
  const scheme = useMobileTheme()
  const background = useContext(MarkdownTextContext).inlineCodeBackground ?? colors.bgRaised
  const parent = useContext(InsideText)
  const nested = parent.nested
  const view = useRef<Text>(null)
  const frame = useRef<number | null>(null)
  const revision = useRef(0)
  const document = useMemo(() => collectMarkdownCodeRanges(children), [children])
  const [measurement, setMeasurement] = useState<{
    document: typeof document
    scheme: typeof scheme
    background: string
    height: number
  } | null>(null)
  const currentMeasurement =
    measurement?.document === document &&
    measurement.scheme === scheme &&
    measurement.background === background
      ? measurement
      : null
  const decorated = nested ? parent.decorated : currentMeasurement !== null
  const context = useMemo(() => ({ nested: true, decorated }), [decorated])
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
      void native.decorateText(tag, document.text, document.ranges, background, 4, 4, 1).then(
        (result) => {
          if (revision.current === current && result.applied && result.height > 0) {
            setMeasurement((previous) =>
              previous?.document === document &&
              previous.scheme === scheme &&
              previous.background === background &&
              Math.abs(previous.height - result.height) < 0.5
                ? previous
                : { document, scheme, background, height: result.height }
            )
          } else if (revision.current === current) {
            setMeasurement(null)
          }
        },
        () => {
          if (revision.current === current) {
            setMeasurement(null)
          }
        }
      )
    })
  }, [document, nested, scheme, background])
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
    <InsideText.Provider value={context}>
      <Text
        {...props}
        ref={nested ? undefined : view}
        onLayout={nested ? onLayout : layout}
        style={[
          style,
          inlineCode && decorated && transparentCode,
          !nested && currentMeasurement && { minHeight: currentMeasurement.height }
        ]}
      >
        {children}
      </Text>
    </InsideText.Provider>
  )
}
