import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import {
  NATIVE_CHAT_USER_MESSAGE_FOLD_COPY,
  nativeChatUserMessageFolds
} from '../../../src/shared/native-chat-user-message-fold'
import { onBrightColors, spacing, typography } from '../theme/mobile-theme'

/** Eight lines of your message's markdown at its chat size (13 pt prose, 6 pt leading, ×1.25). */
const FOLDED_HEIGHT = 8 * (13 + 6) * 1.25

/** A long message of yours, folded to its first lines until opened. Desktop parity:
 *  `NativeChatUserMessageFold`, with the same text rule. */
export function MobileNativeChatUserMessageFold({
  text,
  fontScale,
  children
}: {
  text: string
  fontScale: number
  children: React.ReactNode
}): React.JSX.Element {
  const longText = useMemo(() => nativeChatUserMessageFolds(text), [text])
  const [open, setOpen] = useState(false)
  // The text rule can pick a message that already fits the fold; that one gets no toggle.
  const [height, setHeight] = useState<number | null>(null)
  if (!longText) {
    return <>{children}</>
  }
  const clip = FOLDED_HEIGHT * fontScale
  const folds = height === null || height > clip
  return (
    <>
      <View style={folds && !open ? { maxHeight: clip, overflow: 'hidden' } : undefined}>
        <View onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>{children}</View>
      </View>
      {folds && height !== null ? (
        <Pressable
          style={styles.toggle}
          onPress={() => setOpen(!open)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
        >
          <Text style={styles.toggleText}>
            {open
              ? NATIVE_CHAT_USER_MESSAGE_FOLD_COPY.showLess
              : NATIVE_CHAT_USER_MESSAGE_FOLD_COPY.showFull}
          </Text>
        </Pressable>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  toggle: {
    alignSelf: 'flex-end',
    paddingTop: spacing.xs
  },
  toggleText: {
    color: onBrightColors.secondary,
    fontSize: typography.metaSize,
    fontWeight: '600'
  }
})
