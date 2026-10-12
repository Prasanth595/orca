import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  loadFloatingVoiceButtonAutoSend,
  loadFloatingVoiceButtonEnabled,
  loadFloatingVoiceButtonOpacityPercent,
  loadFloatingVoiceButtonSizePercent,
  saveFloatingVoiceButtonAutoSend,
  saveFloatingVoiceButtonEnabled,
  saveFloatingVoiceButtonOpacityPercent,
  saveFloatingVoiceButtonSizePercent
} from './floating-voice-button-storage'
import {
  DEFAULT_FLOATING_VOICE_BUTTON_OPACITY_PERCENT,
  DEFAULT_FLOATING_VOICE_BUTTON_SIZE_PERCENT,
  type FloatingVoiceButtonOpacityPercent,
  type FloatingVoiceButtonSizePercent
} from './floating-voice-button-geometry'

/**
 * Settings → Chat UI writes these; the session screen (terminal dock + Chat
 * UI, both live under the one session route) reloads on focus so flipping the
 * switch and coming back applies immediately without remounting the screen —
 * same pattern as useMobileSessionPreferenceFocus for terminal text scale.
 */
export function useFloatingVoiceButtonSessionSettings(): {
  enabled: boolean
  sizePercent: FloatingVoiceButtonSizePercent
  opacityPercent: FloatingVoiceButtonOpacityPercent
  autoSend: boolean
} {
  const [enabled, setEnabled] = useState(false)
  const [sizePercent, setSizePercent] = useState<FloatingVoiceButtonSizePercent>(
    DEFAULT_FLOATING_VOICE_BUTTON_SIZE_PERCENT
  )
  const [opacityPercent, setOpacityPercent] = useState<FloatingVoiceButtonOpacityPercent>(
    DEFAULT_FLOATING_VOICE_BUTTON_OPACITY_PERCENT
  )
  const [autoSend, setAutoSend] = useState(false)

  useFocusEffect(
    useCallback(() => {
      let active = true
      void loadFloatingVoiceButtonEnabled().then((value) => {
        if (active) {
          setEnabled(value)
        }
      })
      void loadFloatingVoiceButtonSizePercent().then((value) => {
        if (active) {
          setSizePercent(value)
        }
      })
      void loadFloatingVoiceButtonOpacityPercent().then((value) => {
        if (active) {
          setOpacityPercent(value)
        }
      })
      void loadFloatingVoiceButtonAutoSend().then((value) => {
        if (active) {
          setAutoSend(value)
        }
      })
      return () => {
        active = false
      }
    }, [])
  )

  return { enabled, sizePercent, opacityPercent, autoSend }
}

/** Settings screen's own load/save state — separate from the session hook
 *  above since the settings screen isn't part of the session route stack. */
export function useFloatingVoiceButtonSettingsScreenState(): {
  enabled: boolean
  sizePercent: FloatingVoiceButtonSizePercent
  opacityPercent: FloatingVoiceButtonOpacityPercent
  autoSend: boolean
  loaded: boolean
  setEnabled: (next: boolean) => void
  setSizePercent: (next: FloatingVoiceButtonSizePercent) => void
  setOpacityPercent: (next: FloatingVoiceButtonOpacityPercent) => void
  setAutoSend: (next: boolean) => void
} {
  const [enabled, setEnabledState] = useState(false)
  const [sizePercent, setSizePercentState] = useState<FloatingVoiceButtonSizePercent>(
    DEFAULT_FLOATING_VOICE_BUTTON_SIZE_PERCENT
  )
  const [opacityPercent, setOpacityPercentState] = useState<FloatingVoiceButtonOpacityPercent>(
    DEFAULT_FLOATING_VOICE_BUTTON_OPACITY_PERCENT
  )
  const [autoSend, setAutoSendState] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    void Promise.all([
      loadFloatingVoiceButtonEnabled(),
      loadFloatingVoiceButtonSizePercent(),
      loadFloatingVoiceButtonOpacityPercent(),
      loadFloatingVoiceButtonAutoSend()
    ]).then(([loadedEnabled, loadedSizePercent, loadedOpacityPercent, loadedAutoSend]) => {
      if (!active) {
        return
      }
      setEnabledState(loadedEnabled)
      setSizePercentState(loadedSizePercent)
      setOpacityPercentState(loadedOpacityPercent)
      setAutoSendState(loadedAutoSend)
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [])

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next)
    void saveFloatingVoiceButtonEnabled(next)
  }, [])

  const setSizePercent = useCallback((next: FloatingVoiceButtonSizePercent) => {
    setSizePercentState(next)
    void saveFloatingVoiceButtonSizePercent(next)
  }, [])

  const setOpacityPercent = useCallback((next: FloatingVoiceButtonOpacityPercent) => {
    setOpacityPercentState(next)
    void saveFloatingVoiceButtonOpacityPercent(next)
  }, [])

  const setAutoSend = useCallback((next: boolean) => {
    setAutoSendState(next)
    void saveFloatingVoiceButtonAutoSend(next)
  }, [])

  return {
    enabled,
    sizePercent,
    opacityPercent,
    autoSend,
    loaded,
    setEnabled,
    setSizePercent,
    setOpacityPercent,
    setAutoSend
  }
}
