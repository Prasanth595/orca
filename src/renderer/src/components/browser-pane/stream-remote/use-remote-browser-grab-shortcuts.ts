import { useEffect } from 'react'
import { getShortcutPlatform } from '@/hooks/useShortcutLabel'
import { useAppStore } from '@/store'
import { keybindingMatchesAction } from '../../../../../shared/keybindings'
import { browserChromeShortcutOwnsEvent } from '../describe-page/browser-overlay-shortcut-target'
import type { BrowserChromeShortcutScope, GrabIntent } from '../describe-page/browser-page-types'
import { isEditableKeyboardTarget } from '../host-guest/browser-keyboard'
import type { GrabModeState } from '../annotate/useGrabMode'

/**
 * The grab/annotate chords for a streamed pane. Capture phase, so the screencast image's key
 * handler never forwards them to the remote page as keystrokes.
 */
export function useRemoteBrowserGrabShortcuts({
  chromeShortcutScope,
  workspaceId,
  available,
  grabState,
  cancelGrab,
  startGrabIntent
}: {
  chromeShortcutScope: BrowserChromeShortcutScope
  workspaceId: string
  available: boolean
  grabState: GrabModeState
  cancelGrab: () => void
  startGrabIntent: (intent: GrabIntent) => void
}): void {
  const keybindings = useAppStore((state) => state.keybindings)

  useEffect(() => {
    if (chromeShortcutScope === 'inactive' || !available) {
      return
    }
    const shortcutPlatform = getShortcutPlatform()
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        isEditableKeyboardTarget(event.target) ||
        !browserChromeShortcutOwnsEvent(chromeShortcutScope, event, workspaceId)
      ) {
        return
      }
      if (event.key === 'Escape' && grabState === 'armed') {
        event.preventDefault()
        event.stopImmediatePropagation()
        cancelGrab()
        return
      }
      const intent: GrabIntent | null = keybindingMatchesAction(
        'browser.grabElement',
        event,
        shortcutPlatform,
        keybindings
      )
        ? 'copy'
        : keybindingMatchesAction('browser.annotateElement', event, shortcutPlatform, keybindings)
          ? 'annotate'
          : null
      if (intent === null || (intent === 'copy' && window.getSelection()?.isCollapsed === false)) {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      // Why: startGrabIntent toggles, so a held chord would flicker the picker on and off.
      if (!event.repeat) {
        startGrabIntent(intent)
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [
    available,
    cancelGrab,
    chromeShortcutScope,
    grabState,
    keybindings,
    startGrabIntent,
    workspaceId
  ])
}
