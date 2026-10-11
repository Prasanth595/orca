import { useCallback, useState } from 'react'
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, ChevronRight, Contrast, SunMoon, Type } from 'lucide-react-native'
import { PickerModal, type PickerOption } from '../components/PickerModal'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { readAppearancePrefs, writeAppearancePrefs } from '../theme/appearance-prefs'
import {
  TEXT_SCALES,
  type AppearancePrefs,
  type ContrastPreference,
  type ThemePreference
} from '../theme/appearance-prefs-parse'

const THEME_OPTIONS: PickerOption<ThemePreference>[] = [
  { value: 'system', label: 'System', subtitle: 'Follow the device light/dark setting' },
  { value: 'light', label: 'Light', subtitle: 'Best for e-ink screens and daylight' },
  { value: 'dark', label: 'Dark' }
]

const CONTRAST_OPTIONS: PickerOption<ContrastPreference>[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High', subtitle: 'Pure white/black, dark borders — for e-ink' }
]

const TEXT_SIZE_OPTIONS: PickerOption<string>[] = TEXT_SCALES.map((scale) => ({
  value: String(scale),
  label: scale === 1 ? 'Default (100%)' : `${Math.round(scale * 100)}%`
}))

// Read once per app launch: what the running app actually uses, since both settings are
// applied by appearance-boot.ts before any screen is built.
const ACTIVE_PREFS = readAppearancePrefs()

type OpenPicker = 'theme' | 'contrast' | 'textSize' | null

export default function DisplaySettingsScreen({ onBack }: { onBack?: () => void }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [prefs, setPrefs] = useState<AppearancePrefs>(readAppearancePrefs)
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const update = useCallback(
    (patch: Partial<AppearancePrefs>) => {
      const next = { ...prefs, ...patch }
      try {
        writeAppearancePrefs(next)
      } catch (err) {
        // Keep the previous value shown: the write did not land, so the choice would not apply.
        setSaveError(err instanceof Error ? err.message : 'Could not save display settings')
        return
      }
      setSaveError(null)
      setPrefs(next)
    },
    [prefs]
  )

  const pendingRestart =
    prefs.theme !== ACTIVE_PREFS.theme ||
    prefs.contrast !== ACTIVE_PREFS.contrast ||
    prefs.textScale !== ACTIVE_PREFS.textScale

  return (
    // Why GestureHandlerRootView at the screen root: PickerModal's drawer must not be clipped to
    // the ScrollView content frame (same arrangement as Settings → Terminal).
    <GestureHandlerRootView style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backButton}
          onPress={onBack ?? (() => router.back())}
        >
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.heading}>Display</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.groupDescription}>
          Theme, contrast and text size for the whole app. The terminal and Chat UI also zoom with a
          pinch. Changes apply the next time you open the app.
        </Text>
        <View style={[styles.section, styles.sectionTopGap]}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => setOpenPicker('theme')}
          >
            <SunMoon size={16} color={colors.textSecondary} />
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Theme</Text>
              <Text style={styles.rowSublabel}>
                {THEME_OPTIONS.find((o) => o.value === prefs.theme)?.label}
              </Text>
            </View>
            <ChevronRight size={16} color={colors.textMuted} />
          </Pressable>
          <View style={styles.divider} />
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => setOpenPicker('contrast')}
          >
            <Contrast size={16} color={colors.textSecondary} />
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Contrast</Text>
              <Text style={styles.rowSublabel}>
                {CONTRAST_OPTIONS.find((o) => o.value === prefs.contrast)?.label}
              </Text>
            </View>
            <ChevronRight size={16} color={colors.textMuted} />
          </Pressable>
          <View style={styles.divider} />
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => setOpenPicker('textSize')}
          >
            <Type size={16} color={colors.textSecondary} />
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Text size</Text>
              <Text style={styles.rowSublabel}>
                {TEXT_SIZE_OPTIONS.find((o) => o.value === String(prefs.textScale))?.label}
              </Text>
            </View>
            <ChevronRight size={16} color={colors.textMuted} />
          </Pressable>
        </View>
        {saveError ? (
          <Text style={[styles.groupDescription, styles.sectionTopGap, styles.errorText]}>
            Could not save: {saveError}
          </Text>
        ) : null}
        {pendingRestart ? (
          <Text style={[styles.groupDescription, styles.sectionTopGap]}>
            Close and reopen Orca to apply.
          </Text>
        ) : null}
      </ScrollView>

      <PickerModal<ThemePreference>
        visible={openPicker === 'theme'}
        title="Theme"
        options={THEME_OPTIONS}
        selected={prefs.theme}
        onSelect={(theme) => update({ theme })}
        onClose={() => setOpenPicker(null)}
      />
      <PickerModal<ContrastPreference>
        visible={openPicker === 'contrast'}
        title="Contrast"
        options={CONTRAST_OPTIONS}
        selected={prefs.contrast}
        onSelect={(contrast) => update({ contrast })}
        onClose={() => setOpenPicker(null)}
      />
      <PickerModal<string>
        visible={openPicker === 'textSize'}
        title="Text size"
        options={TEXT_SIZE_OPTIONS}
        selected={String(prefs.textScale)}
        onSelect={(value) => update({ textScale: Number(value) })}
        onClose={() => setOpenPicker(null)}
      />
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
    paddingHorizontal: spacing.lg
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary
  },
  errorText: {
    color: colors.statusRed
  },
  groupDescription: {
    fontSize: typography.bodySize - 1,
    color: colors.textSecondary,
    lineHeight: 20,
    paddingHorizontal: spacing.xs
  },
  section: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.card,
    overflow: 'hidden'
  },
  sectionTopGap: {
    marginTop: spacing.sm
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2
  },
  rowPressed: {
    backgroundColor: colors.bgRaised
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginLeft: spacing.md + 2
  },
  rowContent: {
    flex: 1
  },
  rowLabel: {
    fontSize: typography.bodySize,
    fontWeight: '500',
    color: colors.textPrimary
  },
  rowSublabel: {
    fontSize: typography.bodySize - 2,
    color: colors.textSecondary,
    marginTop: 2
  }
})
