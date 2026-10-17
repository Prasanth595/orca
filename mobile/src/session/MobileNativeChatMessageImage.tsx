import { useContext } from 'react'
import { Image, Pressable, Text as NativeText } from 'react-native'
import type { NativeChatImageRefBlock } from '../../../src/shared/native-chat-types'
import { MobileNativeChatImageViewerContext } from './mobile-native-chat-image-viewer-context'
import { isRenderableImageUri } from './mobile-native-chat-image-preview'
import { styles, TEXT_SIZE } from './mobile-native-chat-message-styles'

/** A local preview (composer echo) or real URL draws as a thumbnail that opens full size; a bare
 *  host path (not loadable on the device) falls back to a text placeholder. */
export function MobileNativeChatMessageImage({
  block,
  fontScale,
  onLongPress
}: {
  block: NativeChatImageRefBlock
  fontScale: number
  onLongPress?: () => void
}): React.JSX.Element {
  const openImage = useContext(MobileNativeChatImageViewerContext)
  const uri = block.url ?? block.path
  const label = block.alt ?? 'Attached image'
  if (!isRenderableImageUri(uri)) {
    return (
      <NativeText style={[styles.imageRef, { fontSize: TEXT_SIZE * fontScale }]}>
        🖼 {block.alt ?? block.path ?? block.url ?? 'image'}
      </NativeText>
    )
  }
  return (
    <Pressable
      onPress={() => openImage({ uri, label })}
      onLongPress={onLongPress}
      accessibilityRole="imagebutton"
      accessibilityLabel={label}
      accessibilityHint="Opens the image full size"
    >
      <Image source={{ uri }} style={styles.imageThumb} resizeMode="contain" />
    </Pressable>
  )
}
