import { Pressable, StyleSheet } from 'react-native'
import { X } from 'lucide-react-native'
import { colors } from '../theme/mobile-theme'

export function CustomShortcutRemoveButton({
  label,
  onPress
}: {
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Remove ${label}`}
    >
      <X size={16} color={colors.statusRed} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)'
  },
  pressed: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)'
  }
})
