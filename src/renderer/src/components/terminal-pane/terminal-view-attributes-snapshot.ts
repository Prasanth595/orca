/**
 * Builds and publishes the atomic `{global, byAgent}` view-attribute snapshot.
 * Does not import the publisher (one-way: publisher may import this file).
 */
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { composeActiveTerminalTheme } from '../../../../shared/compose-active-terminal-theme'
import { normalizeAgentTerminalThemes } from '../../../../shared/agent-terminal-themes'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import { composeTerminalViewAttributes } from '../../../../shared/terminal-view-attributes-composition'
import {
  terminalViewColorQueryReplyColors,
  type TerminalViewAttributesPush
} from '../../../../shared/terminal-view-attributes'
import type { TerminalOscColorQueryReplyColors } from '../../../../shared/terminal-osc-color-reply'
import { resolveEffectiveTerminalAppearance } from '../../lib/terminal-theme'

let lastPublishedSnapshot: string | null = null
let lastPublishedColors: TerminalOscColorQueryReplyColors | null = null
type PublishedColorsListener = (colors: TerminalOscColorQueryReplyColors) => void
const publishedColorsListeners = new Set<PublishedColorsListener>()

/** Hears the global fg/bg of every published change, starting with the current one if any. */
export function subscribeToPublishedTerminalViewColors(
  listener: PublishedColorsListener
): () => void {
  publishedColorsListeners.add(listener)
  if (lastPublishedColors) {
    listener(lastPublishedColors)
  }
  return () => {
    publishedColorsListeners.delete(listener)
  }
}

type SnapshotSettings = Pick<
  GlobalSettings,
  | 'theme'
  | 'terminalThemeDark'
  | 'terminalDividerColorDark'
  | 'terminalUseSeparateLightTheme'
  | 'terminalThemeLight'
  | 'terminalCustomThemes'
  | 'terminalDividerColorLight'
  | 'agentTerminalThemes'
  | 'terminalColorOverrides'
  | 'terminalBackgroundOpacity'
  | 'terminalCursorOpacity'
  | 'terminalCursorStyle'
  | 'terminalCursorBlink'
>

function composeForAgent(
  settings: SnapshotSettings,
  systemPrefersDark: boolean,
  agent?: TuiAgent | null
) {
  const appearance = resolveEffectiveTerminalAppearance(settings, systemPrefersDark, agent)
  const theme = composeActiveTerminalTheme(appearance.theme, settings)
  return composeTerminalViewAttributes(theme, appearance.mode, settings)
}

export function buildTerminalViewAttributesSnapshot(
  settings: SnapshotSettings,
  systemPrefersDark: boolean
): TerminalViewAttributesPush {
  const global = composeForAgent(settings, systemPrefersDark)
  const byAgent: TerminalViewAttributesPush['byAgent'] = {}
  for (const agent of Object.keys(normalizeAgentTerminalThemes(settings.agentTerminalThemes))) {
    if (!isTuiAgent(agent)) {
      continue
    }
    byAgent[agent] = composeForAgent(settings, systemPrefersDark, agent)
  }
  return { kind: 'snapshot', global, byAgent }
}

function sendSnapshotViaPreload(push: TerminalViewAttributesPush): boolean {
  if (typeof window === 'undefined' || !window.api?.pty?.publishTerminalViewAttributes) {
    return false
  }
  window.api.pty.publishTerminalViewAttributes(push)
  return true
}

export function publishComposedTerminalViewAttributesSnapshot(
  push: TerminalViewAttributesPush,
  send: (push: TerminalViewAttributesPush) => boolean
): boolean {
  const serialized = JSON.stringify(push)
  if (serialized === lastPublishedSnapshot) {
    return false
  }
  if (!send(push)) {
    return false
  }
  lastPublishedSnapshot = serialized
  // Why global only: a paired host answers every pane from one viewer theme.
  const colors = terminalViewColorQueryReplyColors(push.global)
  lastPublishedColors = colors
  for (const listener of publishedColorsListeners) {
    listener(colors)
  }
  return true
}

export function publishTerminalViewAttributesSnapshot(
  settings: SnapshotSettings,
  systemPrefersDark: boolean,
  send: (push: TerminalViewAttributesPush) => boolean = sendSnapshotViaPreload
): boolean {
  return publishComposedTerminalViewAttributesSnapshot(
    buildTerminalViewAttributesSnapshot(settings, systemPrefersDark),
    send
  )
}

export function _resetTerminalViewAttributesSnapshotForTest(): void {
  lastPublishedSnapshot = null
  lastPublishedColors = null
  publishedColorsListeners.clear()
}
