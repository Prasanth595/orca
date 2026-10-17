import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Gesture, GestureDetector, type NativeGesture } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import type { NativeChatImageRefBlock } from '../../../src/shared/native-chat-types'
import { MobileNativeChatImage } from './MobileNativeChatImage'
import { styles } from './mobile-native-chat-message-styles'

type Zoom = { scale: number; x: number; y: number }

export function MobileNativeChatAndroidImagePage({
  image,
  width,
  index,
  pagingGesture,
  onInteractionChange
}: {
  image: NativeChatImageRefBlock
  width: number
  index: number
  pagingGesture: NativeGesture
  onInteractionChange: (index: number, locked: boolean) => void
}) {
  const zoom = useSharedValue<Zoom>({ scale: 1, x: 0, y: 0 })
  const base = useSharedValue<Zoom>({ scale: 1, x: 0, y: 0 })
  const anchor = useSharedValue({ x: 0, y: 0 })
  const size = useSharedValue({ width, height: 0 })
  const aspect = useSharedValue(0)
  const [zoomed, setZoomed] = useState(false)
  useEffect(() => () => onInteractionChange(index, false), [index, onInteractionChange])

  function constrain(next: Zoom): Zoom {
    'worklet'
    if (next.scale === 1) {
      return { scale: 1, x: 0, y: 0 }
    }
    const { width: w, height: h } = size.value
    const fitWidth = aspect.value > 0 ? Math.min(w, h * aspect.value) : w
    const fitHeight = aspect.value > 0 ? Math.min(h, w / aspect.value) : h
    const maxX = Math.max(0, (fitWidth * next.scale - w) / 2)
    const maxY = Math.max(0, (fitHeight * next.scale - h) / 2)
    return {
      scale: next.scale,
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y))
    }
  }

  const pinch = Gesture.Pinch()
    .blocksExternalGesture(pagingGesture)
    .onStart((event) => {
      base.value = zoom.value
      anchor.value = {
        x: (event.focalX - size.value.width / 2 - zoom.value.x) / zoom.value.scale,
        y: (event.focalY - size.value.height / 2 - zoom.value.y) / zoom.value.scale
      }
      runOnJS(onInteractionChange)(index, true)
    })
    .onUpdate((event) => {
      const scale = Math.max(1, Math.min(4, base.value.scale * event.scale))
      zoom.value = constrain({
        scale,
        x: event.focalX - size.value.width / 2 - anchor.value.x * scale,
        y: event.focalY - size.value.height / 2 - anchor.value.y * scale
      })
    })
    .onFinalize(() => {
      const enlarged = zoom.value.scale > 1
      runOnJS(setZoomed)(enlarged)
      runOnJS(onInteractionChange)(index, enlarged)
    })
  const pan = Gesture.Pan()
    .enabled(zoomed)
    .maxPointers(1)
    .blocksExternalGesture(pagingGesture)
    .onStart(() => {
      base.value = zoom.value
    })
    .onUpdate((event) => {
      zoom.value = constrain({
        scale: zoom.value.scale,
        x: base.value.x + event.translationX,
        y: base.value.y + event.translationY
      })
    })
  const transform = useAnimatedStyle(() => ({
    transform: [
      { translateX: zoom.value.x },
      { translateY: zoom.value.y },
      { scale: zoom.value.scale }
    ]
  }))
  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan)}>
      <View
        style={{ width, flex: 1, overflow: 'hidden' }}
        onLayout={(event) => {
          size.value = event.nativeEvent.layout
        }}
      >
        <Animated.View style={[{ flex: 1 }, transform]}>
          <MobileNativeChatImage
            uri={image.url ?? image.path}
            alt={image.alt}
            fontScale={1}
            imageStyle={styles.imageGalleryFill}
            onLoad={(event) => {
              const { width: w, height: h } = event.nativeEvent.source
              aspect.value = w > 0 && h > 0 ? w / h : 0
            }}
          />
        </Animated.View>
      </View>
    </GestureDetector>
  )
}
