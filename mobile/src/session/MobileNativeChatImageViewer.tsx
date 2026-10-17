import type { NativeChatImageRefBlock } from '../../../src/shared/native-chat-types'
import { useState } from 'react'
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions
} from 'react-native'
import { X } from 'lucide-react-native'
import { useWindowSafeAreaInsets } from '../layout/side-safe-area'
import { colors } from '../theme/mobile-theme'
import { MobileNativeChatImage } from './MobileNativeChatImage'
import type { MobileNativeChatViewedImage } from './mobile-native-chat-row-overlays'
import { styles } from './mobile-native-chat-message-styles'

export function MobileNativeChatImageViewer({
  uri,
  label,
  gallery,
  onClose
}: MobileNativeChatViewedImage & {
  onClose: () => void
}) {
  const images: readonly NativeChatImageRefBlock[] = gallery?.images ?? [
    { type: 'image-ref', url: uri, alt: label }
  ]
  const initialIndex = gallery?.initialIndex ?? 0
  const insets = useWindowSafeAreaInsets()
  const window = useWindowDimensions()
  const width = Math.max(1, window.width - insets.left - insets.right)
  const [index, setIndex] = useState(initialIndex)
  return (
    <Modal visible presentationStyle="fullScreen" animationType="fade" onRequestClose={onClose}>
      <View
        style={[
          styles.imageViewer,
          {
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            paddingLeft: insets.left,
            paddingRight: insets.right
          }
        ]}
      >
        <View style={styles.imageViewerHeader}>
          <Text style={styles.imageViewerTitle}>
            {index + 1} / {images.length}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close images"
            hitSlop={8}
            onPress={onClose}
            style={styles.imageViewerClose}
          >
            <X size={20} color={colors.textPrimary} />
          </Pressable>
        </View>
        <FlatList
          key={width}
          horizontal
          pagingEnabled
          data={images}
          initialScrollIndex={index}
          initialNumToRender={1}
          windowSize={3}
          showsHorizontalScrollIndicator={false}
          keyExtractor={(image, at) => `${at}:${image.url ?? image.path}`}
          getItemLayout={(_data, at) => ({ length: width, offset: at * width, index: at })}
          onMomentumScrollEnd={(event) =>
            setIndex(
              Math.max(
                0,
                Math.min(images.length - 1, Math.round(event.nativeEvent.contentOffset.x / width))
              )
            )
          }
          renderItem={({ item }) => (
            <View style={{ width, flex: 1 }}>
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ flexGrow: 1 }}
                maximumZoomScale={4}
                minimumZoomScale={1}
                centerContent
              >
                <MobileNativeChatImage
                  uri={item.url ?? item.path}
                  alt={item.alt}
                  fontScale={1}
                  imageStyle={styles.imageGalleryFill}
                />
              </ScrollView>
            </View>
          )}
        />
      </View>
    </Modal>
  )
}
