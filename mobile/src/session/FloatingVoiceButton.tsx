import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import { Mic, Square } from 'lucide-react-native'
import { colors } from '../theme/mobile-theme'
import {
  loadFloatingVoiceButtonPosition,
  saveFloatingVoiceButtonPosition
} from './floating-voice-button-storage'
import {
  DEFAULT_FLOATING_VOICE_BUTTON_POSITION,
  clampFloatingVoiceButtonPosition,
  denormalizeFloatingVoiceButtonPosition,
  floatingVoiceButtonDiameter,
  isFloatingVoiceButtonDragTap,
  normalizeFloatingVoiceButtonPosition,
  resolveFloatingVoiceRelease,
  type FloatingVoiceButtonPoint
} from './floating-voice-button-geometry'

// A tap held this long (with no drag) cancels an in-flight dictation instead
// of toggling a new one — mirrors MobileTerminalInputActions' onLongPress.
const LONG_PRESS_CANCEL_MS = 500

export type FloatingVoiceButtonProps = {
  /** Renders nothing when off — the caller still owns showing the inline button. */
  visible: boolean
  sizePercent: number
  /** 5-100; user-controlled see-through-ness of the floating button only —
   *  the inline mic button is unaffected. */
  opacityPercent: number
  mode: string | undefined
  /** Recording or starting — drawn with the active ring, like the inline button. */
  active: boolean
  processing?: boolean
  disabled?: boolean
  onTap: () => void
  onPressIn?: () => void
  onPressOut?: () => void
  onLongPressCancel?: () => void
}

/**
 * Draggable floating mic button, overlaid above the terminal session and Chat
 * UI screens (see FloatingVoiceButtonOverlay). Position persists normalized
 * (fractions of the container) so it survives rotation/keyboard/screen-size
 * changes; drag vs. tap is a movement-threshold check on release, same idea as
 * the inline button's Pressable but done by hand since a Pan gesture doesn't
 * get onPress for free.
 */
export function FloatingVoiceButtonOverlay(props: FloatingVoiceButtonProps) {
  const insets = useSafeAreaInsets()
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null)
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setContainerSize((prev) =>
      prev && prev.width === width && prev.height === height ? prev : { width, height }
    )
  }, [])

  if (!props.visible) {
    return null
  }
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
      {containerSize ? (
        <FloatingVoiceButtonDraggable {...props} containerSize={containerSize} insets={insets} />
      ) : null}
    </View>
  )
}

