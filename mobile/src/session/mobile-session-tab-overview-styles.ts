import { StyleSheet } from 'react-native'

import { colors, spacing } from '../theme/mobile-theme'

const TITLE_LINE_HEIGHT = 19

export const tabOverviewStyles = StyleSheet.create({
  // Covers the content row instead of pushing it down, so opening the list never resizes the PTY.
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)'
  },
  column: {
    flex: 1
  },
  panel: {
    flexShrink: 1,
    backgroundColor: colors.bgPanel,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12
  },
  // ScrollView grows by default, which would stretch a short list over the backdrop; shrinking
  // lets a list taller than the screen stop at the panel and scroll inside it.
  list: {
    flexGrow: 0,
    flexShrink: 1
  },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent'
  },
  // A row with lines under its title keeps the marks beside the title, not beside the middle.
  rowMultiline: {
    alignItems: 'flex-start'
  },
  rowActive: {
    backgroundColor: colors.bgRaised,
    // Same neutral marker as the strip's active underline.
    borderLeftColor: colors.textSecondary
  },
  rowPressed: {
    backgroundColor: colors.bgRaised
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.md,
    backgroundColor: colors.borderSubtle
  },
  // As tall as the title's first line, so the marks sit beside it however far the row wraps.
  marks: {
    height: TITLE_LINE_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs
  },
  markSlot: {
    width: 13,
    alignItems: 'center'
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  title: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: TITLE_LINE_HEIGHT
  },
  titleActive: {
    color: colors.textPrimary,
    fontWeight: '600'
  },
  status: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16
  },
  statusLabel: {
    fontWeight: '600'
  },
  detail: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16
  },
  closeButton: {
    alignSelf: 'center',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center'
  },
  closeButtonPressed: {
    backgroundColor: colors.borderSubtle
  },
  unsavedMark: {
    alignSelf: 'center',
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center'
  },
  unsavedDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.statusAmber
  }
})
