import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, Pressable, ScrollView, Switch } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { useMobileDefaultSessionViewPreference } from '../session/use-mobile-default-session-view-preference'
import { useFloatingVoiceButtonSettingsScreenState } from '../session/use-floating-voice-button-settings'
import {
  FLOATING_VOICE_BUTTON_OPACITY_OPTIONS,
  FLOATING_VOICE_BUTTON_SIZE_OPTIONS
} from '../session/floating-voice-button-geometry'
import { PickerModal, type PickerOption } from '../components/PickerModal'
import type { VoiceSettingsOperations } from './voice-settings-operations'

// PickerModal is string-keyed; picker values are the percent as a string,
// mapped back to the numeric percent on select.
const VOICE_BUTTON_SIZE_OPTIONS: PickerOption[] = FLOATING_VOICE_BUTTON_SIZE_OPTIONS.map(
  (percent) => ({
    value: `${percent}`,
    label: percent === 200 ? `${percent}% (default)` : `${percent}%`
  })
)

const VOICE_BUTTON_OPACITY_OPTIONS: PickerOption[] = FLOATING_VOICE_BUTTON_OPACITY_OPTIONS.map(
  (percent) => ({
    value: `${percent}`,
    label: percent === 100 ? `${percent}% (default)` : `${percent}%`
  })
)

// Same dictationMode ('toggle' | 'hold') the Voice settings screen edits — this
// is deliberately NOT a separate preference; both screens read/write it
// through the same VoiceSettingsOperations so they can never disagree.
type DictationModeValue = 'toggle' | 'hold'
const DICTATION_BEHAVIOUR_OPTIONS: PickerOption<DictationModeValue>[] = [
  { value: 'hold', label: 'Hold to talk' },
  { value: 'toggle', label: 'Tap to start, tap to stop' }
]