function FloatingVoiceButtonDraggable({
  sizePercent,
  opacityPercent,
  mode,
  active,
  processing = false,
  disabled = false,
  onTap,
  onPressIn,
  onPressOut,
  onLongPressCancel,
  containerSize,
  insets
}: FloatingVoiceButtonProps & {
  containerSize: { width: number; height: number }
  insets: { top: number; bottom: number; left: number; right: number }
}) {
  const diameter = floatingVoiceButtonDiameter(sizePercent)
  const [pos, setPos] = useState<FloatingVoiceButtonPoint | null>(null)
  const posRef = useRef(pos)
  posRef.current = pos
  const dragStart = useRef<FloatingVoiceButtonPoint | null>(null)
  // Timer flag, not Date.now(): react/purity flags wall-clock reads in the gesture chain.
  const heldLongEnough = useRef(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressedIn = useRef(false)
  const touchCancelled = useRef(false)

  // Load the saved position once, then re-clamp it to the current container
  // any time the container or the button's own size changes (rotation,
  // keyboard, or the size picker).
  useEffect(() => {
    let cancelled = false
    void loadFloatingVoiceButtonPosition().then((saved) => {
      if (cancelled) {
        return
      }
      setPos(
        denormalizeFloatingVoiceButtonPosition({
          position: saved ?? DEFAULT_FLOATING_VOICE_BUTTON_POSITION,
          diameter,
          containerWidth: containerSize.width,
          containerHeight: containerSize.height,
          insets
        })
      )
    })
    return () => {
      cancelled = true
    }
  }, [
    diameter,
    containerSize.width,
    containerSize.height,
    insets.top,
    insets.bottom,
    insets.left,
    insets.right
  ])

  const pan = Gesture.Pan()
    // runOnJS: the callbacks touch React state and AsyncStorage, which crash from a UI-thread worklet.
    .runOnJS(true)
    .onBegin(() => {
      touchCancelled.current = false
      dragStart.current = posRef.current
      heldLongEnough.current = false
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current)
      }
      longPressTimer.current = setTimeout(() => {
        heldLongEnough.current = true
      }, LONG_PRESS_CANCEL_MS)
      pressedIn.current = mode === 'hold' && !disabled
      if (pressedIn.current) {
        onPressIn?.()
      }
    })
    .onTouchesCancelled(() => {
      touchCancelled.current = true
    })
    .onUpdate((e) => {
      if (!dragStart.current) {
        return
      }
      setPos(
        clampFloatingVoiceButtonPosition({
          x: dragStart.current.x + e.translationX,
          y: dragStart.current.y + e.translationY,
          diameter,
          containerWidth: containerSize.width,
          containerHeight: containerSize.height,
          insets
        })
      )
    })
    // onFinalize, not onEnd: onEnd only runs once the Pan activates, so a stationary tap/hold never fired.
    // Its `success` is false for exactly those never-activated taps, so it must not signal cancellation.
    .onFinalize((e) => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }
      const dragged = !isFloatingVoiceButtonDragTap(e.translationX, e.translationY)
      if (dragged) {
        if (posRef.current) {
          void saveFloatingVoiceButtonPosition(
            normalizeFloatingVoiceButtonPosition({
              x: posRef.current.x,
              y: posRef.current.y,
              containerWidth: containerSize.width,
              containerHeight: containerSize.height
            })
          )
        }
      } else if (dragStart.current) {
        // Snap back exactly — a tap/hold-press shouldn't nudge the button from jitter.
        setPos(dragStart.current)
      }
      const action = resolveFloatingVoiceRelease({
        dx: e.translationX,
        dy: e.translationY,
        mode,
        disabled,
        heldLongEnough: heldLongEnough.current,
        active,
        processing,
        pressedIn: pressedIn.current,
        cancelled: touchCancelled.current
      })
      pressedIn.current = false
      if (action === 'tap') {
        onTap()
      } else if (action === 'cancel') {
        onLongPressCancel?.()
      } else if (action === 'pressOut') {
        onPressOut?.()
      }
      dragStart.current = null
    })

  if (!pos) {
    return null
  }

  // Opacity stays inline: the e-ink high-contrast pass only rewrites colors inside StyleSheet.create.
  const opacity = (disabled ? 0.45 : 1) * (opacityPercent / 100)

  return (
    // Root sized to the button: on Android a full-screen gesture root swallows taps meant for the prompt field.
    <GestureHandlerRootView
      style={[styles.root, { left: pos.x, top: pos.y, width: diameter, height: diameter }]}
    >
      <GestureDetector gesture={pan}>
        <View
          accessible
          accessibilityRole="button"
          accessibilityState={{ disabled, busy: processing }}
          accessibilityActions={[{ name: 'activate' }]}
          onAccessibilityAction={() => {
            if (!disabled) {
              onTap()
            }
          }}
          accessibilityLabel={
            processing
              ? 'Cancel voice dictation'
              : active
                ? 'Stop voice dictation'
                : 'Start voice dictation'
          }
          style={[
            styles.button,
            {
              width: diameter,
              height: diameter,
              borderRadius: diameter / 2,
              opacity
            },
            active && styles.buttonActive
          ]}
        >
          {/* Stop square while recording so the user can tell dictation is running. */}
          {processing ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : active ? (
            <Square
              size={Math.round(diameter * 0.34)}
              color={colors.textPrimary}
              fill={colors.textPrimary}
            />
          ) : (
            <Mic size={Math.round(diameter * 0.45)} color={colors.textPrimary} strokeWidth={2.4} />
          )}
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  // Outline-only per the design brief: no fill, so the e-ink high-contrast
  // pass (which rewrites background/border colors) has nothing to invert.
  root: {
    position: 'absolute'
  },
  button: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center'
  },
  // Active/recording state reads via a thicker border, never a fill.
  buttonActive: {
    borderWidth: 4
  }
})
