import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { colors, spacing, typography } from '../theme/mobile-theme'
import { createThemedStyles } from '../theme/mobile-themed-styles'
import { useMobileTheme } from '../theme/use-mobile-theme'

export function MobileNativeChatLoading({ restoring = false }: { restoring?: boolean }) {
  useMobileTheme()
  const label = restoring ? 'Restoring conversation…' : 'Loading conversation…'
  return (
    <View
      pointerEvents="none"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      style={[styles.loading, restoring && styles.overlay]}
    >
      <ActivityIndicator color={colors.textSecondary} />
      <Text style={styles.label}>{label}</Text>
    </View>
  )
}

const styles = createThemedStyles(() =>
  StyleSheet.create({
    loading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      padding: spacing.xl
    },
    overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.bgBase },
    label: { color: colors.textSecondary, fontSize: typography.metaSize }
  })
)