export default function NativeChatSettingsScreen({
  onBack,
  voiceOperations = null
}: {
  onBack?: () => void
  voiceOperations?: VoiceSettingsOperations | null
}) {
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const { defaultView, setDefaultView } = useMobileDefaultSessionViewPreference()
  const chatDefault = defaultView === 'chat'

  const {
    enabled: floatingVoiceEnabled,
    sizePercent: floatingVoiceSizePercent,
    opacityPercent: floatingVoiceOpacityPercent,
    autoSend: floatingVoiceAutoSend,
    setEnabled: setFloatingVoiceEnabled,
    setSizePercent: setFloatingVoiceSizePercent,
    setOpacityPercent: setFloatingVoiceOpacityPercent,
    setAutoSend: setFloatingVoiceAutoSend
  } = useFloatingVoiceButtonSettingsScreenState()
  const [showSizePicker, setShowSizePicker] = useState(false)
  const [showOpacityPicker, setShowOpacityPicker] = useState(false)
  const [showBehaviourPicker, setShowBehaviourPicker] = useState(false)
  // Why 'toggle': it is the desktop's default; showing "Hold" before the real value loads invited
  // flipping the desktop into hold mode by mistake, where a tap starts and instantly cancels.
  const [dictationMode, setDictationMode] = useState<DictationModeValue>('toggle')
  const [voiceError, setVoiceError] = useState<string | null>(null)

  const applySetupMode = (mode: string | undefined) => {
    if (mode === 'toggle' || mode === 'hold') {
      setDictationMode(mode)
    }
  }

  useEffect(() => {
    let active = true
    if (!voiceOperations) {
      return
    }
    voiceOperations
      .load()
      .then((setup) => {
        if (active) {
          applySetupMode(setup.dictationMode)
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setVoiceError(err instanceof Error ? err.message : 'Could not load voice settings')
        }
      })
    return () => {
      active = false
    }
  }, [voiceOperations])

  const handleBehaviourSelect = (value: DictationModeValue) => {
    const previous = dictationMode
    setDictationMode(value)
    setVoiceError(null)
    voiceOperations
      ?.configure({ dictationMode: value })
      .then((setup) => applySetupMode(setup.dictationMode))
      .catch((err: unknown) => {
        // Revert the optimistic value so the row never shows a mode the host didn't accept.
        setDictationMode(previous)
        setVoiceError(err instanceof Error ? err.message : 'Could not update')
      })
  }

  return (
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
        <Text style={styles.heading}>Chat UI</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.groupHeading}>DEFAULT VIEW</Text>
        <Text style={styles.groupDescription}>
          Choose how supported agent sessions (Claude, Codex, and other chat-capable agents) open on
          this device. Terminal shows the raw CLI; Chat UI shows a chat interface like the desktop
          app. You can still switch any individual session from its long-press menu.
        </Text>
        <View style={[styles.section, styles.sectionTopGap]}>
          <View style={styles.row}>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Open sessions in Chat UI</Text>
              <Text style={styles.rowSublabel}>{chatDefault ? 'On' : 'Off'}</Text>
            </View>
            <Switch
              accessibilityLabel="Open sessions in Chat UI"
              value={chatDefault}
              onValueChange={(next) => setDefaultView(next ? 'chat' : 'terminal')}
              trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
              thumbColor={colors.textPrimary}
            />
          </View>
        </View>

        <Text style={[styles.groupHeading, styles.sectionTopGap]}>VOICE BUTTON</Text>
        <Text style={styles.groupDescription}>
          A floating mic button hovers over the terminal and Chat UI screens and can be dragged
          anywhere. Turn it off to use the mic button built into the input bar instead.
        </Text>
        <View style={[styles.section, styles.sectionTopGap]}>
          <View style={styles.row}>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Floating mic button</Text>
              <Text style={styles.rowSublabel}>{floatingVoiceEnabled ? 'On' : 'Off'}</Text>
            </View>
            <Switch
              accessibilityLabel="Floating mic button"
              value={floatingVoiceEnabled}
              onValueChange={setFloatingVoiceEnabled}
              trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
              thumbColor={colors.textPrimary}
            />
          </View>
          <Pressable
            style={[styles.row, styles.rowDivider]}
            disabled={!floatingVoiceEnabled}
            onPress={() => setShowSizePicker(true)}
            accessibilityRole="button"
            accessibilityLabel="Button size"
          >
            <View style={styles.rowContent}>
              <Text style={[styles.rowLabel, !floatingVoiceEnabled && styles.rowLabelDisabled]}>
                Button size
              </Text>
              <Text style={styles.rowSublabel}>{floatingVoiceSizePercent}%</Text>
            </View>
            <ChevronRight size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable
            style={[styles.row, styles.rowDivider]}
            disabled={!floatingVoiceEnabled}
            onPress={() => setShowOpacityPicker(true)}
            accessibilityRole="button"
            accessibilityLabel="Button opacity"
          >
            <View style={styles.rowContent}>
              <Text style={[styles.rowLabel, !floatingVoiceEnabled && styles.rowLabelDisabled]}>
                Button opacity
              </Text>
              <Text style={styles.rowSublabel}>{floatingVoiceOpacityPercent}%</Text>
            </View>
            <ChevronRight size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable
            style={[styles.row, styles.rowDivider]}
            disabled={!voiceOperations}
            onPress={() => setShowBehaviourPicker(true)}
            accessibilityRole="button"
            accessibilityLabel="Behaviour"
          >
            <View style={styles.rowContent}>
              <Text style={[styles.rowLabel, !voiceOperations && styles.rowLabelDisabled]}>
                Behaviour
              </Text>
              <Text style={styles.rowSublabel}>
                {voiceOperations
                  ? (DICTATION_BEHAVIOUR_OPTIONS.find((o) => o.value === dictationMode)?.label ??
                    dictationMode)
                  : 'Connect to a host to change this'}
              </Text>
            </View>
            <ChevronRight size={18} color={colors.textMuted} />
          </Pressable>
          {voiceError ? <Text style={styles.errorText}>{voiceError}</Text> : null}
          <View style={[styles.row, styles.rowDivider]}>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Send automatically</Text>
              <Text style={styles.rowSublabel}>
                Applies to any dictation, floating or input-bar mic: submit the text as soon as it
                finishes, without pressing Send.
              </Text>
            </View>
            <Switch
              accessibilityLabel="Send automatically"
              value={floatingVoiceAutoSend}
              onValueChange={setFloatingVoiceAutoSend}
              trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
              thumbColor={colors.textPrimary}
            />
          </View>
        </View>
      </ScrollView>

      <PickerModal
        visible={showSizePicker}
        title="Button size"
        options={VOICE_BUTTON_SIZE_OPTIONS}
        selected={`${floatingVoiceSizePercent}`}
        onSelect={(value) => {
          const percent = FLOATING_VOICE_BUTTON_SIZE_OPTIONS.find((option) => `${option}` === value)
          if (percent !== undefined) {
            setFloatingVoiceSizePercent(percent)
          }
        }}
        onClose={() => setShowSizePicker(false)}
      />

      <PickerModal
        visible={showOpacityPicker}
        title="Button opacity"
        options={VOICE_BUTTON_OPACITY_OPTIONS}
        selected={`${floatingVoiceOpacityPercent}`}
        onSelect={(value) => {
          const percent = FLOATING_VOICE_BUTTON_OPACITY_OPTIONS.find(
            (option) => `${option}` === value
          )
          if (percent !== undefined) {
            setFloatingVoiceOpacityPercent(percent)
          }
        }}
        onClose={() => setShowOpacityPicker(false)}
      />

      <PickerModal<DictationModeValue>
        visible={showBehaviourPicker}
        title="Behaviour"
        options={DICTATION_BEHAVIOUR_OPTIONS}
        selected={dictationMode}
        onSelect={handleBehaviourSelect}
        onClose={() => setShowBehaviourPicker(false)}
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
  groupHeading: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs
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
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle
  },
  errorText: {
    fontSize: typography.bodySize - 2,
    color: colors.statusRed,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs
  },
  rowLabelDisabled: {
    color: colors.textMuted
  }
})
