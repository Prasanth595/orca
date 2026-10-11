import {
  terminalOscColorQueryReplies,
  type TerminalOscColorQueryReplyColors
} from './terminal-osc-color-reply'
import { resolveConfiguredTerminalColors } from './terminal-theme-selection'
import { isTuiAgent } from './tui-agent-config'
import type { TuiAgent } from './tui-agent'

// Last resort before this process is told anything: Orca's default dark terminal theme.
export const ORCA_DEFAULT_COLOR_QUERY_REPLY_COLORS: TerminalOscColorQueryReplyColors =
  resolveConfiguredTerminalColors(
    {
      theme: 'dark',
      terminalThemeDark: '',
      terminalUseSeparateLightTheme: false,
      terminalThemeLight: ''
    },
    true
  )

function answersBothSlots(
  colors: TerminalOscColorQueryReplyColors | null | undefined
): colors is TerminalOscColorQueryReplyColors {
  return !!colors && terminalOscColorQueryReplies(colors, [10, 11]) !== null
}

/** Wire payloads are untrusted; only a pair that can answer both OSC 10 and 11 is kept. */
export function normalizeColorQueryReplyColors(
  value: unknown
): TerminalOscColorQueryReplyColors | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const foreground = 'foreground' in value ? value.foreground : undefined
  const background = 'background' in value ? value.background : undefined
  if (typeof foreground !== 'string' || typeof background !== 'string') {
    return null
  }
  const colors = { foreground, background }
  return answersBothSlots(colors) ? colors : null
}

/** The host's viewer colours, plus the colours of each agent whose theme overrides the global one. */
export type PtyOwnerHostColors = TerminalOscColorQueryReplyColors & {
  byAgent?: Partial<Record<TuiAgent, TerminalOscColorQueryReplyColors>>
}

/** Like normalizeColorQueryReplyColors, keeping each valid per-agent pair; a bad agent entry means inherit. */
export function normalizePtyOwnerHostColors(value: unknown): PtyOwnerHostColors | null {
  const colors = normalizeColorQueryReplyColors(value)
  if (!colors) {
    return null
  }
  const rawByAgent =
    typeof value === 'object' && value !== null && 'byAgent' in value ? value.byAgent : null
  if (!rawByAgent || typeof rawByAgent !== 'object' || Array.isArray(rawByAgent)) {
    return colors
  }
  const byAgent: Partial<Record<TuiAgent, TerminalOscColorQueryReplyColors>> = {}
  for (const [agent, agentColors] of Object.entries(rawByAgent)) {
    const normalized = isTuiAgent(agent) ? normalizeColorQueryReplyColors(agentColors) : null
    if (normalized && isTuiAgent(agent)) {
      byAgent[agent] = normalized
    }
  }
  return Object.keys(byAgent).length > 0 ? { ...colors, byAgent } : colors
}

export function colorQueryReplyColorsEqual(
  a: PtyOwnerHostColors | null,
  b: PtyOwnerHostColors | null
): boolean {
  if (a?.foreground !== b?.foreground || a?.background !== b?.background) {
    return false
  }
  const agents = new Set([...Object.keys(a?.byAgent ?? {}), ...Object.keys(b?.byAgent ?? {})])
  for (const agent of agents) {
    if (!isTuiAgent(agent)) {
      continue
    }
    const left = a?.byAgent?.[agent]
    const right = b?.byAgent?.[agent]
    if (left?.foreground !== right?.foreground || left?.background !== right?.background) {
      return false
    }
  }
  return true
}

// Why process-wide: each process that owns PTYs (main, the daemon, a relay) serves one host,
// so all its panes answer from one viewer theme, pushed to it by the app that shows them.
let hostColors: PtyOwnerHostColors | null = null

/** A malformed push keeps the previous colours rather than blanking them. */
export function setPtyOwnerHostColors(value: unknown): void {
  hostColors = normalizePtyOwnerHostColors(value) ?? hostColors
}

export function getPtyOwnerHostColors(): PtyOwnerHostColors | null {
  return hostColors
}

export function _resetPtyOwnerHostColorsForTest(): void {
  hostColors = null
}

/**
 * The PTY owner always answers. The host-wide viewer colours win over the colours sent at
 * spawn, so a theme change reaches old panes; Orca's default theme answers when nothing has
 * been reported yet. An agent pane answers with its agent's override when the host reports one.
 */
export function resolvePtyOwnerColorQueryColors(
  host: PtyOwnerHostColors | null | undefined,
  spawn: TerminalOscColorQueryReplyColors | null | undefined,
  launchAgent?: TuiAgent | null
): TerminalOscColorQueryReplyColors {
  const agentHost = launchAgent ? host?.byAgent?.[launchAgent] : undefined
  return [agentHost, host, spawn].find(answersBothSlots) ?? ORCA_DEFAULT_COLOR_QUERY_REPLY_COLORS
}
