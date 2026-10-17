import { StyleSheet } from 'react-native'
import { createThemedStyles } from '../theme/mobile-themed-styles'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'

// Every action touches as a 44pt target (platform floor) inside its row: Android drops touches
// outside the parent, so the row is at least that tall and nothing overhangs it.
const MIN_TOUCH_TARGET = 44

export const styles = createThemedStyles(() =>
  StyleSheet.create({
    list: {
      marginHorizontal: spacing.lg,
      marginVertical: spacing.xs
    },
    box: {
      backgroundColor: colors.bgPanel,
      borderRadius: radii.row,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
      overflow: 'hidden'
    },
    row: {
      minHeight: MIN_TOUCH_TARGET,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingLeft: spacing.md
    },
    divided: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderSubtle
    },
    headerPaused: {
      backgroundColor: colors.bgRaised
    },
    headerLabel: {
      color: colors.textMuted,
      fontSize: typography.metaSize
    },
    headerLabelPaused: {
      color: colors.textPrimary,
      fontWeight: '500'
    },
    headerCount: {
      flex: 1,
      color: colors.textMuted,
      fontSize: typography.metaSize,
      fontVariant: ['tabular-nums']
    },
    textColumn: {
      flex: 1,
      minWidth: 0,
      paddingVertical: spacing.sm,
      gap: 2
    },
    caption: {
      color: colors.textMuted,
      fontSize: typography.metaSize
    },
    captionReturned: {
      color: colors.statusRed
    },
    textAction: {
      minHeight: MIN_TOUCH_TARGET,
      minWidth: MIN_TOUCH_TARGET,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: radii.button
    },
    iconAction: {
      minHeight: MIN_TOUCH_TARGET,
      minWidth: MIN_TOUCH_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.button
    },
    actionLabel: {
      color: colors.textPrimary,
      fontSize: typography.metaSize,
      fontWeight: '500'
    },
    pressed: {
      backgroundColor: colors.bgRaised
    },
    disabled: {
      opacity: 0.5
    }
  })
)
