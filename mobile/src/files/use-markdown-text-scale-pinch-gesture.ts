import { useMemo, useRef } from 'react'
import { Platform } from 'react-native'
import { Gesture } from 'react-native-gesture-handler'
import {
  clampMarkdownTextScale,
  quantizeLiveScale,
  snapMarkdownTextScale
} from './markdown-text-scales'

/**
 * Pinch-to-zoom for Markdown text size. Mirrors the chat transcript's pinch
 * (`useMobileNativeChatPinchGesture`), but the committed scale is owned by the
 * caller (not this hook) so the toolbar picker and the pinch gesture read and
 * write the exact same state — pinching updates the toolbar's summary live,
 * and picking a toolbar value is what a pinch would have landed on anyway.
 *
 * `combineWithNativeScroll` composes `Gesture.Native()` alongside the pinch so a wrapped
 * `ScrollView`'s own pan keeps working simultaneously (the file preview's case). The rich Markdown
 * editor wraps a `WebView` instead, whose ref does not forward a native handle `Gesture.Native()`
 * could attach to — there a bare `Gesture.Pinch()` on an ancestor `View` is enough: it only ever
 * activates on a second touch, so single-finger taps, drags and text selection inside the WebView
 * reach it untouched.
 */
export function useMarkdownTextScalePinchGesture(
  scale: number,
  onLiveScale: (scale: number) => void,
  onCommit: (scale: number) => void,
  combineWithNativeScroll = true
) {
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const pinchBase = useRef(scale)

  return useMemo(() => {
    const pinch = Gesture.Pinch()
      // Why off on web: RNGH there sets user-select:none / touch-action:none on the wrapped view,
      // which would break text selection and touch scrolling in the web editor and preview.
      .enabled(Platform.OS !== 'web')
      // Why: run on the JS thread, not a reanimated UI-thread worklet — touching
      // React state/refs from there crashes the app (see the chat pinch gesture).
      .runOnJS(true)
      .onStart(() => {
        pinchBase.current = scaleRef.current
      })
      .onUpdate((e) => {
        // Why 0.05 steps + skip when unchanged: a raw float every frame re-renders the preview
        // and injects JS into the editor per frame; quantizing bounds that to a few updates.
        const next = quantizeLiveScale(clampMarkdownTextScale(pinchBase.current * e.scale))
        if (next !== scaleRef.current) {
          scaleRef.current = next
          onLiveScale(next)
        }
      })
      .onEnd(() => {
        const snapped = snapMarkdownTextScale(scaleRef.current)
        onLiveScale(snapped)
        onCommit(snapped)
      })
    return combineWithNativeScroll ? Gesture.Simultaneous(Gesture.Native(), pinch) : pinch
  }, [onLiveScale, onCommit, combineWithNativeScroll])
}
