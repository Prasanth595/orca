import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  loadTerminalAutocompleteEnabled,
  loadTerminalLinkOpenMode,
  loadTerminalTextScale
} from '../storage/preferences'
import type { MobileSessionKeyboardStateModel } from './use-mobile-session-keyboard-state'

export function useMobileSessionPreferenceFocus(
  scope: Pick<
    MobileSessionKeyboardStateModel,
    'setTerminalTextScale' | 'setAutocompleteEnabled' | 'setTerminalLinkOpenMode'
  >
) {
  const { setTerminalTextScale, setAutocompleteEnabled, setTerminalLinkOpenMode } = scope
  const [terminalPreferencesReady, setTerminalPreferencesReady] = useState(false)
  // Why: pick up Settings → Terminal and → Browser on return; panes stay mounted and update in
  // place. Read together so the first mount waits for all three instead of drawing defaults.
  useFocusEffect(
    useCallback(() => {
      let active = true
      void Promise.all([
        loadTerminalTextScale(),
        loadTerminalAutocompleteEnabled(),
        loadTerminalLinkOpenMode()
      ]).then(([scale, autocomplete, linkMode]) => {
        if (active) {
          setTerminalTextScale(scale)
          setAutocompleteEnabled(autocomplete)
          setTerminalLinkOpenMode(linkMode)
          setTerminalPreferencesReady(true)
        }
      })
      return () => {
        active = false
      }
    }, [])
  )
  return { terminalPreferencesReady }
}
