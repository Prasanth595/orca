import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { TerminalWebViewCommand } from './terminal-webview-messages'

/**
 * Keeps the document told whether the pane's program only reports the mouse with SGR. A fresh
 * document assumes nothing, so readiness only has to name a program that does, and a change while
 * the document is not ready waits for that readiness instead of queueing behind it.
 *
 * Returns what readiness calls to tell the new document.
 */
export function useTerminalSgrMouseProgram(
  enabled: boolean,
  isWebReadyRef: RefObject<boolean>,
  sendToDocument: (msg: TerminalWebViewCommand) => number
) {
  const sentRef = useRef(false)

  useEffect(() => {
    if (isWebReadyRef.current && enabled !== sentRef.current) {
      sendToDocument({ type: 'set-sgr-mouse-program', enabled })
      sentRef.current = enabled
    }
  }, [enabled, isWebReadyRef, sendToDocument])

  return useCallback(() => {
    sentRef.current = false
    if (enabled) {
      sendToDocument({ type: 'set-sgr-mouse-program', enabled })
      sentRef.current = enabled
    }
  }, [enabled, sendToDocument])
}
