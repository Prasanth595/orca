// AsyncStorage load/save for the floating voice button's own prefs, split out
// of storage/preferences.ts to keep that file under its line cap.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { persistMirrored } from '../storage/mirrored-storage-keys'
import {
  DEFAULT_FLOATING_VOICE_BUTTON_OPACITY_PERCENT,
  DEFAULT_FLOATING_VOICE_BUTTON_SIZE_PERCENT,
  isFloatingVoiceButtonNormalizedPosition,
  isFloatingVoiceButtonOpacityPercent,
  isFloatingVoiceButtonSizePercent,
  type FloatingVoiceButtonNormalizedPosition,
  type FloatingVoiceButtonOpacityPercent,
  type FloatingVoiceButtonSizePercent
} from './floating-voice-button-geometry'

const FLOATING_VOICE_BUTTON_ENABLED_KEY = 'orca:floatingVoiceButtonEnabled'

// Why default false: the floating mic is opt-in; only an explicit "true" write
// (Settings → Chat UI → Floating mic button) turns it on.
export async function loadFloatingVoiceButtonEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(FLOATING_VOICE_BUTTON_ENABLED_KEY)
    return raw === 'true'
  } catch {
    return false
  }
}

export async function saveFloatingVoiceButtonEnabled(enabled: boolean): Promise<void> {
  await persistMirrored(FLOATING_VOICE_BUTTON_ENABLED_KEY, String(enabled))
}

const FLOATING_VOICE_BUTTON_SIZE_PERCENT_KEY = 'orca:floatingVoiceButtonSizePercent'

export async function loadFloatingVoiceButtonSizePercent(): Promise<FloatingVoiceButtonSizePercent> {
  try {
    const raw = await AsyncStorage.getItem(FLOATING_VOICE_BUTTON_SIZE_PERCENT_KEY)
    if (raw === null) {
      return DEFAULT_FLOATING_VOICE_BUTTON_SIZE_PERCENT
    }
    const parsed = Number(raw)
    return isFloatingVoiceButtonSizePercent(parsed)
      ? parsed
      : DEFAULT_FLOATING_VOICE_BUTTON_SIZE_PERCENT
  } catch {
    return DEFAULT_FLOATING_VOICE_BUTTON_SIZE_PERCENT
  }
}

export async function saveFloatingVoiceButtonSizePercent(
  percent: FloatingVoiceButtonSizePercent
): Promise<void> {
  await persistMirrored(FLOATING_VOICE_BUTTON_SIZE_PERCENT_KEY, String(percent))
}

const FLOATING_VOICE_BUTTON_OPACITY_PERCENT_KEY = 'orca:floatingVoiceButtonOpacityPercent'

export async function loadFloatingVoiceButtonOpacityPercent(): Promise<FloatingVoiceButtonOpacityPercent> {
  try {
    const raw = await AsyncStorage.getItem(FLOATING_VOICE_BUTTON_OPACITY_PERCENT_KEY)
    if (raw === null) {
      return DEFAULT_FLOATING_VOICE_BUTTON_OPACITY_PERCENT
    }
    const parsed = Number(raw)
    return isFloatingVoiceButtonOpacityPercent(parsed)
      ? parsed
      : DEFAULT_FLOATING_VOICE_BUTTON_OPACITY_PERCENT
  } catch {
    return DEFAULT_FLOATING_VOICE_BUTTON_OPACITY_PERCENT
  }
}

export async function saveFloatingVoiceButtonOpacityPercent(
  percent: FloatingVoiceButtonOpacityPercent
): Promise<void> {
  await persistMirrored(FLOATING_VOICE_BUTTON_OPACITY_PERCENT_KEY, String(percent))
}

const FLOATING_VOICE_BUTTON_AUTO_SEND_KEY = 'orca:floatingVoiceButtonAutoSend'

// Why default false: auto-submitting a transcript is a bigger behavior change
// than the other prefs (it fires a Send the user didn't press) — opt-in only.
export async function loadFloatingVoiceButtonAutoSend(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(FLOATING_VOICE_BUTTON_AUTO_SEND_KEY)
    return raw === 'true'
  } catch {
    return false
  }
}

export async function saveFloatingVoiceButtonAutoSend(enabled: boolean): Promise<void> {
  await persistMirrored(FLOATING_VOICE_BUTTON_AUTO_SEND_KEY, String(enabled))
}

const FLOATING_VOICE_BUTTON_POSITION_KEY = 'orca:floatingVoiceButtonPosition'

// Null means "never dragged" — the caller falls back to its own default corner
// rather than this module owning a screen-shaped default.
export async function loadFloatingVoiceButtonPosition(): Promise<FloatingVoiceButtonNormalizedPosition | null> {
  try {
    const raw = await AsyncStorage.getItem(FLOATING_VOICE_BUTTON_POSITION_KEY)
    if (!raw) {
      return null
    }
    const parsed: unknown = JSON.parse(raw)
    return isFloatingVoiceButtonNormalizedPosition(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function saveFloatingVoiceButtonPosition(
  position: FloatingVoiceButtonNormalizedPosition
): Promise<void> {
  await persistMirrored(FLOATING_VOICE_BUTTON_POSITION_KEY, JSON.stringify(position))
}
