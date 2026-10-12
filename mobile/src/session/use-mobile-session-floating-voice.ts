import type {
  FloatingVoiceButtonOpacityPercent,
  FloatingVoiceButtonSizePercent
} from './floating-voice-button-geometry'
import type { useFloatingVoiceButtonSessionSettings } from './use-floating-voice-button-settings'

/** Maps the prefs read once by the dictation hook into the names the terminal dock
 *  and Chat UI overlay consume. */
export function useMobileSessionFloatingVoice(scope: {
  floatingVoiceSettings: ReturnType<typeof useFloatingVoiceButtonSessionSettings>
}): {
  floatingVoiceEnabled: boolean
  floatingVoiceSizePercent: FloatingVoiceButtonSizePercent
  floatingVoiceOpacityPercent: FloatingVoiceButtonOpacityPercent
} {
  const { enabled, sizePercent, opacityPercent } = scope.floatingVoiceSettings
  return {
    floatingVoiceEnabled: enabled,
    floatingVoiceSizePercent: sizePercent,
    floatingVoiceOpacityPercent: opacityPercent
  }
}
