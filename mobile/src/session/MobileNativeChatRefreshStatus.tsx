import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { colors, spacing, typography } from '../theme/mobile-theme'
import { createThemedStyles } from '../theme/mobile-themed-styles'
import { useMobileTheme } from '../theme/use-mobile-theme'

/** Cached text remains readable while the host establishes the current conversation state. */
export function MobileNativeChatRefreshStatus({
  status,
  error,
  hidden = false
}: {
  status: string
  error?: string
  hidden?: boolean
}) {
  useMobileTheme()
  if (status !== 'loading' && status !== 'error') {
    return null
  }
  const failed = status === 'error'
  const label = failed ? error || 'Could not update conversation.' : 'Updating conversation…'
  return (
    <View
      accessible={!hidden}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      accessibilityRole={hidden ? undefined : failed ? 'alert' : 'progressbar'}
      accessibilityLabel={hidden ? undefined : label}
      accessibilityLiveRegion={hidden ? 'none' : 'polite'}
      style={[styles.row, hidden && styles.hidden]}
    >
      {failed ? null : <ActivityIndicator size="small" color={colors.textSecondary} />}
      <Text style={[styles.text, failed && styles.error]}>{label}</Text>
    </View>
  )
}
const styles = createThemedStyles(() =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.bgPanel
    },
    hidden: { opacity: 0 },
    text: { flexShrink: 1, color: colors.textSecondary, fontSize: typography.metaSize },
    error: { color: colors.statusRed }
  })
)
